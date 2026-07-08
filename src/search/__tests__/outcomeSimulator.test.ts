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
});
