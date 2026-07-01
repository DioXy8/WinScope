/**
 * sets/applyUserSets.ts
 *
 * Branche les ParsedPokePasteSet (issus du PokéPaste permanent collé par
 * l'utilisateur, cf. sets/pokepasteParser.ts) sur les PokemonState d'un
 * BattleState[] déjà construit par engine/reducer.ts.
 *
 * Règle du projet (cf. décision d'architecture) : le PokéPaste collé
 * appartient TOUJOURS à l'utilisateur, jamais à l'adversaire. On doit donc
 * d'abord déterminer automatiquement si son équipe correspond à p1 ou p2
 * dans CE replay précis (le même joueur peut apparaître des deux côtés
 * selon les replays), avant d'assigner userProvidedSet.
 */

import type { BattleState, PokemonState } from '../engine/state';
import { toPartialPokemonSet, type ParsedPokePasteSet } from './pokepasteParser';

export interface PokePasteMatchResult {
  /** Le côté identifié comme appartenant à l'utilisateur, ou null si aucun match fiable. */
  side: 'p1' | 'p2' | null;
  /** Nombre d'espèces du paste retrouvées de ce côté (sur les 6 attendues). */
  matchedCount: number;
}

/**
 * Détermine quel côté (p1/p2) correspond le mieux au PokéPaste, en comptant
 * combien d'espèces du paste apparaissent dans le roster de chaque côté
 * (déduit de TOUS les BattleState, pas seulement le premier, pour capter
 * les Pokémon qui ne sont révélés qu'après le Team Preview initial —
 * ce qui ne devrait normalement pas arriver mais reste robuste).
 *
 * On exige au moins la moitié de l'équipe (>= 3/6) pour éviter un faux
 * positif sur un replay sans rapport avec le paste collé.
 */
export function matchPokePasteToSide(
  states: BattleState[],
  parsedSets: ParsedPokePasteSet[],
): PokePasteMatchResult {
  if (parsedSets.length === 0 || states.length === 0) {
    return { side: null, matchedCount: 0 };
  }

  const pasteSpecies = new Set(parsedSets.map((p) => p.species));
  const seenSpeciesBySide: Record<'p1' | 'p2', Set<string>> = { p1: new Set(), p2: new Set() };

  for (const state of states) {
    for (const pokemon of Object.values(state.pokemonByKey)) {
      seenSpeciesBySide[pokemon.side].add(pokemon.species);
    }
  }

  const countMatches = (side: 'p1' | 'p2') =>
    [...pasteSpecies].filter((species) => seenSpeciesBySide[side].has(species)).length;

  const p1Matches = countMatches('p1');
  const p2Matches = countMatches('p2');

  const best = p1Matches >= p2Matches ? 'p1' : 'p2';
  const bestCount = Math.max(p1Matches, p2Matches);

  const minRequired = Math.ceil(parsedSets.length / 2);
  if (bestCount < minRequired) {
    return { side: null, matchedCount: bestCount };
  }

  return { side: best, matchedCount: bestCount };
}

/**
 * Retourne un nouveau BattleState[] où chaque PokemonState du côté
 * identifié comme celui de l'utilisateur a son `userProvidedSet` rempli
 * depuis le PokéPaste correspondant (matché par species). Les Pokémon du
 * côté adverse, ou du côté utilisateur sans entrée correspondante dans le
 * paste (roster imprévu), ne sont pas modifiés.
 *
 * Ne mute rien : produit de nouveaux objets BattleState/PokemonState
 * conformément à la règle d'immutabilité du moteur (cf. engine/state.ts).
 */
export function applyUserPokePasteToStates(
  states: BattleState[],
  parsedSets: ParsedPokePasteSet[],
): { states: BattleState[]; match: PokePasteMatchResult } {
  const match = matchPokePasteToSide(states, parsedSets);
  if (!match.side) {
    return { states, match };
  }

  const setsBySpecies = new Map(parsedSets.map((p) => [p.species, toPartialPokemonSet(p)]));
  const userSide = match.side;

  const nextStates = states.map((state) => {
    let changed = false;
    const nextPokemonByKey: Record<string, PokemonState> = { ...state.pokemonByKey };

    for (const [key, pokemon] of Object.entries(state.pokemonByKey)) {
      if (pokemon.side !== userSide) continue;
      const userSet = setsBySpecies.get(pokemon.species);
      if (!userSet) continue;
      // Rien à faire si déjà à jour (évite de recréer l'objet à chaque
      // tour une fois assigné, mais l'assignation est idempotente donc ce
      // n'est qu'une optimisation, pas une nécessité de correction).
      if (pokemon.userProvidedSet === userSet) continue;
      nextPokemonByKey[key] = { ...pokemon, userProvidedSet: userSet };
      changed = true;
    }

    return changed ? { ...state, pokemonByKey: nextPokemonByKey } : state;
  });

  return { states: nextStates, match };
}
