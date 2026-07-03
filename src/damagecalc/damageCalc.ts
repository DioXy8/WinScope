/**
 * damagecalc/damageCalc.ts
 *
 * API publique et propre du damage calculator, construite sur
 * adapter.ts + vendor/engine.js. C'est le SEUL fichier que le reste du
 * projet (search/, ui/) doit importer pour calculer des dégâts.
 */

import { GET_DAMAGE_SV } from './vendor/engine';
import { buildVendorField, buildVendorMove, buildVendorPokemon, DexLookupError } from './adapter';
import type { BattleState, PokemonState } from '../engine/state';

export { DexLookupError };

export interface DamageCalcResult {
  rolls: number[];
  minDamage: number;
  maxDamage: number;
  minPercent: number;
  maxPercent: number;
  description: string;
}

/**
 * Compte les Pokémon actifs et vivants du côté OPPOSÉ à attackerSide. Sert
 * à déterminer si un move spread (Earthquake, Dazzling Gleam...) doit
 * réellement subir le malus -25% : en vrai jeu, ce malus ne s'applique que
 * si le move touche EFFECTIVEMENT 2 adversaires à la fois. S'il n'en reste
 * qu'un sur le terrain (l'autre K.O. ou jamais envoyé), le move retombe
 * automatiquement en ciblage simple et fait des dégâts pleins.
 */
function countLiveOpposingActives(battle: BattleState, attackerSide: 'p1' | 'p2'): number {
  const opposingSide = attackerSide === 'p1' ? 'p2' : 'p1';
  return Object.entries(battle.activeByPosition).filter(([pos, key]) => {
    if (!pos.startsWith(opposingSide)) return false;
    const p = battle.pokemonByKey[key];
    return p !== undefined && !p.fainted;
  }).length;
}

/**
 * Calcule les dégâts qu'un `move` utilisé par `attacker` infligerait à
 * `defender`, dans le contexte du `battle` donné (météo/terrain/hazards).
 *
 * `attackerSide` précise de quel côté est l'attaquant, pour résoudre
 * correctement Tailwind/Reflect/etc. propres à chaque camp.
 *
 * Lance DexLookupError si le Pokémon ou le move ne sont pas dans la dex
 * Champions actuellement supportée (cf. adapter.ts).
 */
export function calculateDamage(
  attacker: PokemonState,
  defender: PokemonState,
  moveName: string,
  battle: BattleState,
  attackerSide: 'p1' | 'p2',
): DamageCalcResult {
  const vendorAttacker = buildVendorPokemon(attacker);
  const vendorDefender = buildVendorPokemon(defender);
  const vendorMove = buildVendorMove(moveName, attacker.isTerastallized, attacker.teraType);
  const vendorField = buildVendorField(battle, attackerSide);

  // Le moteur vendor applique le malus spread (-25%) dès que
  // field.format !== "Singles" && move.isSpread, SANS regarder combien
  // d'adversaires sont réellement visés — on corrige ça ici plutôt que
  // dans engine.js (fichier vendorisé, pas touché) en désactivant le flag
  // isSpread quand un seul adversaire est effectivement sur le terrain.
  if (vendorMove.isSpread && countLiveOpposingActives(battle, attackerSide) < 2) {
    vendorMove.isSpread = false;
  }

  const result = GET_DAMAGE_SV(vendorAttacker, vendorDefender, vendorMove, vendorField);

  const rolls = [...result.damage].sort((a, b) => a - b);
  const minDamage = rolls[0] ?? 0;
  const maxDamage = rolls[rolls.length - 1] ?? 0;
  const maxHp = vendorDefender.maxHP || 1;

  return {
    rolls,
    minDamage,
    maxDamage,
    minPercent: Math.round((minDamage / maxHp) * 1000) / 10,
    maxPercent: Math.round((maxDamage / maxHp) * 1000) / 10,
    description: result.description,
  };
}

/**
 * Variante pratique : calcule directement à partir des clés `pokemonByKey`
 * d'un BattleState plutôt que des objets PokemonState bruts.
 */
export function calculateDamageByKey(
  battle: BattleState,
  attackerKey: string,
  defenderKey: string,
  moveName: string,
  attackerSide: 'p1' | 'p2',
): DamageCalcResult {
  const attacker = battle.pokemonByKey[attackerKey];
  const defender = battle.pokemonByKey[defenderKey];
  if (!attacker || !defender) {
    throw new Error(
      `Pokémon introuvable dans le BattleState (attacker="${attackerKey}", defender="${defenderKey}").`,
    );
  }
  return calculateDamage(attacker, defender, moveName, battle, attackerSide);
}
