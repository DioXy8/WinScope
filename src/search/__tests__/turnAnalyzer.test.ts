import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { analyzeActionsForPosition, compareActualActionToAlternatives } from '../turnAnalyzer';
import type { BattleState } from '../../engine/state';
import type { MoveAction } from '../actionTypes';

function setupLethalScenario(): BattleState {
  let battle = createInitialBattleState();

  const garchomp = {
    ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
    position: 'p1a' as const,
    revealedMoves: ['Earthquake', 'Protect'],
    maxHp: 190,
    currentHp: 190,
    hpIsPercentage: false,
  };
  const incineroar = {
    ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
    position: 'p2a' as const,
    revealedMoves: ['Flare Blitz'],
    maxHp: 190,
    currentHp: 20,
    hpIsPercentage: false,
  };

  battle = {
    ...battle,
    pokemonByKey: {
      'p1:Garchomp': garchomp,
      'p2:Incineroar': incineroar,
    },
    activeByPosition: {
      p1a: 'p1:Garchomp',
      p2a: 'p2:Incineroar',
    },
  };

  return battle;
}

describe('analyzeActionsForPosition', () => {
  it('ranks a lethal move (Earthquake) above Protect when a KO is available', () => {
    const battle = setupLethalScenario();
    const scores = analyzeActionsForPosition(battle, 'p1a', null);

    const earthquakeScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Earthquake');
    const protectScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Protect');

    expect(earthquakeScore).toBeDefined();
    expect(protectScore).toBeDefined();
    expect(earthquakeScore!.winExpectancy).toBeGreaterThan(protectScore!.winExpectancy);
  });

  it('returns scores between 0 and 100', () => {
    const battle = setupLethalScenario();
    const scores = analyzeActionsForPosition(battle, 'p1a', null);
    for (const s of scores) {
      expect(s.winExpectancy).toBeGreaterThanOrEqual(0);
      expect(s.winExpectancy).toBeLessThanOrEqual(100);
    }
  });

  it('considers at least one opponent response per candidate', () => {
    const battle = setupLethalScenario();
    const scores = analyzeActionsForPosition(battle, 'p1a', null);
    for (const s of scores) {
      expect(s.opponentResponsesConsidered).toBeGreaterThan(0);
    }
  });
});

describe('compareActualActionToAlternatives', () => {
  it('identifies the actually-played action within the ranking', () => {
    const battle = setupLethalScenario();
    const actualAction: MoveAction = {
      kind: 'move',
      userKey: 'p1:Garchomp',
      userPosition: 'p1a',
      moveName: 'Protect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const { actualActionScore, bestScore } = compareActualActionToAlternatives(
      battle,
      'p1a',
      actualAction,
      null,
    );

    expect(actualActionScore).not.toBeNull();
    expect(bestScore).not.toBeNull();
    expect(bestScore!.winExpectancy).toBeGreaterThanOrEqual(actualActionScore!.winExpectancy);
  });

  it('returns null actualActionScore if the action is not in the candidate list (e.g. unrevealed move)', () => {
    const battle = setupLethalScenario();
    const unknownAction: MoveAction = {
      kind: 'move',
      userKey: 'p1:Garchomp',
      userPosition: 'p1a',
      moveName: 'Stone Edge',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const { actualActionScore } = compareActualActionToAlternatives(battle, 'p1a', unknownAction, null);
    expect(actualActionScore).toBeNull();
  });
});
