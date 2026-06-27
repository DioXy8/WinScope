/**
 * damagecalc/vendor/engine.d.ts
 *
 * Déclarations de types minimales pour engine.js (moteur vendor JS pur).
 * Les types précis des objets Pokemon/Field/Move attendus par ce moteur
 * sont documentés et construits dans damagecalc/types.ts et adapter.ts ;
 * ici on se contente de typer la signature des fonctions exportées avec
 * `any` côté objets composites, car le moteur original n'a jamais été
 * conçu avec des types stricts (c'est un fichier JS vanilla des années
 * 2010s), et sur-typer ces objets ici dupliquerait inutilement le contrat
 * déjà documenté ailleurs.
 */

export interface VendorDamageResult {
  damage: number[];
  description: string;
}

export function GET_DAMAGE_SV(
  attacker: any,
  defender: any,
  move: any,
  field: any,
): VendorDamageResult;

export function GET_DAMAGE_HANDLER(
  attacker: any,
  defender: any,
  move: any,
  field: any,
): VendorDamageResult;

export function getKOChance(
  attacker: any,
  defender: any,
  move: any,
  field: any,
  damageResult: VendorDamageResult,
): any;

export function getKOChanceText(
  attacker: any,
  defender: any,
  move: any,
  field: any,
  damageResult: VendorDamageResult,
): string;

export const AT: string;
export const DF: string;
export const SA: string;
export const SD: string;
export const SP: string;
export const SL: string;
