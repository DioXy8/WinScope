/**
 * search/monteCarlo.ts
 *
 * Simulation Monte Carlo : joue un très grand nombre de parties COMPLÈTES
 * jusqu'à la vraie fin du combat, à partir d'un tour et d'une action
 * donnés, et renvoie le % de victoires observées.
 *
 * Différence fondamentale avec search/minimax.ts : minimax.ts explore
 * EXHAUSTIVEMENT (avec élagage) les meilleures branches sous un budget de
 * noeuds borné pour rester instantané dans l'UI — il peut donc devoir se
 * replier sur l'heuristique statique d'evaluator.ts avant la vraie fin.
 * monteCarlo.ts fait l'inverse : chaque partie simulée est UNE seule ligne
 * de jeu (pas d'exploration de toutes les branches), donc chaque partie
 * est bon marché — ça permet d'aller RÉELLEMENT jusqu'au bout à chaque
 * fois, en échange de devoir en jouer beaucoup (des milliers) pour que la
 * moyenne soit fiable, plutôt qu'une seule recherche exhaustive.
 *
 * Politique de jeu (comment une partie choisit ses coups, tour après
 * tour) : le tout premier tour utilise l'action EXACTE demandée (celle
 * qu'on évalue) pour la position étudiée ; tout le reste (réponse adverse
 * ce tour, et absolument tout des deux côtés les tours suivants) est tiré
 * au sort parmi les actions plausibles, avec un biais vers les actions
 * offensives plutôt qu'une pure loterie (cf. `pickStochasticAction`) — ni
 * un adversaire parfait (minimax.ts s'en charge autrement), ni un
 * adversaire complètement aléatoire : quelque chose d'assez plausible pour
 * qu'une moyenne sur des milliers de parties reste informative, en
 * acceptant qu'aucune politique simple ne joue aussi bien qu'un vrai
 * joueur.
 *
 * Remplaçants Reg M-B non confirmés : contrairement à minimax.ts (qui
 * refuse de deviner, cf. fillEmptyActiveSlots), une simulation Monte Carlo
 * PEUT se permettre de tirer au sort lequel des Pokémon "jamais envoyés"
 * de Team Preview est réellement envoyé quand un slot devient vide sans
 * remplaçant confirmé — après des milliers de parties, les différentes
 * hypothèses finissent par se moyenner correctement plutôt que de bloquer
 * la partie.
 */

import type { BattleState, PokemonState } from '../engine/state';
import type { PokemonPosition } from '../replay/types';
import type { PlayerAction } from './actionTypes';
import { generateActionsForPosition } from './actionGenerator';
import { calculateDamage } from '../damagecalc/damageCalc';
import { simulateTurn, type SimulationBranch } from './outcomeSimulator';
import {
  activePositionsForSide,
  computeExpectedSlots,
  fillEmptyActiveSlots,
  isSideDefeated,
  isTerminal,
  jointCandidatesForSide,
  type ExpectedSlots,
} from './minimax';
import { REG_MB_MAX_TEAM_SIZE } from './evaluator';

export interface MonteCarloConfig {
  /** Nombre de parties complètes à simuler. */
  numGames: number;
  /** Coupe-circuit de sécurité : au-delà de ce nombre de tours, une partie est comptée "non conclue" plutôt que de tourner indéfiniment (ne devrait quasiment jamais être atteint en pratique). */
  maxTurnsPerGame: number;
  /**
   * Probabilité, à chaque décision NON fixée par la question posée (donc
   * tout sauf l'action racine étudiée), de piocher une action au hasard
   * plutôt que la mieux classée par l'heuristique bon marché — la source
   * de variété entre les parties. 0 = toujours le "meilleur" coup évident
   * (parties quasi identiques, Monte Carlo perd son intérêt) ; 1 = pur
   * hasard (adversaire irréaliste). Une valeur intermédiaire imite mieux
   * un joueur qui varie ses lignes sans jouer n'importe quoi.
   */
  explorationRate: number;
}

export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  numGames: 2000,
  maxTurnsPerGame: 50,
  explorationRate: 0.3,
};

export interface MonteCarloResult {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  /** Parties qui ont dépassé maxTurnsPerGame sans conclusion réelle — exclues de winRate. */
  gamesInconclusive: number;
  /** % de victoires PARMI LES PARTIES CONCLUES (gagnées+perdues+nulles comptent, inconclusives exclues). */
  winRate: number;
  averageTurnsToConclude: number;
}

/** Ordre grossier sans simulation (identique en esprit à minimax.ts::topCandidatesFast) : offensif > statut/soi > switch. */
/**
 * Estimation RAPIDE (un calcul de dégâts direct, pas une simulation de
 * tour complète) du %HP qu'une action offensive infligerait, moyennée sur
 * ses cibles. Sert UNIQUEMENT à ordonner les candidats dans la politique
 * bon marché du déroulé — sans ça, une attaque qui ne fait STRICTEMENT
 * RIEN (immunité de type, mauvaise cible...) et une attaque dévastatrice
 * étaient traitées comme équivalentes ("offensive" au même titre), ce qui
 * pouvait faire jouer des coups objectivement mauvais aussi souvent que
 * des bons dans le déroulé — la politique de simulation, c'est justement
 * ce qui détermine la qualité du % Monte Carlo au final.
 */
function estimateQuickDamagePercent(battle: BattleState, attackerKey: string, action: PlayerAction): number {
  if (action.kind !== 'move' || action.targetPositions.length === 0) return 0;
  const attacker = battle.pokemonByKey[attackerKey];
  if (!attacker) return 0;
  const attackerSide: 'p1' | 'p2' = attacker.side;
  let total = 0;
  let count = 0;
  for (const targetPos of action.targetPositions) {
    const defenderKey = battle.activeByPosition[targetPos];
    const defender = defenderKey ? battle.pokemonByKey[defenderKey] : undefined;
    if (!defender) continue;
    try {
      const result = calculateDamage(attacker, defender, action.moveName, battle, attackerSide);
      total += (result.minPercent + result.maxPercent) / 2;
      count += 1;
    } catch {
      // Move/espèce hors dex Champions : pas d'estimation possible, ignoré (contribue 0).
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * Priorité grossière SANS calcul de dégâts (switch < statut < offensif) —
 * utilisée seulement pour départager quand aucune estimation de dégâts
 * n'est disponible ou pertinente (switches, moves de statut).
 */
function actionPriority(a: PlayerAction): number {
  if (a.kind === 'switch') return 0;
  return a.targetPositions.length > 0 ? 2 : 1;
}

/**
 * Choisit UN COMBO d'actions (une par position adverse) à partir d'un
 * classement DÉJÀ CALCULÉ — utilisé uniquement pour LE TOUT PREMIER TOUR.
 * Contrairement à `pickStochasticAction` (bon marché, indépendant par
 * position, utilisé pour tout le reste du déroulé), ce classement vient de
 * `jointCandidatesForSide(..., 'accurate')` : les 2 positions d'un même
 * camp sont classées ENSEMBLE, pas indépendamment.
 *
 * Pourquoi ça compte concrètement : un classement indépendant par position
 * ne voit PAS les synergies d'équipe. Exemple réel qui a révélé le bug —
 * Farigiraf utilise Helping Hand sur Incineroar, ce qui rend SEUL le
 * Close Combat d'Incineroar assez fort pour achever un Kingambit qu'aucun
 * des deux ne pourrait tuer seul. Classé indépendamment, Close Combat
 * "sans boost" a l'air d'un coup quelconque et n'était jamais retenu comme
 * LA réponse à punir — le Monte Carlo ratait donc systématiquement cette
 * ligne pourtant réellement jouée par l'adversaire.
 */
function pickComboFromRanking(ranked: PlayerAction[][], explorationRate: number): PlayerAction[] {
  if (ranked.length === 0) return [];
  if (Math.random() < explorationRate) {
    return ranked[Math.floor(Math.random() * ranked.length)];
  }
  return ranked[0];
}

/** Calcule, UNE SEULE FOIS avant de lancer les parties, le classement précis EN COMBO (les 2 positions adverses ensemble, synergies comprises) des réponses plausibles — réutilisé par toutes les parties pour le tout premier tour. */
function computeRootOpponentComboRanking(
  battle: BattleState,
  opposingPositions: PokemonPosition[],
  breadth: number,
): PlayerAction[][] {
  return jointCandidatesForSide(battle, opposingPositions, breadth, 'accurate');
}

/**
 * Choisit UNE action pour cette position selon la politique stochastique
 * du module (cf. commentaire d'en-tête). Retourne null si aucune action
 * n'est possible (position vide/K.O.).
 */
function pickStochasticAction(
  battle: BattleState,
  position: PokemonPosition,
  explorationRate: number,
): PlayerAction | null {
  const attackerKey = battle.activeByPosition[position];
  const candidates = generateActionsForPosition(battle, position);
  if (candidates.length === 0) return null;
  if (Math.random() < explorationRate) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  const ranked = [...candidates].sort((a, b) => {
    const tierA = actionPriority(a);
    const tierB = actionPriority(b);
    if (tierA !== tierB) return tierB - tierA; // switch < statut < offensif, toujours
    if (tierA === 2 && attackerKey) {
      // À égalité de tier "offensif", départage par vrai %HP estimé — pas
      // l'ordre arbitraire de génération, qui ne distingue pas un coup nul
      // (immunité de type...) d'un coup dévastateur.
      return (
        estimateQuickDamagePercent(battle, attackerKey, b) - estimateQuickDamagePercent(battle, attackerKey, a)
      );
    }
    return 0;
  });
  return ranked[0];
}

/** Tire UNE branche parmi celles retournées par simulateTurn, selon leurs probabilités (accuracy/crit) — pas une moyenne, un vrai tirage, comme une vraie partie qui ne vit qu'UNE seule de ces issues. */
function sampleBranch(branches: SimulationBranch[]): BattleState {
  if (branches.length === 1) return branches[0].battle;
  const totalWeight = branches.reduce((sum, b) => sum + b.probability, 0);
  let roll = Math.random() * totalWeight;
  for (const branch of branches) {
    roll -= branch.probability;
    if (roll <= 0) return branch.battle;
  }
  return branches[branches.length - 1].battle;
}

/**
 * Pour les slots encore vides après fillEmptyActiveSlots (aucun
 * remplaçant CONFIRMÉ disponible) : si le roster réel n'est pas encore
 * complet (Reg M-B, cf. evaluator.ts), tire au sort UN des Pokémon
 * "annoncés en Team Preview mais jamais envoyés" restants pour ce côté et
 * l'envoie — ses moves seront automatiquement devinés via le set de
 * référence NCP par le pipeline existant (damagecalc/adapter.ts::getKnownMoves),
 * exactement comme pour un Pokémon adverse "🔍 Estimé" déjà affiché dans
 * l'UI. Une fois tiré, il reste "confirmé" (hasBeenSentOut: true) pour le
 * reste de CETTE partie.
 */
function fillGhostSlotsRandomly(battle: BattleState, expectedSlots: ExpectedSlots): BattleState {
  let next = battle;
  for (const side of ['p1', 'p2'] as const) {
    for (const slot of expectedSlots[side]) {
      if (next.activeByPosition[slot]) continue;
      const sentOutCount = Object.values(next.pokemonByKey).filter(
        (p) => p.side === side && p.hasBeenSentOut,
      ).length;
      if (sentOutCount >= REG_MB_MAX_TEAM_SIZE) continue; // roster déjà complet : plus rien à tirer, ce côté est simplement fini (isTerminal le détectera)
      const activeKeys = new Set(Object.values(next.activeByPosition));
      const unconfirmed = Object.entries(next.pokemonByKey).filter(
        ([key, p]) => p.side === side && !p.hasBeenSentOut && !p.fainted && !activeKeys.has(key),
      );
      if (unconfirmed.length === 0) continue;
      const [incomingKey, incomingPokemon] = unconfirmed[Math.floor(Math.random() * unconfirmed.length)];
      const updatedPokemon: PokemonState = { ...incomingPokemon, hasBeenSentOut: true };
      next = {
        ...next,
        pokemonByKey: { ...next.pokemonByKey, [incomingKey]: updatedPokemon },
        activeByPosition: { ...next.activeByPosition, [slot]: incomingKey },
      };
    }
  }
  return next;
}

type GameOutcome = 'win' | 'loss' | 'draw' | 'inconclusive';

/** Joue UNE partie complète jusqu'à la fin (ou jusqu'au coupe-circuit de sécurité) et retourne son issue pour `focalSide`. */
function playOneGame(
  rootBattle: BattleState,
  focalSide: 'p1' | 'p2',
  rootPosition: PokemonPosition,
  rootAction: PlayerAction,
  fixedAllyAction: PlayerAction | null,
  expectedSlots: ExpectedSlots,
  config: MonteCarloConfig,
  rootOpponentComboRanking: PlayerAction[][],
): { outcome: GameOutcome; turns: number } {
  let battle = rootBattle;
  const opposingSide = focalSide === 'p1' ? 'p2' : 'p1';
  let turns = 0;
  let isRootTurn = true;

  while (turns < config.maxTurnsPerGame) {
    if (isTerminal(battle)) break;
    turns += 1;

    const ownPositions = activePositionsForSide(battle, focalSide);
    const oppPositions = activePositionsForSide(battle, opposingSide);

    const ownActions: PlayerAction[] = [];
    for (const pos of ownPositions) {
      let action: PlayerAction | null;
      if (isRootTurn && pos === rootPosition) {
        action = rootAction;
      } else if (isRootTurn && fixedAllyAction && pos !== rootPosition) {
        action = fixedAllyAction;
      } else {
        action = pickStochasticAction(battle, pos, config.explorationRate);
      }
      if (action) ownActions.push(action);
    }

    const oppActions: PlayerAction[] = isRootTurn
      ? pickComboFromRanking(rootOpponentComboRanking, config.explorationRate)
      : oppPositions
          .map((pos) => pickStochasticAction(battle, pos, config.explorationRate))
          .filter((a): a is PlayerAction => a !== null);

    const p1Actions = focalSide === 'p1' ? ownActions : oppActions;
    const p2Actions = focalSide === 'p1' ? oppActions : ownActions;
    const branches = simulateTurn(battle, p1Actions, p2Actions);
    battle = sampleBranch(branches);
    battle = fillEmptyActiveSlots(battle, expectedSlots);
    battle = fillGhostSlotsRandomly(battle, expectedSlots);
    isRootTurn = false;
  }

  if (!isTerminal(battle)) {
    return { outcome: 'inconclusive', turns };
  }
  const ownDefeated = isSideDefeated(battle, focalSide);
  const oppDefeated = isSideDefeated(battle, opposingSide);
  if (ownDefeated && oppDefeated) return { outcome: 'draw', turns };
  if (ownDefeated) return { outcome: 'loss', turns };
  return { outcome: 'win', turns };
}

/**
 * Point d'entrée : simule `config.numGames` parties complètes à partir de
 * `rootAction` pour `position`, et retourne le % de victoires observées.
 *
 * `onProgress`, si fourni, est appelé après CHAQUE partie (pas juste à la
 * fin) — indispensable pour afficher une progression pendant potentiellement
 * plusieurs secondes/minutes de calcul plutôt qu'un gel silencieux de l'UI.
 * L'appelant (l'UI) est responsable de découper l'appel en tranches (ex:
 * via runMonteCarloChunked ci-dessous) pour laisser le navigateur respirer.
 */
export function runMonteCarloGames(
  battle: BattleState,
  position: PokemonPosition,
  rootAction: PlayerAction,
  fixedAllyAction: PlayerAction | null,
  overrides: Partial<MonteCarloConfig> = {},
): MonteCarloResult {
  const config: MonteCarloConfig = { ...DEFAULT_MONTE_CARLO_CONFIG, ...overrides };
  const focalSide = position.startsWith('p1') ? 'p1' : 'p2';
  const opposingSide = focalSide === 'p1' ? 'p2' : 'p1';
  const expectedSlots = computeExpectedSlots(battle);
  const rootOpponentComboRanking = computeRootOpponentComboRanking(battle, activePositionsForSide(battle, opposingSide), 3);

  let gamesWon = 0;
  let gamesLost = 0;
  let gamesDrawn = 0;
  let gamesInconclusive = 0;
  let turnsSum = 0;
  let concludedGames = 0;

  for (let i = 0; i < config.numGames; i++) {
    const { outcome, turns } = playOneGame(
      battle,
      focalSide,
      position,
      rootAction,
      fixedAllyAction,
      expectedSlots,
      config,
      rootOpponentComboRanking,
    );
    if (outcome === 'win') gamesWon += 1;
    else if (outcome === 'loss') gamesLost += 1;
    else if (outcome === 'draw') gamesDrawn += 1;
    else gamesInconclusive += 1;

    if (outcome !== 'inconclusive') {
      turnsSum += turns;
      concludedGames += 1;
    }
  }

  const concluded = gamesWon + gamesLost + gamesDrawn;
  const winRate = concluded > 0 ? ((gamesWon + gamesDrawn * 0.5) / concluded) * 100 : 50;

  return {
    gamesPlayed: config.numGames,
    gamesWon,
    gamesLost,
    gamesDrawn,
    gamesInconclusive,
    winRate: Math.round(winRate * 10) / 10,
    averageTurnsToConclude: concludedGames > 0 ? Math.round((turnsSum / concludedGames) * 10) / 10 : 0,
  };
}

/**
 * Version découpée en tranches pour l'UI : joue `batchSize` parties par
 * appel, rapporte la progression via `onProgress`, et laisse le
 * navigateur respirer entre deux tranches (via setTimeout(0)) plutôt que
 * de geler l'onglet pendant toute la durée d'un run à 10 000+ parties.
 */
export async function runMonteCarloChunked(
  battle: BattleState,
  position: PokemonPosition,
  rootAction: PlayerAction,
  fixedAllyAction: PlayerAction | null,
  overrides: Partial<MonteCarloConfig> = {},
  onProgress?: (gamesPlayed: number, totalGames: number, winRateSoFar: number) => void,
  batchSize = 200,
): Promise<MonteCarloResult> {
  const config: MonteCarloConfig = { ...DEFAULT_MONTE_CARLO_CONFIG, ...overrides };
  const focalSide = position.startsWith('p1') ? 'p1' : 'p2';
  const opposingSide = focalSide === 'p1' ? 'p2' : 'p1';
  const expectedSlots = computeExpectedSlots(battle);
  const rootOpponentComboRanking = computeRootOpponentComboRanking(battle, activePositionsForSide(battle, opposingSide), 3);

  let gamesWon = 0;
  let gamesLost = 0;
  let gamesDrawn = 0;
  let gamesInconclusive = 0;
  let turnsSum = 0;
  let concludedGames = 0;
  let played = 0;

  while (played < config.numGames) {
    const thisBatch = Math.min(batchSize, config.numGames - played);
    for (let i = 0; i < thisBatch; i++) {
      const { outcome, turns } = playOneGame(
        battle,
        focalSide,
        position,
        rootAction,
        fixedAllyAction,
        expectedSlots,
        config,
        rootOpponentComboRanking,
      );
      if (outcome === 'win') gamesWon += 1;
      else if (outcome === 'loss') gamesLost += 1;
      else if (outcome === 'draw') gamesDrawn += 1;
      else gamesInconclusive += 1;

      if (outcome !== 'inconclusive') {
        turnsSum += turns;
        concludedGames += 1;
      }
    }
    played += thisBatch;

    const concludedSoFar = gamesWon + gamesLost + gamesDrawn;
    const winRateSoFar = concludedSoFar > 0 ? ((gamesWon + gamesDrawn * 0.5) / concludedSoFar) * 100 : 50;
    onProgress?.(played, config.numGames, Math.round(winRateSoFar * 10) / 10);

    // Rend la main à l'event loop entre deux tranches (sinon le navigateur gèle jusqu'à la fin du run).
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const concluded = gamesWon + gamesLost + gamesDrawn;
  const winRate = concluded > 0 ? ((gamesWon + gamesDrawn * 0.5) / concluded) * 100 : 50;

  return {
    gamesPlayed: config.numGames,
    gamesWon,
    gamesLost,
    gamesDrawn,
    gamesInconclusive,
    winRate: Math.round(winRate * 10) / 10,
    averageTurnsToConclude: concludedGames > 0 ? Math.round((turnsSum / concludedGames) * 10) / 10 : 0,
  };
}
