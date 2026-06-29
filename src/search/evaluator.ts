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

/** Score brut d'un seul Pokémon VIVANT : HP% pondéré par boosts/statut. Toujours 0 si KO. */
function pokemonHealthScore(p: PokemonState): number {
  if (p.fainted) return 0;
  const maxHp = p.maxHp ?? 100;
  const hpFraction = Math.max(0, Math.min(1, p.currentHp / maxHp));

  const boostSum = p.boosts.atk + p.boosts.spa + p.boosts.def + p.boosts.spd + p.boosts.spe;
  const boostFactor = 1 + Math.max(-0.5, Math.min(0.5, boostSum * 0.04));

  const statusFactor = p.status === 'slp' || p.status === 'frz' ? 0.85 : p.status === 'par' ? 0.92 : 1;

  return hpFraction * boostFactor * statusFactor;
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
const ALIVE_COUNT_WEIGHT = 3;

function sideScore(summary: SideSummary): number {
  return summary.aliveCount * ALIVE_COUNT_WEIGHT + summary.healthSum;
}

/**
 * Retourne une estimation du % de victoire de p1, entre 1 et 99 (jamais 0/100
 * tant que les deux joueurs ont au moins un Pokémon en vie, pour éviter de
 * donner une fausse impression de certitude absolue tant que le match n'est
 * pas réellement terminé).
 */
export function estimateWinProbability(battle: BattleState): number {
  const p1Summary = summarizeSide(battle, 'p1');
  const p2Summary = summarizeSide(battle, 'p2');

  if (p1Summary.aliveCount === 0 && p2Summary.aliveCount === 0) return 50;
  if (p1Summary.aliveCount === 0) return 0;
  if (p2Summary.aliveCount === 0) return 100;

  const p1 = sideScore(p1Summary);
  const p2 = sideScore(p2Summary);
  const total = p1 + p2;
  if (total === 0) return 50;

  const raw = (p1 / total) * 100;
  return Math.max(1, Math.min(99, Math.round(raw)));
}
