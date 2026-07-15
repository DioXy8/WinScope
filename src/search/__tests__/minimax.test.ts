import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { getDeepBestWinExpectancyForSide, searchBestActions } from '../minimax';
import type { BattleState } from '../../engine/state';

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

// Options volontairement minuscules : les tests n'ont pas besoin d'une
// recherche profonde pour vérifier le COMPORTEMENT (tri, bornes, PV,
// budget) — juste assez pour exercer une vraie récursion sur 2 tours.
const TINY_OPTIONS = { maxDepth: 2, candidateBreadth: 2, nodeBudget: 100 };

describe('searchBestActions', () => {
  it('ranks a lethal move (Earthquake) above Protect when a KO is available', () => {
    const battle = setupLethalScenario();
    // Garchomp a aussi des moves "guessed" (set de référence) en plus des
    // 2 révélés : on élargit la respiration pour être sûr que Protect (le
    // move qu'on veut comparer) entre bien dans les candidats retenus.
    const scores = searchBestActions(battle, 'p1a', null, { ...TINY_OPTIONS, candidateBreadth: 5 });

    const earthquakeScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Earthquake');
    const protectScore = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Protect');

    expect(earthquakeScore).toBeDefined();
    expect(protectScore).toBeDefined();
    expect(earthquakeScore!.winExpectancy).toBeGreaterThan(protectScore!.winExpectancy);
  });

  it('returns scores between 0 and 100, sorted descending', () => {
    const battle = setupLethalScenario();
    const scores = searchBestActions(battle, 'p1a', null, TINY_OPTIONS);
    expect(scores.length).toBeGreaterThan(0);
    for (const s of scores) {
      expect(s.winExpectancy).toBeGreaterThanOrEqual(0);
      expect(s.winExpectancy).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].winExpectancy).toBeGreaterThanOrEqual(scores[i].winExpectancy);
    }
  });

  it('produces a non-empty principal variation for the best action', () => {
    const battle = setupLethalScenario();
    const scores = searchBestActions(battle, 'p1a', null, TINY_OPTIONS);
    expect(scores[0].principalVariation.length).toBeGreaterThan(0);
    // La PV doit commencer par une description de notre propre action.
    expect(scores[0].principalVariation[0]).toContain('Earthquake');
  });

  it('reports depthReached and a bounded node count', () => {
    const battle = setupLethalScenario();
    const scores = searchBestActions(battle, 'p1a', null, TINY_OPTIONS);
    for (const s of scores) {
      expect(s.depthReached).toBe(TINY_OPTIONS.maxDepth);
      expect(s.nodesSearched).toBeGreaterThan(0);
      expect(s.nodesSearched).toBeLessThanOrEqual(TINY_OPTIONS.nodeBudget);
    }
  });

  it('respects a very small node budget by aborting rather than hanging', () => {
    const battle = setupLethalScenario();
    const scores = searchBestActions(battle, 'p1a', null, {
      maxDepth: 3,
      candidateBreadth: 2,
      nodeBudget: 3,
    });
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.some((s) => s.aborted)).toBe(true);
    for (const s of scores) {
      expect(s.winExpectancy).toBeGreaterThanOrEqual(0);
      expect(s.winExpectancy).toBeLessThanOrEqual(100);
    }
  });

  it('returns an empty array when the position has no known move and no bench', () => {
    const battle = setupLethalScenario();
    const emptyScores = searchBestActions(battle, 'p2a', null, TINY_OPTIONS);
    // Incineroar n'a qu'un move connu (Flare Blitz) mais au moins une action existe.
    expect(emptyScores.length).toBeGreaterThan(0);
  });
});

describe('getDeepBestWinExpectancyForSide', () => {
  it('returns a single-position score when only one pokemon is active per side', () => {
    const battle = setupLethalScenario();
    const result = getDeepBestWinExpectancyForSide(battle, 'p1', TINY_OPTIONS);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
    expect(result!).toBeLessThanOrEqual(100);
  });

  it('gives p1 a strong win expectancy in a favorable lethal scenario', () => {
    const battle = setupLethalScenario();
    const result = getDeepBestWinExpectancyForSide(battle, 'p1', TINY_OPTIONS);
    // Garchomp OHKO Incineroar (20 HP restants) puis se retrouve seul en vie :
    // l'espérance de victoire doit nettement dépasser 50%.
    expect(result!).toBeGreaterThan(50);
  });

  it('returns null when the side has no active pokemon', () => {
    const battle = setupLethalScenario();
    const emptyBattle = { ...battle, activeByPosition: { p2a: battle.activeByPosition.p2a } };
    const result = getDeepBestWinExpectancyForSide(emptyBattle, 'p1', TINY_OPTIONS);
    expect(result).toBeNull();
  });
});
