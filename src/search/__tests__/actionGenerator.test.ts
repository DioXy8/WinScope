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
    revealedMoves: ['Fake Out', 'Flare Blitz', 'Protect'],
  };
  const p1b = {
    ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
    position: 'p1b' as const,
    revealedMoves: ['Earthquake', 'Protect'],
  };
  const p2a = {
    ...createInitialPokemonState({ species: 'Grimmsnarl', side: 'p2', level: 50 }),
    position: 'p2a' as const,
    revealedMoves: ['Spirit Break'],
  };
  const p2b = {
    ...createInitialPokemonState({ species: 'Tornadus', side: 'p2', level: 50 }),
    position: 'p2b' as const,
    revealedMoves: ['Tailwind'],
  };

  const p1Bench = createInitialPokemonState({ species: 'Flutter Mane', side: 'p1', level: 50 });

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
});
