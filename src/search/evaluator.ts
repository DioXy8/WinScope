/**
 * search/evaluator.ts
 *
 * Heuristique PROVISOIRE d'évaluation d'un BattleState en "% de chances de
 * gagner" pour p1. Tant que le vrai damage calculator + moteur de recherche
 * (search/turnAnalyzer.ts) ne sont pas branchés, on approxime avec une
 * formule simple basée sur les HP restants, le nombre de Pokémon vivants,
 * et les boosts actifs.
 *
 * CE N'EST PAS le moteur de simulation final décrit dans l'architecture du
 * projet (qui explorera les actions plausibles des deux joueurs). C'est une
 * estimation rapide, suffisante pour afficher une courbe de tendance dans
 * l'UI en attendant cette pièce.
 */

import type { BattleState, PokemonState } from '../engine/state';

/** Score brut d'un seul Pokémon : HP% pondéré par ses boosts offensifs/défensifs nets. */
function pokemonScore(p: PokemonState): number {
  if (p.fainted) return 0;
  const maxHp = p.maxHp ?? 100;
  const hpFraction = Math.max(0, Math.min(1, p.currentHp / maxHp));

  const boostSum =
    p.boosts.atk + p.boosts.spa + p.boosts.def + p.boosts.spd + p.boosts.spe;
  const boostFactor = 1 + Math.max(-0.5, Math.min(0.5, boostSum * 0.04));

  const statusFactor = p.status === 'slp' || p.status === 'frz' ? 0.85 : p.status === 'par' ? 0.92 : 1;

  return hpFraction * boostFactor * statusFactor;
}

function sideScore(battle: BattleState, side: 'p1' | 'p2'): number {
  const pokemons = Object.values(battle.pokemonByKey).filter((p) => p.side === side);
  if (pokemons.length === 0) return 0;
  return pokemons.reduce((sum, p) => sum + pokemonScore(p), 0);
}

/**
 * Retourne une estimation du % de victoire de p1, entre 1 et 99 (jamais 0/100
 * tant que les deux joueurs ont au moins un Pokémon en vie, pour éviter de
 * donner une fausse impression de certitude absolue).
 */
export function estimateWinProbability(battle: BattleState): number {
  const p1Alive = Object.values(battle.pokemonByKey).some((p) => p.side === 'p1' && !p.fainted);
  const p2Alive = Object.values(battle.pokemonByKey).some((p) => p.side === 'p2' && !p.fainted);

  if (!p1Alive && !p2Alive) return 50;
  if (!p1Alive) return 1;
  if (!p2Alive) return 99;

  const p1 = sideScore(battle, 'p1');
  const p2 = sideScore(battle, 'p2');
  const total = p1 + p2;
  if (total === 0) return 50;

  const raw = (p1 / total) * 100;
  return Math.max(1, Math.min(99, Math.round(raw)));
}
