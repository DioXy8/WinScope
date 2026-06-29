/**
 * search/turnAnalyzer.ts
 *
 * La pièce qui assemble tout le moteur de recherche : pour un tour donné,
 * compare plusieurs actions candidates pour UN Pokémon d'un joueur (ex:
 * "et si Garchomp avait joué Protect plutôt qu'Earthquake ?"), en tenant
 * compte des réponses plausibles de l'adversaire, et retourne un score
 * d'espérance de victoire par action candidate.
 *
 * Principe : pour chaque action candidate du joueur, on la combine avec
 * CHAQUE réponse adverse plausible (échantillonnée, pas exhaustive — cf.
 * sampleOpponentResponses), on simule chaque combinaison avec
 * outcomeSimulator, on évalue chaque BattleState résultant avec
 * evaluator.ts, puis on fait la moyenne pondérée par les probabilités de
 * branches ET par une pondération uniforme sur les réponses adverses
 * échantillonnées (faute de mieux : on ne suppose pas l'adversaire plus
 * malin qu'un autre choix tant qu'on n'a pas de modèle de "meilleure
 * réponse adverse").
 *
 * Limite combinatoire assumée : avec 2 positions actives par camp et
 * potentiellement des dizaines d'actions par position, tester tout
 * exhaustivement explose. On échantillonne donc les réponses adverses
 * (cf. MAX_OPPONENT_RESPONSES) plutôt que de les énumérer en entier — un
 * choix pragmatique documenté plutôt qu'une fausse promesse d'exhaustivité.
 */

import type { BattleState } from '../engine/state';
import type { PokemonPosition } from '../replay/types';
import { generateActionsForPosition } from './actionGenerator';
import { simulateTurn } from './outcomeSimulator';
import { estimateWinProbability } from './evaluator';
import type { PlayerAction } from './actionTypes';

export interface ActionScore {
  action: PlayerAction;
  winExpectancy: number;
  opponentResponsesConsidered: number;
}

const MAX_OPPONENT_RESPONSES = 6;

function sampleOpponentResponses(battle: BattleState, position: PokemonPosition): PlayerAction[] {
  const all = generateActionsForPosition(battle, position);
  const moves = all.filter((a) => a.kind === 'move');
  const switches = all.filter((a) => a.kind === 'switch').slice(0, 2);
  const combined = [...moves, ...switches];
  return combined.slice(0, MAX_OPPONENT_RESPONSES);
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((combo) => curr.map((item) => [...combo, item])),
    [[]],
  );
}

function scoreAction(
  battle: BattleState,
  candidateAction: PlayerAction,
  candidateSide: 'p1' | 'p2',
  fixedAllyAction: PlayerAction | null,
  opponentPositions: PokemonPosition[],
): ActionScore {
  const ownActions = fixedAllyAction ? [candidateAction, fixedAllyAction] : [candidateAction];

  const opponentActionSets = opponentPositions.map((pos) => sampleOpponentResponses(battle, pos));
  const opponentCombinations: PlayerAction[][] = cartesianProduct(opponentActionSets);

  let totalWeightedWinSum = 0;
  let totalWeight = 0;

  for (const opponentActions of opponentCombinations) {
    const p1Actions = candidateSide === 'p1' ? ownActions : opponentActions;
    const p2Actions = candidateSide === 'p1' ? opponentActions : ownActions;

    const branches = simulateTurn(battle, p1Actions, p2Actions);
    for (const branch of branches) {
      const winP1 = estimateWinProbability(branch.battle);
      const winForCandidateSide = candidateSide === 'p1' ? winP1 : 100 - winP1;
      totalWeightedWinSum += winForCandidateSide * branch.probability;
      totalWeight += branch.probability;
    }
  }

  const winExpectancy = totalWeight > 0 ? totalWeightedWinSum / totalWeight : 50;

  return {
    action: candidateAction,
    winExpectancy: Math.round(winExpectancy * 10) / 10,
    opponentResponsesConsidered: opponentCombinations.length,
  };
}

/**
 * Compare toutes les actions plausibles pour le Pokémon à `position`, et
 * retourne leur score d'espérance de victoire, trié du meilleur au pire.
 *
 * `fixedAllyAction` (optionnel) : si le camp a un second Pokémon actif, son
 * action est fixée pour isoler l'effet du choix étudié — sans ça, on
 * comparerait des tours entiers plutôt que des actions individuelles.
 */
export function analyzeActionsForPosition(
  battle: BattleState,
  position: PokemonPosition,
  fixedAllyAction: PlayerAction | null,
): ActionScore[] {
  const side = position.startsWith('p1') ? 'p1' : 'p2';
  const opposingSide = side === 'p1' ? 'p2' : 'p1';

  const candidates = generateActionsForPosition(battle, position);
  const opponentPositions = (Object.keys(battle.activeByPosition) as PokemonPosition[]).filter((p) =>
    p.startsWith(opposingSide),
  );

  const scores = candidates.map((action) =>
    scoreAction(battle, action, side, fixedAllyAction, opponentPositions),
  );

  return scores.sort((a, b) => b.winExpectancy - a.winExpectancy);
}

function actionsAreEquivalent(a: PlayerAction, b: PlayerAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'switch' && b.kind === 'switch') {
    return a.incomingKey === b.incomingKey;
  }
  if (a.kind === 'move' && b.kind === 'move') {
    return (
      a.moveName === b.moveName &&
      a.targetPositions.length === b.targetPositions.length &&
      a.targetPositions.every((t, i) => t === b.targetPositions[i])
    );
  }
  return false;
}

/**
 * Compare l'action RÉELLEMENT jouée (telle qu'observée dans le replay) aux
 * meilleures alternatives disponibles à ce tour, pour le même Pokémon.
 */
export function compareActualActionToAlternatives(
  battle: BattleState,
  position: PokemonPosition,
  actualAction: PlayerAction,
  fixedAllyAction: PlayerAction | null,
): { ranking: ActionScore[]; actualActionScore: ActionScore | null; bestScore: ActionScore | null } {
  const ranking = analyzeActionsForPosition(battle, position, fixedAllyAction);
  const bestScore = ranking[0] ?? null;
  const actualActionScore = ranking.find((s) => actionsAreEquivalent(s.action, actualAction)) ?? null;

  return { ranking, actualActionScore, bestScore };
}

/**
 * Calcule la meilleure espérance de victoire globale pour un camp à ce
 * tour, en tenant compte de SES DEUX Pokémon actifs conjointement (pas un
 * seul isolé avec l'autre ignoré) : on analyse le premier Pokémon en
 * laissant le second libre (pas d'allié fixé), on retient sa meilleure
 * action, puis on analyse le second EN FIXANT cette meilleure action du
 * premier comme contexte — une approximation simple de l'optimum joint
 * (pas un vrai algorithme minimax sur la paire complète, qui doublerait le
 * coût de calcul pour un gain marginal sur la plupart des tours).
 *
 * Retourne null si le camp n'a aucun Pokémon actif avec au moins un move
 * révélé (cas où aucune analyse n'est possible) — l'appelant doit alors
 * retomber sur l'heuristique de position brute (estimateWinProbability).
 */
export function getBestWinExpectancyForSide(battle: BattleState, side: 'p1' | 'p2'): number | null {
  const positions = (Object.keys(battle.activeByPosition) as PokemonPosition[]).filter((p) =>
    p.startsWith(side),
  );
  if (positions.length === 0) return null;

  if (positions.length === 1) {
    const scores = analyzeActionsForPosition(battle, positions[0], null);
    return scores[0]?.winExpectancy ?? null;
  }

  const [firstPosition, secondPosition] = positions;
  const firstScores = analyzeActionsForPosition(battle, firstPosition, null);
  if (firstScores.length === 0) {
    // Le premier Pokémon n'a rien de jouable connu : on analyse le second seul.
    const secondScores = analyzeActionsForPosition(battle, secondPosition, null);
    return secondScores[0]?.winExpectancy ?? null;
  }

  const bestFirstAction = firstScores[0].action;
  const secondScores = analyzeActionsForPosition(battle, secondPosition, bestFirstAction);

  if (secondScores.length === 0) {
    // Le second Pokémon n'a rien de jouable connu : le score du premier seul est notre meilleure estimation.
    return firstScores[0].winExpectancy;
  }

  // Le score le plus représentatif du tour combiné est celui calculé pour
  // le second Pokémon (qui intègre déjà l'action fixée du premier dans sa
  // simulation) — c'est notre meilleure approximation de l'optimum joint.
  return secondScores[0].winExpectancy;
}
