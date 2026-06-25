/**
 * engine/pokemon.ts
 *
 * Fonctions pures de transformation d'un PokemonState. Chaque fonction
 * prend un état et retourne un NOUVEL état (immutabilité), jamais de
 * mutation en place — c'est ce qui permet au reducer de garder un
 * historique complet rejouable.
 *
 * Ce module ne sait pas lire le protocole replay : il expose juste le
 * vocabulaire ("inflige X dégâts", "applique ce boost") que le reducer
 * appelle en réponse aux lignes du log.
 */

import type { StatId, StatusCondition } from '../replay/types';
import type { PokemonState } from './state';

/** Clamp un boost de stat dans l'intervalle [-6, +6] imposé par le jeu. */
export function clampBoost(value: number): number {
  return Math.max(-6, Math.min(6, value));
}

export function applyBoost(
  pokemon: PokemonState,
  stat: StatId,
  delta: number,
): PokemonState {
  return {
    ...pokemon,
    boosts: {
      ...pokemon.boosts,
      [stat]: clampBoost(pokemon.boosts[stat] + delta),
    },
  };
}

export function setBoost(pokemon: PokemonState, stat: StatId, value: number): PokemonState {
  return {
    ...pokemon,
    boosts: {
      ...pokemon.boosts,
      [stat]: clampBoost(value),
    },
  };
}

/** Remet tous les boosts à 0 (ex: Haze, switch out, Clear Smog côté receveur dans certains cas). */
export function clearBoosts(pokemon: PokemonState): PokemonState {
  return {
    ...pokemon,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
}

/**
 * Met à jour les HP courants. `isPercentage` indique si la valeur fournie
 * est un pourcentage (vue adverse sans maxHp connu) ou une valeur absolue.
 */
export function setHp(
  pokemon: PokemonState,
  hp: number,
  maxHp: number,
  isPercentage: boolean,
): PokemonState {
  return {
    ...pokemon,
    currentHp: hp,
    // On ne réduit jamais un maxHp déjà connu en absolu vers une simple lecture
    // en pourcentage : une fois le vrai max vu, on le garde.
    maxHp: !isPercentage ? maxHp : pokemon.maxHp,
    hpIsPercentage: pokemon.maxHp !== null ? false : isPercentage,
    fainted: hp <= 0,
  };
}

export function applyStatus(pokemon: PokemonState, status: StatusCondition): PokemonState {
  return { ...pokemon, status, statusTurns: 0 };
}

export function clearStatus(pokemon: PokemonState): PokemonState {
  return { ...pokemon, status: '', statusTurns: 0 };
}

export function addVolatile(pokemon: PokemonState, volatile: string): PokemonState {
  const next = new Set(pokemon.volatiles);
  next.add(volatile);
  return { ...pokemon, volatiles: next };
}

export function removeVolatile(pokemon: PokemonState, volatile: string): PokemonState {
  const next = new Set(pokemon.volatiles);
  next.delete(volatile);
  return { ...pokemon, volatiles: next };
}

/** Enregistre qu'un move a été vu utilisé par ce Pokémon (idempotent). */
export function revealMove(pokemon: PokemonState, moveName: string): PokemonState {
  if (pokemon.revealedMoves.includes(moveName)) return pokemon;
  return {
    ...pokemon,
    revealedMoves: [...pokemon.revealedMoves, moveName],
    knownSet: { ...pokemon.knownSet },
  };
}

export function revealItem(pokemon: PokemonState, itemName: string): PokemonState {
  return {
    ...pokemon,
    revealedItem: itemName,
    itemConsumed: false,
    knownSet: { ...pokemon.knownSet, item: itemName },
  };
}

/** L'objet a été consommé (mangé, volé, détruit) ou retiré (Knock Off). */
export function consumeItem(pokemon: PokemonState): PokemonState {
  return { ...pokemon, itemConsumed: true };
}

export function revealAbility(pokemon: PokemonState, abilityName: string): PokemonState {
  return {
    ...pokemon,
    revealedAbility: abilityName,
    knownSet: { ...pokemon.knownSet, ability: abilityName },
  };
}

export function setTerastallized(pokemon: PokemonState, teraType: string): PokemonState {
  return {
    ...pokemon,
    isTerastallized: true,
    teraType,
    knownSet: { ...pokemon.knownSet, teraType },
  };
}

/** Place ce Pokémon à une position donnée du terrain (switch-in). */
export function setPosition(
  pokemon: PokemonState,
  position: PokemonState['position'],
): PokemonState {
  return { ...pokemon, position };
}

/**
 * Réinitialise tout ce qui doit disparaître quand un Pokémon quitte le
 * terrain (switch out ou faint) : boosts, volatiles. Les infos révélées
 * (moves, item, ability) restent en mémoire, car connues définitivement.
 */
export function resetOnSwitchOut(pokemon: PokemonState): PokemonState {
  return {
    ...pokemon,
    position: null,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    volatiles: new Set(),
  };
}

export function markFainted(pokemon: PokemonState): PokemonState {
  return { ...pokemon, currentHp: 0, fainted: true, position: null };
}
