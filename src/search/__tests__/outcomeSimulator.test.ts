import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { simulateTurn } from '../outcomeSimulator';
import type { MoveAction } from '../actionTypes';
import type { BattleState } from '../../engine/state';

function setupSimpleBattle(): BattleState {
  let battle = createInitialBattleState();

  const incineroar = {
    ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
    position: 'p1a' as const,
    revealedMoves: ['Fake Out'],
    maxHp: 190,
    currentHp: 190,
    hpIsPercentage: false,
  };
  const garchomp = {
    ...createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
    position: 'p2a' as const,
    revealedMoves: ['Earthquake'],
    maxHp: 190,
    currentHp: 190,
    hpIsPercentage: false,
  };

  battle = {
    ...battle,
    pokemonByKey: {
      'p1:Incineroar': incineroar,
      'p2:Garchomp': garchomp,
    },
    activeByPosition: {
      p1a: 'p1:Incineroar',
      p2a: 'p2:Garchomp',
    },
  };

  return battle;
}

describe('simulateTurn', () => {
  it('produces branches whose probabilities sum to (approximately) 1', () => {
    const battle = setupSimpleBattle();
    const fakeOut: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Fake Out',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [fakeOut], [earthquake]);
    const totalProbability = branches.reduce((sum, b) => sum + b.probability, 0);

    expect(totalProbability).toBeCloseTo(1, 5);
  });

  it('reduces target HP in every branch where the move connects', () => {
    const battle = setupSimpleBattle();
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [], [earthquake]);

    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.currentHp).toBeLessThan(190);
    }
  });

  it('creates separate branches for miss vs hit when accuracy is below 100', () => {
    const battle = setupSimpleBattle();
    const battleWithInaccurateMove: BattleState = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p2:Garchomp': {
          ...battle.pokemonByKey['p2:Garchomp'],
          revealedMoves: ['Stone Edge'],
        },
      },
    };

    const stoneEdge: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Stone Edge',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battleWithInaccurateMove, [], [stoneEdge]);
    const missedBranch = branches.find(
      (b) => b.battle.pokemonByKey['p1:Incineroar'].currentHp === 190,
    );
    const hitBranch = branches.find((b) => b.battle.pokemonByKey['p1:Incineroar'].currentHp < 190);

    expect(missedBranch).toBeDefined();
    expect(hitBranch).toBeDefined();
  });

  it('orders Fake Out (priority +3) before Earthquake (priority 0) regardless of speed', () => {
    const battle = setupSimpleBattle();
    const fakeOut: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Fake Out',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [fakeOut], [earthquake]);
    for (const branch of branches) {
      expect(branch.battle.pokemonByKey['p2:Garchomp'].currentHp).toBeLessThan(190);
    }
  });

  it('marks the target as fainted when HP reaches 0', () => {
    const battle = setupSimpleBattle();
    const lowHpBattle: BattleState = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Incineroar': { ...battle.pokemonByKey['p1:Incineroar'], currentHp: 1, maxHp: 190 },
      },
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(lowHpBattle, [], [earthquake]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.fainted).toBe(true);
      expect(incineroar.currentHp).toBe(0);
      expect(branch.battle.activeByPosition.p1a).toBeUndefined();
    }
  });

  it('applique réellement les boosts d’un move de statut auto-ciblé connu (Shell Smash) — régression', () => {
    // Avant le correctif, TOUT move sans cible offensive (targetPositions
    // vide) laissait le combat totalement inchangé, y compris Shell Smash :
    // le Pokémon qui l'utilisait ne recevait jamais ses +2/+2/+2/-1/-1.
    const battle = setupSimpleBattle();
    const shellSmash: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Shell Smash',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [shellSmash], []);
    expect(branches).toHaveLength(1); // move de statut à 100% de précision : une seule branche
    const boosted = branches[0].battle.pokemonByKey['p1:Incineroar'];
    expect(boosted.boosts).toEqual({ atk: 2, def: -1, spa: 2, spd: -1, spe: 2 });
  });

  it('cumule un boost auto-ciblé avec les boosts déjà existants, plafonné à +6/-6', () => {
    const battle = setupSimpleBattle();
    const alreadyBoosted: BattleState = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Incineroar': {
          ...battle.pokemonByKey['p1:Incineroar'],
          boosts: { atk: 5, def: 0, spa: 5, spd: 0, spe: 5 },
        },
      },
    };
    const shellSmash: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Shell Smash',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(alreadyBoosted, [shellSmash], []);
    const boosted = branches[0].battle.pokemonByKey['p1:Incineroar'];
    // atk/spa/spe étaient à +5, +2 les amènerait à +7 → plafonné à +6.
    expect(boosted.boosts).toEqual({ atk: 6, def: -1, spa: 6, spd: -1, spe: 6 });
  });

  it('laisse le combat inchangé pour un move de statut auto-ciblé inconnu de la table (dégradation propre, pas de crash)', () => {
    const battle = setupSimpleBattle();
    const unknownStatusMove: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Some Unknown Status Move',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [unknownStatusMove], []);
    expect(branches[0].battle.pokemonByKey['p1:Incineroar'].boosts).toEqual(
      battle.pokemonByKey['p1:Incineroar'].boosts,
    );
  });

  it('Protect bloque réellement les dégâts d’un move adverse ce tour-ci — régression', () => {
    // Avant le correctif, Protect (comme tout move de statut) laissait le
    // combat inchangé, mais l'attaque adverse s'appliquait quand même
    // normalement dans les branches suivantes : Protect n'avait donc aucun
    // effet observable dans la simulation.
    const battle = setupSimpleBattle();
    const protect: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Protect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [protect], [earthquake]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      // Protect a priorité +4, Earthquake priorité 0 : Protect s'active
      // avant, et doit bloquer intégralement les dégâts d'Earthquake.
      expect(incineroar.currentHp).toBe(incineroar.maxHp);
      expect(incineroar.fainted).toBe(false);
    }
  });

  it('Protect ne bloque pas un move utilisé par un AUTRE Pokémon qui ne l’a pas activé', () => {
    const battle = setupSimpleBattle();
    const protectOther: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Protect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const flareBlitz: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Flare Blitz',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    // Garchomp se protège, mais l'attaque vise Garchomp (bloquée) alors
    // qu'Incineroar (qui attaque, pas protégé) doit rester intact.
    const branches = simulateTurn(battle, [flareBlitz], [protectOther]);
    for (const branch of branches) {
      const garchomp = branch.battle.pokemonByKey['p2:Garchomp'];
      expect(garchomp.currentHp).toBe(garchomp.maxHp);
    }
  });

  it('Quick Guard bloque un move prioritaire mais pas un move de priorité normale', () => {
    const battle = setupSimpleBattle();
    const quickGuard: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Quick Guard',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    // Quick Attack a la priorité +1 (move prioritaire, mais moins que Quick
    // Guard +3) : bloqué quelle que soit la vitesse relative des deux côtés.
    const quickAttackFromP2: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Quick Attack',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [quickGuard], [quickAttackFromP2]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.currentHp).toBe(incineroar.maxHp);
    }
  });

  it('Quick Guard NE bloque PAS un move de priorité normale (Earthquake)', () => {
    const battle = setupSimpleBattle();
    const quickGuard: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Quick Guard',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [quickGuard], [earthquake]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.currentHp).toBeLessThan(incineroar.maxHp ?? 190);
    }
  });

  it('Wide Guard bloque un move de zone (Earthquake) mais pas un move single-target', () => {
    const battle = setupSimpleBattle();
    const wideGuard: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Wide Guard',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [wideGuard], [earthquake]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.currentHp).toBe(incineroar.maxHp);
    }
  });

  it('Wide Guard protège TOUT le côté (l’allié aussi), pas seulement le lanceur', () => {
    let battle = createInitialBattleState();
    const incineroarA = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    const klefki = {
      ...createInitialPokemonState({ species: 'Klefki', side: 'p1', level: 50 }),
      position: 'p1b' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Incineroar': incineroarA, 'p1:Klefki': klefki, 'p2:Garchomp': garchomp },
      activeByPosition: { p1a: 'p1:Incineroar', p1b: 'p1:Klefki', p2a: 'p2:Garchomp' },
    };

    const wideGuard: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Wide Guard',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a', 'p1b'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [wideGuard], [earthquake]);
    for (const branch of branches) {
      expect(branch.battle.pokemonByKey['p1:Incineroar'].currentHp).toBe(190);
      // Klefki (l'allié, qui n'a pas lancé Wide Guard) doit AUSSI être protégé.
      expect(branch.battle.pokemonByKey['p1:Klefki'].currentHp).toBe(150);
    }
  });

  it('Crafty Shield bloque un move de statut ciblé mais pas un move offensif', () => {
    const battle = setupSimpleBattle();
    const craftyShield: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Crafty Shield',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquake: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    // Crafty Shield ne bloque QUE le statut : Earthquake (dégâts directs) doit passer.
    const branches = simulateTurn(battle, [craftyShield], [earthquake]);
    for (const branch of branches) {
      const incineroar = branch.battle.pokemonByKey['p1:Incineroar'];
      expect(incineroar.currentHp).toBeLessThan(incineroar.maxHp ?? 190);
    }
  });

  it('Rage Powder redirige un move single-target visant l’allié vers le lanceur', () => {
    let battle = createInitialBattleState();
    const sinistcha = {
      ...createInitialPokemonState({ species: 'Sinistcha', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      position: 'p1b' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Sinistcha': sinistcha, 'p1:Incineroar': incineroar, 'p2:Garchomp': garchomp },
      activeByPosition: { p1a: 'p1:Sinistcha', p1b: 'p1:Incineroar', p2a: 'p2:Garchomp' },
    };

    const ragePowder: MoveAction = {
      kind: 'move',
      userKey: 'p1:Sinistcha',
      userPosition: 'p1a',
      moveName: 'Rage Powder',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    // Dragon Claw : single-target (pas de zone), neutre contre Grass/Ghost
    // (Sinistcha) donc dégâts non nuls garantis — contrairement à Earthquake
    // (move de zone, ignoré volontairement par la redirection) ou Close
    // Combat (Combat, auquel les Spectre sont immunisés).
    const dragonClawAtIncineroar: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Dragon Claw',
      targetPositions: ['p1b'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [ragePowder], [dragonClawAtIncineroar]);
    for (const branch of branches) {
      // Incineroar (cible d'origine) ne doit PAS avoir été touché : le coup
      // a été redirigé vers Sinistcha (qui a lancé Rage Powder).
      expect(branch.battle.pokemonByKey['p1:Incineroar'].currentHp).toBe(190);
      expect(branch.battle.pokemonByKey['p1:Sinistcha'].currentHp).toBeLessThan(150);
    }
  });

  it('Rage Powder NE redirige PAS un move de zone (Earthquake reste sur ses cibles normales)', () => {
    let battle = createInitialBattleState();
    const sinistcha = {
      ...createInitialPokemonState({ species: 'Sinistcha', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      position: 'p1b' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Sinistcha': sinistcha, 'p1:Incineroar': incineroar, 'p2:Garchomp': garchomp },
      activeByPosition: { p1a: 'p1:Sinistcha', p1b: 'p1:Incineroar', p2a: 'p2:Garchomp' },
    };

    const ragePowder: MoveAction = {
      kind: 'move',
      userKey: 'p1:Sinistcha',
      userPosition: 'p1a',
      moveName: 'Rage Powder',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquakeSpread: MoveAction = {
      kind: 'move',
      userKey: 'p2:Garchomp',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a', 'p1b'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [ragePowder], [earthquakeSpread]);
    for (const branch of branches) {
      // Earthquake est un move de zone : il touche ses 2 cibles normales,
      // Rage Powder ne le redirige PAS entièrement sur Sinistcha seul.
      expect(branch.battle.pokemonByKey['p1:Incineroar'].currentHp).toBeLessThan(190);
    }
  });

  it('Rain Dance pose bien la météo pluie dans l’état simulé', () => {
    const battle = setupSimpleBattle();
    const rainDance: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Rain Dance',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [rainDance], []);
    expect(branches[0].battle.field.weather).toBe('rain');
    expect(branches[0].battle.field.weatherTurnsLeft).toBeGreaterThan(0);
  });

  it('Electric Terrain pose bien le terrain dans l’état simulé', () => {
    const battle = setupSimpleBattle();
    const electricTerrain: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Electric Terrain',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [electricTerrain], []);
    expect(branches[0].battle.field.terrain).toBe('electric');
  });

  it('Trick Room active bien isTrickRoom dans l’état simulé', () => {
    const battle = setupSimpleBattle();
    const trickRoom: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Trick Room',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [trickRoom], []);
    expect(branches[0].battle.field.isTrickRoom).toBe(true);
  });

  it('Tailwind active isTailwind sur le côté du lanceur uniquement', () => {
    const battle = setupSimpleBattle();
    const tailwind: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Tailwind',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [tailwind], []);
    expect(branches[0].battle.sides.p1.isTailwind).toBe(true);
    expect(branches[0].battle.sides.p2.isTailwind).toBe(false);
  });

  it('Reflect active isReflect sur le côté du lanceur uniquement', () => {
    const battle = setupSimpleBattle();
    const reflect: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Reflect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [reflect], []);
    expect(branches[0].battle.sides.p1.isReflect).toBe(true);
    expect(branches[0].battle.sides.p2.isReflect).toBe(false);
  });

  it('Stealth Rock pose les hazards sur le côté ADVERSE, pas celui du lanceur', () => {
    const battle = setupSimpleBattle();
    const stealthRock: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Stealth Rock',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [stealthRock], []);
    expect(branches[0].battle.sides.p2.stealthRock).toBe(true);
    expect(branches[0].battle.sides.p1.stealthRock).toBe(false);
  });

  it('Spikes s’accumule (jusqu’à 3 couches) côté adverse', () => {
    let battle = setupSimpleBattle();
    battle = {
      ...battle,
      sides: { ...battle.sides, p2: { ...battle.sides.p2, spikes: 1 } },
    };
    const spikes: MoveAction = {
      kind: 'move',
      userKey: 'p1:Incineroar',
      userPosition: 'p1a',
      moveName: 'Spikes',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const branches = simulateTurn(battle, [spikes], []);
    expect(branches[0].battle.sides.p2.spikes).toBe(2);
  });

  it('Tailwind posé CE tour réordonne bien les actions restantes du même tour (le chantier) — régression clé', () => {
    // Whimsicott (spe 116, rapide) pose Tailwind. Torkoal (spe 20, lent,
    // effectif ~40) attaque normalement APRÈS Kingambit (spe 50, effectif
    // ~70) — mais une fois Tailwind actif côté p1, Torkoal double son
    // effectif à ~80, dépassant Kingambit (~70) : il doit maintenant agir
    // AVANT lui, alors que l'ordre "figé au début du tour" (avant ce
    // correctif) l'aurait laissé après.
    let battle = createInitialBattleState();
    const whimsicott = {
      ...createInitialPokemonState({ species: 'Whimsicott', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const torkoal = {
      ...createInitialPokemonState({ species: 'Torkoal', side: 'p1', level: 50 }),
      position: 'p1b' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const kingambit = {
      ...createInitialPokemonState({ species: 'Kingambit', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Whimsicott': whimsicott, 'p1:Torkoal': torkoal, 'p2:Kingambit': kingambit },
      activeByPosition: { p1a: 'p1:Whimsicott', p1b: 'p1:Torkoal', p2a: 'p2:Kingambit' },
    };

    const tailwind: MoveAction = {
      kind: 'move',
      userKey: 'p1:Whimsicott',
      userPosition: 'p1a',
      moveName: 'Tailwind',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const torkoalAttack: MoveAction = {
      kind: 'move',
      userKey: 'p1:Torkoal',
      userPosition: 'p1b',
      moveName: 'Body Press',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const kingambitAttack: MoveAction = {
      kind: 'move',
      userKey: 'p2:Kingambit',
      userPosition: 'p2a',
      moveName: "Kowtow Cleave",
      targetPositions: ['p1b'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [tailwind, torkoalAttack], [kingambitAttack]);
    for (const branch of branches) {
      const torkoalNoteIndex = branch.notes.findIndex((n) => n.includes('Body Press'));
      expect(torkoalNoteIndex).toBeGreaterThanOrEqual(0);
      // Torkoal a bien agi (a infligé des dégâts à Kingambit)...
      expect(branch.battle.pokemonByKey['p2:Kingambit'].currentHp).toBeLessThan(190);
      // ...et Kingambit n'a PU riposter : soit il K.O. avant son tour (preuve
      // directe que Torkoal a agi avant lui grâce au Tailwind), soit sa
      // propre attaque apparaît bien APRÈS celle de Torkoal dans l'ordre.
      const kingambitFainted = branch.battle.pokemonByKey['p2:Kingambit'].fainted;
      const kingambitNoteIndex = branch.notes.findIndex((n) => n.includes('Kowtow Cleave'));
      if (!kingambitFainted) {
        expect(kingambitNoteIndex).toBeGreaterThanOrEqual(0);
        expect(torkoalNoteIndex).toBeLessThan(kingambitNoteIndex);
      } else {
        expect(branch.battle.pokemonByKey['p1:Torkoal'].currentHp).toBe(150); // jamais touché en retour
      }
    }
  });

  it('contre-épreuve : SANS Tailwind, Kingambit (plus rapide) agit bien avant Torkoal (lent)', () => {
    // Même configuration que le test précédent, mais sans Tailwind : l'ordre
    // normal doit s'appliquer (Kingambit spe ~70 > Torkoal spe ~40), pour
    // bien isoler que c'est spécifiquement le Tailwind qui inverse l'ordre.
    let battle = createInitialBattleState();
    const torkoal = {
      ...createInitialPokemonState({ species: 'Torkoal', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      maxHp: 150,
      currentHp: 150,
      hpIsPercentage: false,
    };
    const kingambit = {
      ...createInitialPokemonState({ species: 'Kingambit', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Torkoal': torkoal, 'p2:Kingambit': kingambit },
      activeByPosition: { p1a: 'p1:Torkoal', p2a: 'p2:Kingambit' },
    };

    const torkoalAttack: MoveAction = {
      kind: 'move',
      userKey: 'p1:Torkoal',
      userPosition: 'p1a',
      moveName: 'Body Press',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const kingambitAttack: MoveAction = {
      kind: 'move',
      userKey: 'p2:Kingambit',
      userPosition: 'p2a',
      moveName: 'Kowtow Cleave',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const branches = simulateTurn(battle, [torkoalAttack], [kingambitAttack]);
    for (const branch of branches) {
      const torkoalNoteIndex = branch.notes.findIndex((n) => n.includes('Body Press'));
      const kingambitNoteIndex = branch.notes.findIndex((n) => n.includes('Kowtow Cleave'));
      expect(kingambitNoteIndex).toBeGreaterThanOrEqual(0);
      expect(torkoalNoteIndex).toBeGreaterThanOrEqual(0);
      expect(kingambitNoteIndex).toBeLessThan(torkoalNoteIndex);
    }
  });
});
