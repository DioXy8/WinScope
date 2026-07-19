import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { analyzeActionsForPosition, compareActualActionToAlternatives, getBestWinExpectancyForSide } from '../turnAnalyzer';
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

describe('scoreAction opponent-response weighting', () => {
  it('does not let harmless opponent status moves dilute a genuinely lethal threat in the average', () => {
    // Avant le correctif, les réponses adverses échantillonnées étaient
    // moyennées à POIDS ÉGAL : un Flare Blitz qui achève Garchomp et
    // plusieurs moves de statut inoffensifs pesaient pareil, diluant
    // fortement le vrai risque. Protect doit rester nettement meilleur
    // qu'une attaque qui laisse Garchomp exposé à ce Flare Blitz.
    let battle = createInitialBattleState();
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      revealedMoves: ['Dragon Claw', 'Protect'],
      maxHp: 190,
      currentHp: 60, // assez bas pour que Flare Blitz soit clairement fatal
      hpIsPercentage: false,
    };
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      revealedMoves: ['Flare Blitz', 'Will-O-Wisp', 'Taunt', 'Parting Shot'],
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Garchomp': garchomp, 'p2:Incineroar': incineroar },
      activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
    };

    const scores = analyzeActionsForPosition(battle, 'p1a', null);
    const dragonClawScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Dragon Claw');
    const protectScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Protect');

    expect(dragonClawScore).toBeDefined();
    expect(protectScore).toBeDefined();
    expect(protectScore!.winExpectancy).toBeGreaterThan(dragonClawScore!.winExpectancy);
    // La marge doit être substantielle — pas juste un léger avantage —
    // puisque le danger réel (Flare Blitz fatal) doit maintenant dominer
    // la moyenne plutôt que d'être noyé par 3 moves de statut inoffensifs.
    expect(protectScore!.winExpectancy - dragonClawScore!.winExpectancy).toBeGreaterThan(10);
  });
});

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

describe('getBestWinExpectancyForSide', () => {
  it('returns a single-position score when only one pokemon is active', () => {
    let battle = setupLethalScenario();
    battle = {
      ...battle,
      activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
    };
    const result = getBestWinExpectancyForSide(battle, 'p1');
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(50); // Earthquake OHKO dispo
  });

  it('returns null if the side has no active pokemon at all', () => {
    const battle = createInitialBattleState();
    const result = getBestWinExpectancyForSide(battle, 'p1');
    expect(result).toBeNull();
  });

  it('falls back to the heuristic estimate when no revealed moves are available', () => {
    let battle = createInitialBattleState();
    const klefki = {
      ...createInitialPokemonState({ species: 'Klefki', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      revealedMoves: [],
    };
    const opponent = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      revealedMoves: [],
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Klefki': klefki, 'p2:Incineroar': opponent },
      activeByPosition: { p1a: 'p1:Klefki', p2a: 'p2:Incineroar' },
    };
    // Aucun move révélé pour ce seul actif -> analyzeActionsForPosition retourne [] -> null
    // (c'est à l'appelant, ici l'UI, de retomber sur l'heuristique brute dans ce cas).
    const result = getBestWinExpectancyForSide(battle, 'p1');
    expect(result).toBeNull();
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
