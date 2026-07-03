import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import {
  generateMoveActions,
  generateSwitchActions,
  getMoveTargetInfo,
  resolveMoveTargets,
} from '../actionGenerator';
import type { BattleState } from '../../engine/state';

function setupDoublesBattle(): BattleState {
  let battle = createInitialBattleState();

  const p1a = {
    ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
    position: 'p1a' as const,
    hasBeenSentOut: true,
    revealedMoves: ['Fake Out', 'Flare Blitz', 'Protect'],
  };
  const p1b = {
    ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
    position: 'p1b' as const,
    hasBeenSentOut: true,
    revealedMoves: ['Earthquake', 'Protect'],
  };
  const p2a = {
    ...createInitialPokemonState({ species: 'Grimmsnarl', side: 'p2', level: 50 }),
    position: 'p2a' as const,
    hasBeenSentOut: true,
    revealedMoves: ['Spirit Break'],
  };
  const p2b = {
    ...createInitialPokemonState({ species: 'Tornadus', side: 'p2', level: 50 }),
    position: 'p2b' as const,
    hasBeenSentOut: true,
    revealedMoves: ['Tailwind'],
  };

  // Membre du banc RÉELLEMENT déjà amené ce combat (déjà vu sur le
  // terrain à un tour précédent, juste pas actif maintenant) — distinct
  // d'un Pokémon seulement annoncé en Team Preview mais jamais envoyé.
  const p1Bench = {
    ...createInitialPokemonState({ species: 'Flutter Mane', side: 'p1', level: 50 }),
    hasBeenSentOut: true,
  };

  battle = {
    ...battle,
    pokemonByKey: {
      'p1:Incineroar': p1a,
      'p1:Garchomp': p1b,
      'p1:Flutter Mane': p1Bench,
      'p2:Grimmsnarl': p2a,
      'p2:Tornadus': p2b,
    },
    activeByPosition: {
      p1a: 'p1:Incineroar',
      p1b: 'p1:Garchomp',
      p2a: 'p2:Grimmsnarl',
      p2b: 'p2:Tornadus',
    },
  };

  return battle;
}

describe('getMoveTargetInfo', () => {
  it('returns correct target type for a spread move', () => {
    expect(getMoveTargetInfo('Earthquake')?.target).toBe('allAdjacent');
  });

  it('returns correct target type for a self move', () => {
    expect(getMoveTargetInfo('Protect')?.target).toBe('self');
  });

  it('returns correct target type for a foe-spread move', () => {
    expect(getMoveTargetInfo('Dazzling Gleam')?.target).toBe('allAdjacentFoes');
  });

  it('returns null for an unknown move', () => {
    expect(getMoveTargetInfo('Definitely Not A Move')).toBeNull();
  });
});

describe('resolveMoveTargets', () => {
  const battle = setupDoublesBattle();

  it('resolves allAdjacent (Earthquake) to every other active pokemon', () => {
    const targets = resolveMoveTargets(battle, 'p1b', 'Earthquake');
    expect(targets).toHaveLength(1);
    expect(targets[0].sort()).toEqual(['p1a', 'p2a', 'p2b'].sort());
  });

  it('resolves a single-target normal move into one option per valid target', () => {
    const targets = resolveMoveTargets(battle, 'p1a', 'Flare Blitz');
    expect(targets.length).toBe(3);
    for (const t of targets) {
      expect(t).toHaveLength(1);
    }
  });

  it('resolves a self-targeting move (Protect) to an empty target list', () => {
    const targets = resolveMoveTargets(battle, 'p1a', 'Protect');
    expect(targets).toEqual([[]]);
  });

  it('resolves allySide move (Tailwind) to an empty target list', () => {
    const targets = resolveMoveTargets(battle, 'p2b', 'Tailwind');
    expect(targets).toEqual([[]]);
  });
});

describe('generateMoveActions', () => {
  it('generates one action per (move, target) combination for a multi-target-option move', () => {
    const battle = setupDoublesBattle();
    const actions = generateMoveActions(battle, 'p1a');

    const fakeOutActions = actions.filter((a) => a.moveName === 'Fake Out');
    const protectActions = actions.filter((a) => a.moveName === 'Protect');

    expect(fakeOutActions.length).toBe(3);
    expect(protectActions.length).toBe(1);
    expect(protectActions[0].targetPositions).toEqual([]);
  });

  it('generates a single spread action for Earthquake regardless of active count', () => {
    const battle = setupDoublesBattle();
    const actions = generateMoveActions(battle, 'p1b');
    const eqActions = actions.filter((a) => a.moveName === 'Earthquake');
    expect(eqActions).toHaveLength(1);
    expect(eqActions[0].targetPositions.sort()).toEqual(['p1a', 'p2a', 'p2b'].sort());
  });

  it('inclut les moves du PokéPaste exact ("known") pas encore joués en combat, avec moveSource: "known"', () => {
    let battle = setupDoublesBattle();
    const incineroarKey = 'p1:Incineroar';
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        [incineroarKey]: {
          ...battle.pokemonByKey[incineroarKey],
          userProvidedSet: {
            ability: null,
            item: null,
            nature: 'Careful',
            evs: {},
            ivs: {},
            teraType: null,
            moves: ['Fake Out', 'Flare Blitz', 'Throat Chop', 'Parting Shot'],
          },
        },
      },
    };
    const actions = generateMoveActions(battle, 'p1a');
    const throatChop = actions.filter((a) => a.moveName === 'Throat Chop');
    expect(throatChop.length).toBeGreaterThan(0);
    expect(throatChop[0].moveSource).toBe('known');

    const fakeOut = actions.filter((a) => a.moveName === 'Fake Out');
    expect(fakeOut[0].moveSource).toBe('revealed'); // déjà dans revealedMoves du fixture
  });

  it('inclut les moves du set de référence NCP deviné ("guessed") en l’absence de userProvidedSet', () => {
    let battle = setupDoublesBattle();
    // Remplace Garchomp (fixture) par Swampert, qui a un set de référence NCP catalogué.
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Garchomp': undefined as any,
        'p1:Swampert': {
          ...createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }),
          position: 'p1b' as const,
          hasBeenSentOut: true,
          revealedMoves: [],
        },
      },
      activeByPosition: { ...battle.activeByPosition, p1b: 'p1:Swampert' },
    };
    delete battle.pokemonByKey['p1:Garchomp'];

    const actions = generateMoveActions(battle, 'p1b');
    const waveCrash = actions.filter((a) => a.moveName === 'Wave Crash');
    expect(waveCrash.length).toBeGreaterThan(0);
    expect(waveCrash[0].moveSource).toBe('guessed');
  });

  it('returns no actions for a fainted pokemon', () => {
    let battle = setupDoublesBattle();
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Incineroar': { ...battle.pokemonByKey['p1:Incineroar'], fainted: true },
      },
    };
    expect(generateMoveActions(battle, 'p1a')).toEqual([]);
  });

  it('respects Choice item lock to the last used move', () => {
    let battle = setupDoublesBattle();
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Incineroar': {
          ...battle.pokemonByKey['p1:Incineroar'],
          revealedItem: 'Choice Band',
          revealedMoves: ['Fake Out', 'Flare Blitz', 'Protect'],
        },
      },
    };
    const actions = generateMoveActions(battle, 'p1a');
    const moveNames = new Set(actions.map((a) => a.moveName));
    expect(moveNames.size).toBe(1);
    expect(moveNames.has('Protect')).toBe(true);
  });
});

describe('generateSwitchActions', () => {
  it('lists every non-active, non-fainted bench pokemon of the same side', () => {
    const battle = setupDoublesBattle();
    const switches = generateSwitchActions(battle, 'p1a');
    expect(switches).toHaveLength(1);
    expect(switches[0].incomingKey).toBe('p1:Flutter Mane');
  });

  it('returns no switches if the pokemon is trapped', () => {
    let battle = setupDoublesBattle();
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Incineroar': {
          ...battle.pokemonByKey['p1:Incineroar'],
          volatiles: new Set(['Trapped']),
        },
      },
    };
    expect(generateSwitchActions(battle, 'p1a')).toEqual([]);
  });

  it('does not include fainted bench pokemon', () => {
    let battle = setupDoublesBattle();
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Flutter Mane': { ...battle.pokemonByKey['p1:Flutter Mane'], fainted: true },
      },
    };
    expect(generateSwitchActions(battle, 'p1a')).toEqual([]);
  });

  it('ne propose PAS un Pokémon seulement annoncé en Team Preview mais jamais réellement envoyé (Reg M-B "bring 6, pick 4")', () => {
    // Régression : initBattleStateFromReplay pré-remplit pokemonByKey avec
    // les 6 Pokémon de Team Preview par côté, alors que seuls 4 sont
    // réellement amenés en combat. Sans le filtre hasBeenSentOut, ces 2
    // "fantômes" (jamais fainted, jamais actifs) apparaissaient comme des
    // switches valides pour toujours.
    let battle = setupDoublesBattle();
    battle = {
      ...battle,
      pokemonByKey: {
        ...battle.pokemonByKey,
        'p1:Dragonite': createInitialPokemonState({ species: 'Dragonite', side: 'p1', level: 50 }), // hasBeenSentOut: false par défaut
      },
    };
    const switches = generateSwitchActions(battle, 'p1a');
    expect(switches.map((s) => s.incomingKey)).toEqual(['p1:Flutter Mane']);
    expect(switches.some((s) => s.incomingKey === 'p1:Dragonite')).toBe(false);
  });
});
