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
 *   1. MULTI-TOURS JUSQU'AU RÉSULTAT RÉEL : la recherche ne s'arrête plus
 *      après un petit nombre fixe de tours — elle continue, tour après
 *      tour, jusqu'à ce que le combat soit VRAIMENT terminé (un camp n'a
 *      plus aucun Pokémon vivant) ou que le budget de calcul soit épuisé.
 *      `maxDepth` reste une limite de sécurité (très large, ~40 tours) ;
 *      c'est `nodeBudget` qui gouverne en pratique jusqu'où on regarde.
 *      Chaque `DeepActionScore.reachedTerminal` dit honnêtement si la
 *      ligne retenue est un résultat RÉELLEMENT simulé jusqu'au bout, ou
 *      si elle s'appuie quelque part sur l'heuristique statique de secours
 *      (evaluator.ts) faute d'avoir pu aller plus loin.
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

import type { BattleState, PokemonState } from '../engine/state';
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
  // Volontairement large : l'idée n'est plus de s'arrêter après 2 tours,
  // mais de pousser la simulation jusqu'à la fin RÉELLE du combat
  // (isTerminal) chaque fois que c'est possible. En pratique, un match VGC
  // dépasse rarement 25-30 tours, donc cette limite ne devrait quasiment
  // jamais être la cause de l'arrêt — c'est `nodeBudget`
