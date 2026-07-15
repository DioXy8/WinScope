/**
 * search/minimax.ts
 *
 * Recherche adversariale multi-tours : c'est ce module qui fait du
 * calculateur quelque chose qui se rapproche d'un moteur façon Stockfish,
 * plutôt que la simple heuristique 1-pli de turnAnalyzer.ts.
 *
 * Ce que turnAnalyzer.ts fait (et continue de faire, on ne le supprime
 * pas — il sert de brique de base ici) : pour un tour donné, il simule
 * l'action candidate contre quelques réponses adverses échantillonnées, et
 * fait la MOYENNE pondérée des résultats. Deux limites documentées dans ce
 * fichier avant ce module :
 *   1. Horizon d'un seul tour : un Calm Mind qui ne paie qu'au tour 3
 *      n'était jamais reconnu comme bon.
 *   2. Réponse adverse "moyenne" plutôt qu'adversariale : on ne supposait
 *      pas l'adversaire plus malin qu'un autre choix.
 *
 * Ce module change les deux :
 *   1. MULTI-TOURS : recherche récursive sur `maxDepth` tours complets,
 *      pas un seul.
 *   2. ADVERSARIAL (noeud MIN) : à chaque tour simulé, on suppose que
 *      l'adversaire choisit, PARMI SES RÉPONSES PLAUSIBLES, celle qui
 *      MINIMISE notre espérance de victoire — un vrai noeud MIN de
 *      minimax, pas une moyenne.
 *   3. ÉLAGAGE ALPHA-BETA : classique, pour éviter d'explorer des branches
 *      qui ne peuvent plus changer la décision au noeud parent.
 *   4. ORDONNANCEMENT DE COUPS (move ordering) : comme un moteur
 *      d'échecs qui essaie d'abord les coups qui SEMBLENT bons pour couper
 *      plus de branches plus tôt, on utilise le classement rapide 1-pli de
 *      turnAnalyzer.analyzeActionsForPosition pour choisir quelles actions
 *      valent la peine d'être explorées en profondeur (candidateBreadth),
 *      plutôt que la combinatoire complète.
 *   5. BUDGET DE NOEUDS : la combinatoire (2 Pokémon actifs par camp, 1-2
 *      tours de profondeur, branches de hasard à chaque tour) explose vite
 *      dans un navigateur. Passé `nodeBudget` simulations de tour, la
 *      recherche s'arrête et retourne le meilleur résultat trouvé jusque
 *      là (marqué `aborted: true`) — l'équivalent d'une gestion du temps
 *      façon moteur d'échecs : mieux vaut un résultat un peu moins profond
 *      qu'un onglet qui gèle.
 *
 * CE QUE CE MODULE N'EST TOUJOURS PAS : un vrai solveur d'équilibre de
 * Nash pour jeu à choix simultanés. En VGC réel, les 2 camps choisissent
 * en fait EN MÊME TEMPS, sans voir le choix de l'autre — la vraie théorie
 * des jeux demanderait des stratégies mixtes. On approxime ici avec un
 * MAXIMIN séquentiel (nous choisissons en supposant la pire réponse
 * adverse plausible) : une approximation standard, beaucoup plus proche de
 * "jouer contre un adversaire compétent" que la moyenne uniforme d'avant,
 * mais pas l'optimum théorique exact d'un jeu à information imparfaite.
 */

import type { BattleState } from '../engine/state';
import type { PokemonPosition } from '../replay/types';
import type { PlayerAction } from './actionTypes';
import { analyzeActionsForPosition } from './turnAnalyzer';
import { generateActionsForPosition } from './actionGenerator';
import { simulateTurn } from './outcomeSimulator';
import { estimateWinProbability } from './evaluator';

export interface SearchOptions {
  /** Nombre de tours complets explorés en profondeur, réponse adverse comprise. 1 = comme avant mais adversarial au lieu d'uniforme. */
  maxDepth: number;
  /** Combien des meilleures actions (classées par l'heuristique 1-pli) sont retenues par Pokémon actif, à chaque noeud — le "move ordering". */
  candidateBreadth: number;
  /** Coupe-circuit : nombre max de tours simulés avant d'arrêter d'approfondir et de retomber sur le meilleur trouvé jusque là. */
  nodeBudget: number;
  /**
   * Ordonnancement des réponses adverses À LA RACINE (le premier tour
   * analysé) : 'accurate' réutilise l'heuristique 1-pli complète de
   * turnAnalyzer (déjà coûteuse, simule elle-même plusieurs réponses) ;
   * 'fast' se contente de l'heuristique bon marché sans simulation. Les
   * noeuds plus profonds utilisent TOUJOURS 'fast' (cf. topCandidatesFast)
   * quel que soit ce réglage — celui-ci ne concerne que le tout premier
   * tour, celui qu'on affiche vraiment à l'utilisateur.
   */
  rootOpponentRanking: 'accurate' | 'fast';
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  maxDepth: 2,
  candidateBreadth: 3,
  nodeBudget: 300,
  rootOpponentRanking: 'accurate',
};

/** Version allégée des options, utilisée pour la courbe de tendance (calculée à CHAQUE tour du replay, donc doit rester rapide). */
export const FAST_TREND_SEARCH_OPTIONS: SearchOptions = {
  maxDepth: 1,
  candidateBreadth: 2,
  nodeBudget: 60,
  rootOpponentRanking: 'fast',
};

export interface DeepActionScore {
  action: PlayerAction;
  /** Espérance de victoire (0-100) pour le camp qui a choisi `action`, après recherche adversariale multi-tours. */
  winExpectancy: number;
  /** Ligne principale (Principal Variation) : notre action, la pire réponse adverse trouvée, puis la suite jugée la plus représentative. */
  principalVariation: string[];
  depthReached: number;
  nodesSearched: number;
  /** true si le budget de noeuds a coupé la recherche avant d'avoir tout exploré à la profondeur demandée. */
  aborted: boolean;
}

interface SearchBudget {
  nodesUsed: number;
  limit: number;
  aborted: boolean;
}

function activePositionsForSide(battle: BattleState, side: 'p1' | 'p2'): PokemonPosition[] {
  return (Object.keys(battle.activeByPosition) as PokemonPosition[]).filter((p) => p.startsWith(side));
}

function isTerminal(battle: BattleState): boolean {
  const alive = (side: 'p1' | 'p2') =>
    Object.values(battle.pokemonByKey).some((p) => p.side === side && !p.fainted);
  return !alive('p1') || !alive('p2');
}

function winForSide(battle: BattleState, side: 'p1' | 'p2'): number {
  const p1Win = estimateWinProbability(battle);
  return side === 'p1' ? p1Win : 100 - p1Win;
}

function describeActionCompact(action: PlayerAction): string {
  if (action.kind === 'switch') return `switch→${action.incomingKey}`;
  return action.targetPositions.length > 0
    ? `${action.moveName}→${action.targetPositions.join(',')}`
    : action.moveName;
}

/** Ordonnancement PRÉCIS mais COÛTEUX : classe les actions via l'heuristique 1-pli complète de turnAnalyzer (elle-même simule contre plusieurs réponses adverses). Réservé à la racine de la recherche (un seul appel, coût O(1) quel que soit maxDepth). */
function topCandidatesAccurate(
  battle: BattleState,
  position: PokemonPosition,
  fixedAlly: PlayerAction | null,
  breadth: number,
): PlayerAction[] {
  const ranked = analyzeActionsForPosition(battle, position, fixedAlly);
  return ranked.slice(0, breadth).map((s) => s.action);
}

/**
 * Ordonnancement APPROXIMATIF mais QUASI GRATUIT (aucune simulation) : pas
 * de score fin, juste une priorité grossière (attaque avec cible > move de
 * statut/soi > switch). Utilisé à TOUS les noeuds récursifs au-delà de la
 * racine — si on utilisait l'heuristique précise (topCandidatesAccurate,
 * qui simule déjà plusieurs réponses adverses en interne) à chaque noeud
 * d'une recherche multi-tours, le coût exploserait multiplicativement avec
 * la profondeur (mesuré : recherche à profondeur 2 sur un vrai combat 2v2
 * passant de quelques dizaines de ms à plusieurs SECONDES). Le
 * `nodeBudget` ne compte que les tours réellement simulés dans la
 * recherche elle-même — il ne protège pas contre un ordonnancement interne
 * coûteux à chaque noeud, d'où ce compromis explicite.
 */
function topCandidatesFast(battle: BattleState, position: PokemonPosition, breadth: number): PlayerAction[] {
  const all = generateActionsForPosition(battle, position);
  const priority = (a: PlayerAction) => (a.kind === 'switch' ? 0 : a.targetPositions.length > 0 ? 2 : 1);
  return [...all].sort((a, b) => priority(b) - priority(a)).slice(0, breadth);
}

/**
 * Combinaisons plausibles d'actions pour LES (1 ou 2) positions actives
 * d'un camp, classées pour ne retenir que les meilleures (candidateBreadth)
 * par position — le "move ordering" qui rend la recherche multi-tours
 * praticable. `mode: 'accurate'` (racine uniquement) tient compte de
 * chaque choix plausible du premier Pokémon pour classer le second (pour
 * ne pas rater une synergie, ex: Follow Me + attaque de zone) ; `mode:
 * 'fast'` (tous les noeuds plus profonds) ignore cette dépendance fine
 * pour rester bon marché.
 */
function jointCandidatesForSide(
  battle: BattleState,
  positions: PokemonPosition[],
  breadth: number,
  mode: 'accurate' | 'fast',
): PlayerAction[][] {
  if (positions.length === 0) return [[]];

  if (mode === 'fast') {
    const perPosition = positions.map((p) => topCandidatesFast(battle, p, breadth));
    if (perPosition.some((opts) => opts.length === 0)) {
      // Au moins une position sans action connue : on retombe sur celle(s) qui en ont, sans combiner.
      const nonEmpty = perPosition.find((opts) => opts.length > 0);
      return nonEmpty ? nonEmpty.map((a) => [a]) : [[]];
    }
    if (perPosition.length === 1) return perPosition[0].map((a) => [a]);
    const [firstOptions, secondOptions] = perPosition;
    const combos: PlayerAction[][] = [];
    for (const firstAction of firstOptions) {
      for (const secondAction of secondOptions) {
        combos.push([firstAction, secondAction]);
      }
    }
    return combos;
  }

  if (positions.length === 1) {
    const options = topCandidatesAccurate(battle, positions[0], null, breadth);
    return options.length > 0 ? options.map((a) => [a]) : [[]];
  }
  const [first, second] = positions;
  const firstOptions = topCandidatesAccurate(battle, first, null, breadth);
  if (firstOptions.length === 0) {
    const secondOptions = topCandidatesAccurate(battle, second, null, breadth);
    return secondOptions.length > 0 ? secondOptions.map((a) => [a]) : [[]];
  }
  const combos: PlayerAction[][] = [];
  for (const firstAction of firstOptions) {
    const secondOptions = topCandidatesAccurate(battle, second, firstAction, breadth);
    if (secondOptions.length === 0) {
      combos.push([firstAction]);
      continue;
    }
    for (const secondAction of secondOptions) {
      combos.push([firstAction, secondAction]);
    }
  }
  return combos;
}

/**
 * Évalue une combinaison d'actions déjà choisie pour `focalSide` : simule
 * le tour contre CHAQUE réponse adverse plausible (`oppCombos`), et
 * retient la PIRE (noeud MIN adversarial) — moyennée sur les branches de
 * hasard (accuracy/crit) de chacune, puis prolongée récursivement sur
 * `depthRemaining` tours suivants.
 */
function worstCaseForOwnActions(
  battle: BattleState,
  focalSide: 'p1' | 'p2',
  ownActions: PlayerAction[],
  oppCombos: PlayerAction[][],
  depthRemaining: number,
  budget: SearchBudget,
  options: SearchOptions,
): { value: number; pv: string[] } {
  let worst = Infinity;
  let worstPv: string[] = [];

  for (const oppActions of oppCombos) {
    if (budget.nodesUsed >= budget.limit) {
      budget.aborted = true;
      break;
    }
    budget.nodesUsed += 1;

    const p1Actions = focalSide === 'p1' ? ownActions : oppActions;
    const p2Actions = focalSide === 'p1' ? oppActions : ownActions;
    const branches = simulateTurn(battle, p1Actions, p2Actions);

    let branchValueSum = 0;
    let branchWeight = 0;
    let representativePv: string[] = [];
    for (const branch of branches) {
      const { value: futureValue, pv: futurePv } = searchValue(
        branch.battle,
        focalSide,
        depthRemaining - 1,
        -Infinity,
        worst, // beta = la pire valeur acceptée jusqu'ici pour cette action ; inutile de chercher plus profond si on la dépasse déjà en pire
        budget,
        options,
      );
      branchValueSum += futureValue * branch.probability;
      branchWeight += branch.probability;
      if (branch.probability >= 0.5 || representativePv.length === 0) {
        representativePv = futurePv;
      }
    }
    const turnValue = branchWeight > 0 ? branchValueSum / branchWeight : winForSide(battle, focalSide);

    if (turnValue < worst) {
      worst = turnValue;
      worstPv = [`(adv) ${oppActions.map(describeActionCompact).join(' + ') || 'pass'}`, ...representativePv];
    }
  }

  if (worst === Infinity) {
    worst = winForSide(battle, focalSide);
  }
  return { value: worst, pv: worstPv };
}

/**
 * Coeur récursif : valeur (pour `focalSide`, 0-100) d'un BattleState après
 * `depthRemaining` tours adversariaux supplémentaires. Alpha-beta : alpha
 * = meilleure valeur déjà garantie pour focalSide, beta = pire valeur que
 * l'adversaire laissera passer avant de couper.
 */
function searchValue(
  battle: BattleState,
  focalSide: 'p1' | 'p2',
  depthRemaining: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
  options: SearchOptions,
): { value: number; pv: string[] } {
  if (isTerminal(battle) || depthRemaining <= 0 || budget.aborted) {
    return { value: winForSide(battle, focalSide), pv: [] };
  }
  if (budget.nodesUsed >= budget.limit) {
    budget.aborted = true;
    return { value: winForSide(battle, focalSide), pv: [] };
  }

  const opposingSide = focalSide === 'p1' ? 'p2' : 'p1';
  const ownCombos = jointCandidatesForSide(battle, activePositionsForSide(battle, focalSide), options.candidateBreadth, 'fast');
  const oppCombos = jointCandidatesForSide(battle, activePositionsForSide(battle, opposingSide), options.candidateBreadth, 'fast');

  let bestValue = -Infinity;
  let bestPv: string[] = [];
  let localAlpha = alpha;

  for (const ownActions of ownCombos) {
    const { value, pv } = worstCaseForOwnActions(
      battle,
      focalSide,
      ownActions,
      oppCombos,
      depthRemaining,
      budget,
      options,
    );
    if (value > bestValue) {
      bestValue = value;
      bestPv = [ownActions.map(describeActionCompact).join(' + ') || 'pass', ...pv];
    }
    localAlpha = Math.max(localAlpha, bestValue);
    if (localAlpha >= beta || budget.aborted) break; // élagage alpha
  }

  if (bestValue === -Infinity) {
    return { value: winForSide(battle, focalSide), pv: [] };
  }
  return { value: bestValue, pv: bestPv };
}

/**
 * Point d'entrée principal : classe les meilleures actions plausibles pour
 * le Pokémon à `position`, avec une VRAIE recherche multi-tours
 * adversariale (alpha-beta + ordonnancement de coups + budget de noeuds),
 * là où turnAnalyzer.analyzeActionsForPosition s'arrêtait à une moyenne
 * 1-pli. `fixedAllyAction` a le même rôle que dans turnAnalyzer : isoler
 * l'effet du choix étudié quand le camp a un second actif.
 */
export function searchBestActions(
  battle: BattleState,
  position: PokemonPosition,
  fixedAllyAction: PlayerAction | null,
  overrides: Partial<SearchOptions> = {},
): DeepActionScore[] {
  const options: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, ...overrides };
  const side = position.startsWith('p1') ? 'p1' : 'p2';
  const opposingSide = side === 'p1' ? 'p2' : 'p1';
  const budget: SearchBudget = { nodesUsed: 0, limit: options.nodeBudget, aborted: false };

  const shallowRanked = analyzeActionsForPosition(battle, position, fixedAllyAction);
  const candidates = shallowRanked.slice(0, options.candidateBreadth).map((s) => s.action);
  if (candidates.length === 0) return [];

  const oppCombos = jointCandidatesForSide(
    battle,
    activePositionsForSide(battle, opposingSide),
    options.candidateBreadth,
    options.rootOpponentRanking,
  );

  const results: DeepActionScore[] = candidates.map((candidateAction) => {
    const ownActions = fixedAllyAction ? [candidateAction, fixedAllyAction] : [candidateAction];
    const { value, pv } = worstCaseForOwnActions(
      battle,
      side,
      ownActions,
      oppCombos,
      options.maxDepth,
      budget,
      options,
    );
    return {
      action: candidateAction,
      winExpectancy: Math.round(value * 10) / 10,
      principalVariation: [describeActionCompact(candidateAction), ...pv],
      depthReached: options.maxDepth,
      nodesSearched: budget.nodesUsed,
      aborted: budget.aborted,
    };
  });

  return results.sort((a, b) => b.winExpectancy - a.winExpectancy);
}

/**
 * Équivalent "recherche profonde" de turnAnalyzer.getBestWinExpectancyForSide :
 * meilleure espérance de victoire d'un camp à ce tour, tenant compte de ses
 * 2 actifs conjointement ET d'une vraie recherche adversariale multi-tours
 * plutôt que d'un simple 1-pli moyenné.
 *
 * Même approximation que l'original pour la paire d'actifs : on cherche en
 * profondeur pour le premier Pokémon (second libre), on retient sa
 * meilleure action, puis on cherche en profondeur pour le second EN FIXANT
 * ce choix — un vrai minimax sur la paire complète doublerait le coût déjà
 * élevé d'une recherche multi-tours pour un gain marginal sur la plupart
 * des tours.
 */
export function getDeepBestWinExpectancyForSide(
  battle: BattleState,
  side: 'p1' | 'p2',
  overrides: Partial<SearchOptions> = {},
): number | null {
  const positions = activePositionsForSide(battle, side);
  if (positions.length === 0) return null;

  if (positions.length === 1) {
    const scores = searchBestActions(battle, positions[0], null, overrides);
    return scores[0]?.winExpectancy ?? null;
  }

  const [firstPosition, secondPosition] = positions;
  const firstScores = searchBestActions(battle, firstPosition, null, overrides);
  if (firstScores.length === 0) {
    const secondScores = searchBestActions(battle, secondPosition, null, overrides);
    return secondScores[0]?.winExpectancy ?? null;
  }

  const bestFirstAction = firstScores[0].action;
  const secondScores = searchBestActions(battle, secondPosition, bestFirstAction, overrides);
  if (secondScores.length === 0) return firstScores[0].winExpectancy;

  return secondScores[0].winExpectancy;
}
