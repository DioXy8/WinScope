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
});
