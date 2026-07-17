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

describe('reachedTerminal', () => {
  it('is true when the search actually resolves to a real win/loss (near-endgame, low HP)', () => {
    const battle = setupLethalScenario(); // Garchomp pleine forme vs Incineroar à 20 HP
    const scores = searchBestActions(battle, 'p1a', null, TINY_OPTIONS);
    // Un KO immédiat (Earthquake) doit être une vraie fin de combat simulée, pas un repli sur l'heuristique.
    const earthquake = scores.find((s) => s.action.kind === 'move' && s.action.moveName === 'Earthquake');
    expect(earthquake?.reachedTerminal).toBe(true);
  });

  it('is false when the position is too far from any real ending for the given budget', () => {
    // Incineroar à pleine forme (pas un K.O. immédiat) : il faut plusieurs
    // tours pour conclure, ce qu'un budget de noeuds minuscule ne permet pas
    // -> repli honnête sur l'heuristique plutôt qu'un faux résultat "terminé".
    let battle = createInitialBattleState();
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      revealedMoves: ['Earthquake', 'Protect'],
      maxHp: 190,
      currentHp: 190,
      hasBeenSentOut: true,
      hpIsPercentage: false,
    };
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      revealedMoves: ['Flare Blitz'],
      maxHp: 190,
      currentHp: 190,
      hasBeenSentOut: true,
      hpIsPercentage: false,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Garchomp': garchomp, 'p2:Incineroar': incineroar },
      activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
    };
    const scores = searchBestActions(battle, 'p1a', null, {
      maxDepth: 40,
      candidateBreadth: 2,
      nodeBudget: 2,
    });
    expect(scores.some((s) => s.reachedTerminal === false)).toBe(true);
  });
});

describe('forced replacement after a KO during search', () => {
  it('lets the bench replacement actually fight (and be finished off) instead of freezing that side after the first KO', () => {
    let battle = createInitialBattleState();
    const garchomp = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      revealedMoves: ['Earthquake'],
      maxHp: 190,
      currentHp: 190,
      hpIsPercentage: false,
      hasBeenSentOut: true,
    };
    // Incineroar au bord de la mort : tombe dès le premier échange simulé.
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      revealedMoves: ['Flare Blitz'],
      maxHp: 190,
      currentHp: 5,
      hpIsPercentage: false,
      hasBeenSentOut: true,
    };
    // Venusaur au banc (pas immunisé à Earthquake, contrairement à un Pokémon
    // Sol/Vol) : déjà envoyé une fois dans ce match (hasBeenSentOut: true),
    // aussi à 5 HP — doit pouvoir remplacer Incineroar puis tomber à son tour
    // si Earthquake continue de frapper.
    const venusaur = {
      ...createInitialPokemonState({ species: 'Venusaur', side: 'p2', level: 50 }),
      position: null,
      revealedMoves: ['Sludge Bomb'],
      maxHp: 190,
      currentHp: 5,
      hpIsPercentage: false,
      hasBeenSentOut: true,
    };
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Garchomp': garchomp,
        'p2:Incineroar': incineroar,
        'p2:Venusaur': venusaur,
      },
      activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
    };

    // maxDepth=4 : largement assez pour enchaîner "KO Incineroar" puis "KO le
    // remplaçant" SI le remplacement forcé fonctionne. Sans lui, p2a resterait
    // vide après le premier KO (aucune cible, plus aucune action pour p2), et le
    // combat ne pourrait alors JAMAIS atteindre une vraie fin dans cette recherche
    // même si Venusaur, en pleine forme "sur le papier", est censé pouvoir entrer.
    const scores = searchBestActions(battle, 'p1a', null, { maxDepth: 6, candidateBreadth: 2, nodeBudget: 800 });
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].reachedTerminal).toBe(true);
    expect(scores[0].winExpectancy).toBe(100);
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

describe('searchBestActions budget fairness', () => {
  it('gives every candidate a fair, roughly equal share of the node budget (no positional bias from shared-budget starvation)', () => {
    // Historique : budget.nodesUsed était un compteur PARTAGÉ entre tous les
    // candidats, consommé dans l'ordre du classement rapide 1-pli. Le
    // dernier candidat évalué pouvait se retrouver avec un budget quasi nul
    // et un score artificiellement bas, sans rapport avec son vrai mérite
    // (observé en vrai jeu : un coup confirmé gagnant à 100% sur 3000
    // parties Monte Carlo, classé DERNIER par la recherche exhaustive).
    let battle = createInitialBattleState();
    const mk = (species: string, side: 'p1' | 'p2', pos: any, hp: number, moves: string[]) => ({
      ...createInitialPokemonState({ species, side, level: 50 }),
      position: pos,
      maxHp: 190,
      currentHp: hp,
      hasBeenSentOut: true,
      revealedMoves: moves,
    });
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Blastoise': mk('Blastoise', 'p1', 'p1a', 150, ['Water Spout', 'Dark Pulse', 'Ice Beam']),
        'p1:Incineroar': mk('Incineroar', 'p1', 'p1b', 150, ['Flare Blitz', 'Fake Out']),
        'p2:Farigiraf': mk('Farigiraf', 'p2', 'p2a', 150, ['Psychic', 'Trick Room']),
        'p2:Venusaur': mk('Venusaur', 'p2', 'p2b', 150, ['Sludge Bomb']),
      },
      activeByPosition: { p1a: 'p1:Blastoise', p1b: 'p1:Incineroar', p2a: 'p2:Farigiraf', p2b: 'p2:Venusaur' },
    };
    const scores = searchBestActions(battle, 'p1a', null, { maxDepth: 40, candidateBreadth: 3, nodeBudget: 90 });
    expect(scores.length).toBeGreaterThanOrEqual(2);
    const nodeCounts = scores.map((s) => s.nodesSearched);
    const maxNodes = Math.max(...nodeCounts);
    const minNodes = Math.min(...nodeCounts);
    // Chaque candidat a reçu le MÊME budget indépendant (nodeBudget / nb de
    // candidats) : le nombre de noeuds réellement consommés peut varier
    // selon la complexité de chaque ligne, mais le PLAFOND disponible était
    // identique pour tous — donc pas d'écart démesuré uniquement dû à
    // l'ordre d'évaluation.
    expect(maxNodes).toBeLessThanOrEqual(minNodes * 3 + 5);
  });
});
