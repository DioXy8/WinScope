/**
 * sets/referenceSets.ts
 *
 * Sets de référence pour les Pokémon adverses dont on n'a ni set révélé par
 * le replay (knownSet), ni PokéPaste utilisateur (userProvidedSet) — le cas
 * par défaut pour toute l'équipe adverse.
 *
 * Source des données : setdex_ncp-g10.js du NCP VGC Damage Calculator
 * (github.com/nerd-of-now/NCP-VGC-Damage-Calculator), la référence
 * communautaire pour les sets Champions Reg M-B, extraite et nettoyée en
 * JSON dans data/referenceSetsChampions.json. Toutes les espèces/natures/
 * objets/talents/moves de ce fichier ont été vérifiés comme présents dans
 * notre propre championsData.json (les deux jeux de données dérivent de la
 * même source), donc aucune conversion de nom n'est nécessaire.
 *
 * Le champ "sps" de ce fichier est DÉJÀ sur l'échelle Stat Points 0-32 de
 * Pokémon Champions (cf. damagecalc/adapter.ts::computeRawStats) — pas
 * besoin de le diviser ou multiplier, contrairement à ce qu'on aurait fait
 * avec une échelle EV classique 0-252.
 */

import referenceSetsData from './data/referenceSetsChampions.json';
import type { PartialPokemonSet } from '../engine/state';
import type { StatId } from '../replay/types';

interface RawReferenceStatPoints {
  hp: number;
  at: number;
  df: number;
  sa: number;
  sd: number;
  sp: number;
}

interface RawReferenceSet {
  sps: RawReferenceStatPoints;
  nature: string;
  item?: string;
  ability?: string;
  moves: string[];
}

const REFERENCE_SETS: Record<string, Record<string, RawReferenceSet>> = referenceSetsData as Record<
  string,
  Record<string, RawReferenceSet>
>;

export interface ReferenceSet {
  /** Nom du set tel que catalogué par NCP (ex: "Balanced Bulk Sitrus"), utile pour l'affichage/debug. */
  setName: string;
  species: string;
  nature: string;
  item: string | null;
  ability: string | null;
  /** Stat Points 0-32 par stat, même échelle que PartialPokemonSet.evs. */
  evs: Partial<Record<StatId | 'hp', number>>;
  moves: string[];
}

function convertRawSet(species: string, setName: string, raw: RawReferenceSet): ReferenceSet {
  return {
    setName,
    species,
    nature: raw.nature,
    item: raw.item ?? null,
    ability: raw.ability ?? null,
    evs: {
      hp: raw.sps.hp,
      atk: raw.sps.at,
      def: raw.sps.df,
      spa: raw.sps.sa,
      spd: raw.sps.sd,
      spe: raw.sps.sp,
    },
    moves: raw.moves,
  };
}

/**
 * Tous les sets de référence connus pour une espèce. La clé attendue est
 * l'espèce de BASE (ex: "Floette-Eternal", jamais "Mega Floette") — c'est
 * ainsi que le PokemonState.species et le dex NCP la nomment tous les deux,
 * la Mega Stone étant simplement l'item du set plutôt qu'un changement
 * d'espèce. Retourne un tableau vide si l'espèce n'a aucun set catalogué.
 */
export function getReferenceSets(species: string): ReferenceSet[] {
  const sets = REFERENCE_SETS[species];
  if (!sets) return [];
  return Object.entries(sets).map(([name, raw]) => convertRawSet(species, name, raw));
}

/**
 * Choisit le set de référence le plus plausible pour ce Pokémon. Quand des
 * moves ont déjà été révélés en combat, on privilégie le set de référence
 * dont les moves catalogués recoupent le plus ces moves réels (le meilleur
 * indice disponible sur le set effectivement joué par l'adversaire) ; en
 * cas d'égalité ou si rien n'est encore révélé, on retombe sur le premier
 * set catalogué. Retourne null si l'espèce n'a aucun set de référence.
 */
export function pickBestReferenceSet(species: string, revealedMoves: string[]): ReferenceSet | null {
  const candidates = getReferenceSets(species);
  if (candidates.length === 0) return null;
  if (revealedMoves.length === 0) return candidates[0];

  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = revealedMoves.filter((move) => candidate.moves.includes(move)).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Convertit un ReferenceSet en PartialPokemonSet, pour réutiliser exactement le même contrat que knownSet/userProvidedSet. */
export function referenceSetToPartialPokemonSet(referenceSet: ReferenceSet): PartialPokemonSet {
  return {
    ability: referenceSet.ability,
    item: referenceSet.item,
    nature: referenceSet.nature,
    evs: referenceSet.evs,
    ivs: {},
    teraType: null,
  };
}
