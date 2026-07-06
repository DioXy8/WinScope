/**
 * search/evaluator.ts
 *
 * Heuristique PROVISOIRE d'évaluation d'un BattleState en "% de chances de
 * gagner" pour p1. Tant que le vrai damage calculator + moteur de recherche
 * (search/turnAnalyzer.ts) ne sont pas branchés sur une vraie recherche
 * complète, on approxime avec une formule basée sur :
 *   1. Le nombre de Pokémon vivants de chaque côté (le facteur dominant —
 *      un Pokémon de réserve en pleine forme vaut largement plus qu'une
 *      fraction de %HP sur les actifs : avoir un Pokémon d'avance change
 *      fondamentalement l'issue probable d'un match VGC).
 *   2. Les HP% cumulés des Pokémon vivants (facteur secondaire, pour
 *      distinguer "à égalité numérique mais en meilleure santé").
 *   3. Les boosts et statuts actifs (ajustement fin).
 *
 * CE N'EST PAS le moteur de simulation final décrit dans l'architecture du
 * projet. C'est une estimation rapide, suffisante pour afficher une courbe
 * de tendance dans l'UI en attendant une vraie recherche multi-tours.
 */

import type { BattleState, PokemonState } from '../engine/state';

/** Score brut d'un seul Pokémon VIVANT : HP% (ajusté par statut) + bonus de boost. Toujours 0 si KO. */
function pokemonHealthScore(p: PokemonState): number {
  if (p.fainted) return 0;
  const maxHp = p.maxHp ?? 100;
  const hpFraction = Math.max(0, Math.min(1, p.currentHp / maxHp));
  const statusFactor = p.status === 'slp' || p.status === 'frz' ? 0.85 : p.status === 'par' ? 0.92 : 1;

  // Bonus de boost ADDITIF plutôt que multiplicatif sur le %HP : avec un
  // multiplicateur borné à [0.25, 1.75] appliqué à un hpFraction max de 1.0,
  // même un boost énorme (Shell Smash : +2/+2/+2, -1/-1, somme nette +4) ne
  // pouvait jamais déplacer le score de plus de quelques points une fois
  // noyé dans ALIVE_COUNT_WEIGHT=4 par Pokémon vivant — largement
  // insuffisant pour refléter qu'un tel boost change concrètement la donne
  // (dégâts ~doublés, joue quasi toujours en premier). Le bonus additif
  // reste une approximation grossière (aucune pondération par stat — un
  // boost de vitesse ou d'attaque compte pareil qu'un boost défensif, et il
  // ignore si l'adversaire peut ou non exploiter la faiblesse en Def/SpD
  // laissée par Shell Smash), mais pèse enfin un poids comparable à une
  // vraie différence de Pokémon en vie.
  const boostSum = p.boosts.atk + p.boosts.spa + p.boosts.def + p.boosts.spd + p.boosts.spe;
  const boostBonus = Math.max(-1.5, Math.min(1.5, boostSum * 0.25));

  return hpFraction * statusFactor + boostBonus;
}

interface SideSummary {
  /** Nombre de Pokémon connus de ce camp qui ne sont pas K.O. */
  aliveCount: number;
  /** Somme des scores de santé des Pokémon vivants (entre 0 et aliveCount). */
  healthSum: number;
}

function summarizeSide(battle: BattleState, side: 'p1' | 'p2'): SideSummary {
  const pokemons = Object.values(battle.pokemonByKey).filter((p) => p.side === side);
  let aliveCount = 0;
  let healthSum = 0;
  for (const p of pokemons) {
    if (p.fainted) continue;
    aliveCount += 1;
    healthSum += pokemonHealthScore(p);
  }
  return { aliveCount, healthSum };
}

/**
 * Poids relatif du nombre de Pokémon vivants par rapport aux HP% cumulés,
 * dans le score final. Une valeur élevée signifie qu'un avantage numérique
 * (ex: 3 Pokémon vivants contre 1) domine largement de simples différences
 * de %HP — cohérent avec la réalité du jeu : un Pokémon de réserve en
 * pleine forme est presque toujours plus précieux qu'un peu de %HP en plus
 * sur les Pokémon déjà actifs.
 */
const ALIVE_COUNT_WEIGHT = 4;

/**
 * Pénalité structurelle appliquée quand un camp n'a plus qu'UN SEUL Pokémon
 * vivant face à un adversaire qui en a strictement plus : en double, ce
 * dernier Pokémon encaisse potentiellement les deux attaques adverses
 * CHAQUE tour tout en ne pouvant riposter qu'une fois — un désavantage
 * mécanique réel, pas juste un ajustement arbitraire. Sans ce facteur,
 * l'ancien modèle purement additif (aliveCount*poids + HP%) sous-estimait
 * nettement la gravité de ce genre de fin de match (ex: 30% HP, seul,
 * contre deux Pokémon pleine forme, estimé à ~30% de victoire — bien trop
 * optimiste pour une situation généralement quasi perdue).
 */
const OUTNUMBERED_ALONE_PENALTY = 0.65;

function sideScore(summary: SideSummary, isOutnumberedAlone: boolean): number {
  const base = summary.aliveCount * ALIVE_COUNT_WEIGHT + summary.healthSum;
  return isOutnumberedAlone ? base * OUTNUMBERED_ALONE_PENALTY : base;
}

/**
 * Retourne une estimation du % de victoire de p1, entre 1 et 99 (jamais 0/100
 * tant que les deux joueurs ont au moins un Pokémon en vie, pour éviter de
 * donner une fausse impression de certitude absolue tant que le match n'est
 * pas réellement terminé).
 *
 * LIMITE IMPORTANTE À GARDER EN TÊTE : cette fonction évalue une POSITION
 * ISOLÉE (nombre de vivants + %HP + boosts/statut), sans aucune recherche
 * en profondeur. C'est turnAnalyzer.ts qui simule un tour avec ses réponses
 * adverses plausibles puis appelle cette heuristique sur le résultat — la
 * recherche s'arrête donc à horizon 1 tour. Une action comme Calm Mind, qui
 * ne paie vraiment qu'après plusieurs tours de boost accumulé, n'aura donc
 * jamais un score reflétant sa VRAIE valeur à long terme : l'évaluation ne
 * voit que l'état immédiatement après ce tour, jamais le sweep potentiel 2
 * ou 3 tours plus tard. Une vraie recherche multi-tours (minimax/expectimax
 * sur plusieurs plis) réglerait ça, mais représente un chantier bien plus
 * lourd que cette heuristique — non fait ici, documenté en attendant.
 */
export function estimateWinProbability(battle: BattleState): number {
  const p1Summary = summarizeSide(battle, 'p1');
  const p2Summary = summarizeSide(battle, 'p2');

  if (p1Summary.aliveCount === 0 && p2Summary.aliveCount === 0) return 50;
  if (p1Summary.aliveCount === 0) return 0;
  if (p2Summary.aliveCount === 0) return 100;

  const p1Outnumbered = p1Summary.aliveCount === 1 && p2Summary.aliveCount > 1;
  const p2Outnumbered = p2Summary.aliveCount === 1 && p1Summary.aliveCount > 1;

  const p1 = sideScore(p1Summary, p1Outnumbered);
  const p2 = sideScore(p2Summary, p2Outnumbered);
  const total = p1 + p2;
  if (total === 0) return 50;

  const raw = (p1 / total) * 100;
  return Math.max(1, Math.min(99, Math.round(raw)));
}
