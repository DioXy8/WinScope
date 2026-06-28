/**
 * search/speedOrder.ts
 *
 * Détermine l'ordre dans lequel les actions d'un tour s'exécutent : par
 * priorité de move d'abord (Protect > Fake Out > moves normaux...), puis
 * par vitesse réelle (boosts, Tailwind, Trick Room) en cas d'égalité de
 * priorité.
 *
 * Les switches sont toujours résolus avant tous les moves (règle standard
 * Pokémon), donc ils ne rentrent pas dans ce calcul de vitesse — l'appelant
 * (outcomeSimulator.ts) doit les traiter en amont.
 */

import type { BattleState, PokemonState } from '../engine/state';
import { getMoveTargetInfo } from './actionGenerator';
import type { PlayerAction } from './actionTypes';

function applySpeedBoost(speed: number, stage: number): number {
  if (stage > 0) return Math.floor((speed * (2 + stage)) / 2);
  if (stage < 0) return Math.floor((speed * 2) / (2 - stage));
  return speed;
}

/**
 * Calcule la vitesse effective d'un Pokémon pour ce tour. `rawSpeed` doit
 * être la vraie vitesse calculée (base+IV+EV/SP+nature), fournie par
 * l'appelant (généralement via le même adapter que le damage calc) — ce
 * module ne recalcule pas les stats lui-même.
 */
export function computeEffectiveSpeed(
  pokemon: PokemonState,
  rawSpeed: number,
  isTailwindActive: boolean,
): number {
  let speed = applySpeedBoost(rawSpeed, pokemon.boosts.spe);
  if (pokemon.status === 'par') {
    speed = Math.floor(speed / 2);
  }
  if (isTailwindActive) {
    speed *= 2;
  }
  return speed;
}

export interface SpeedContext {
  effectiveSpeedByKey: Record<string, number>;
  isTrickRoomActive: boolean;
}

/** Construit le contexte de vitesse pour tous les actifs d'un BattleState, depuis des vitesses brutes fournies. */
export function buildSpeedContext(
  battle: BattleState,
  rawSpeedByKey: Record<string, number>,
): SpeedContext {
  const effectiveSpeedByKey: Record<string, number> = {};
  for (const [key, rawSpeed] of Object.entries(rawSpeedByKey)) {
    const pokemon = battle.pokemonByKey[key];
    if (!pokemon) {
      effectiveSpeedByKey[key] = rawSpeed;
      continue;
    }
    const side = pokemon.side;
    const isTailwindActive = battle.sides[side].isTailwind;
    effectiveSpeedByKey[key] = computeEffectiveSpeed(pokemon, rawSpeed, isTailwindActive);
  }
  return { effectiveSpeedByKey, isTrickRoomActive: battle.field.isTrickRoom };
}

function actionPriority(action: PlayerAction): number {
  if (action.kind === 'switch') return 0;
  const info = getMoveTargetInfo(action.moveName);
  return info?.priority ?? 0;
}

/**
 * Trie une liste d'actions (moves uniquement — pas les switches, déjà
 * résolus avant) dans leur ordre d'exécution réel pour ce tour : priorité
 * décroissante, puis vitesse (croissante si Trick Room actif, décroissante
 * sinon).
 *
 * En cas d'égalité totale (même priorité, même vitesse exacte), le vrai jeu
 * tire au hasard : on garde ici l'ordre d'entrée (stable), à charge à
 * l'appelant de traiter ce cas comme une branche de hasard si besoin.
 */
export function sortActionsBySpeed(actions: PlayerAction[], context: SpeedContext): PlayerAction[] {
  const indexed = actions.map((action, index) => ({ action, index }));

  indexed.sort((a, b) => {
    const prioDiff = actionPriority(b.action) - actionPriority(a.action);
    if (prioDiff !== 0) return prioDiff;

    const speedA = context.effectiveSpeedByKey[a.action.userKey] ?? 0;
    const speedB = context.effectiveSpeedByKey[b.action.userKey] ?? 0;
    const speedDiff = context.isTrickRoomActive ? speedA - speedB : speedB - speedA;
    if (speedDiff !== 0) return speedDiff;

    return a.index - b.index;
  });

  return indexed.map((i) => i.action);
}

/** true si l'action `a` s'exécute strictement avant l'action `b`, sans ambiguïté de vitesse égale. */
export function actsBefore(a: PlayerAction, b: PlayerAction, context: SpeedContext): boolean {
  const prioA = actionPriority(a);
  const prioB = actionPriority(b);
  if (prioA !== prioB) return prioA > prioB;

  const speedA = context.effectiveSpeedByKey[a.userKey] ?? 0;
  const speedB = context.effectiveSpeedByKey[b.userKey] ?? 0;
  if (speedA === speedB) return false;
  return context.isTrickRoomActive ? speedA < speedB : speedA > speedB;
}
