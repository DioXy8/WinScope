import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { estimateWinProbability } from '../evaluator';

describe('estimateWinProbability', () => {
  it('returns 50 for two full-HP, identical sides', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 100 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(50);
  });

  it('favors the side with more remaining HP', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 20 },
      },
    };
    expect(estimateWinProbability(battle)).toBeGreaterThan(50);
  });

  it('returns 99 when the opposing side has no pokemon left', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), fainted: true, currentHp: 0 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(100);
  });

  it('returns 1 when our side has no pokemon left', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), fainted: true, currentHp: 0 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 100 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(0);
  });

  it('never returns exactly 0 or 100 while pokemon remain on both sides', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 1 },
      },
    };
    const result = estimateWinProbability(battle);
    expect(result).toBeLessThanOrEqual(99);
    expect(result).toBeGreaterThanOrEqual(1);
  });
});
