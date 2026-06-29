/**
 * replay/types.ts
 *
 * Types représentant le protocole de simulation Pokémon Showdown.
 * Référence officielle :
 *   https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md
 *
 * Le log d'un replay est une suite de lignes commençant par "|TYPE|arg1|arg2|...".
 * On ne modélise ici QUE les messages utiles à la reconstruction de l'état de
 * jeu (on ignore volontairement le chat, les habillages cosmétiques, etc.)
 */

/** Identifiant de position d'un Pokémon, ex: "p1a", "p2b". */
export type PokemonPosition = `${'p1' | 'p2' | 'p3' | 'p4'}${'a' | 'b' | 'c' | 'd'}`;

/** Un "Pokémon ID" tel qu'utilisé dans le protocole : "p1a: Sparky". */
export interface PokemonIdent {
  /** Position complète, ex "p1a". Absente pour un Pokémon non-actif (ex: cible de Heal Bell). */
  position: PokemonPosition | null;
  /** Le side seul, ex "p1". Toujours présent. */
  side: 'p1' | 'p2' | 'p3' | 'p4';
  /** Surnom ou nom d'espèce affiché. */
  name: string;
  /** La chaîne brute originale, ex "p1a: Sparky". Utile pour debug/affichage. */
  raw: string;
}

/** Les infos visibles d'un Pokémon : "Sawsbuck, L50, F, shiny, tera:Water" */
export interface PokemonDetails {
  species: string;
  level: number; // 100 par défaut si absent
  gender: 'M' | 'F' | null;
  shiny: boolean;
  teraType: string | null;
  /** true si la forme n'est pas connue (Team Preview, ex: "Arceus-*") */
  formeUnknown: boolean;
  /** true si la chaîne DETAILS indiquait une forme Mega (ex: "Swampert-Mega"). */
  isMegaForme: boolean;
  /** Espèce de base si isMegaForme est true (ex: "Swampert" pour "Swampert-Mega"), sinon null. */
  baseSpeciesIfMega: string | null;
  /** "X" ou "Y" pour les Mega à variante (Charizard, Mewtwo...), sinon null. */
  megaVariant: 'X' | 'Y' | null;
}

export type StatusCondition = 'slp' | 'par' | 'frz' | 'brn' | 'psn' | 'tox' | '';

/** HP + statut tel que rapporté par le protocole : "97/100 par" ou "0 fnt". */
export interface HpStatus {
  hp: number;
  maxHp: number;
  isPercentage: boolean;
  status: StatusCondition;
  fainted: boolean;
}

export type StatId = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface RawTaggedLine {
  type: string;
  args: string[];
  tags: Record<string, string | true>;
  raw: string;
}

export interface TurnLine extends RawTaggedLine {
  turn: number;
}

export interface ParsedTeamPreviewPokemon {
  side: 'p1' | 'p2';
  details: PokemonDetails;
  hasItem: boolean;
}

export interface ParsedPlayer {
  side: 'p1' | 'p2';
  username: string;
  avatar: string;
  rating: number | null;
}

export interface ParsedReplayLog {
  format: string;
  gametype: 'singles' | 'doubles' | 'triples' | 'multi' | 'freeforall';
  genNum: number;
  tier: string;
  rules: string[];
  players: ParsedPlayer[];
  teamPreview: ParsedTeamPreviewPokemon[];
  teamSizes: Partial<Record<'p1' | 'p2', number>>;
  turns: TurnLine[][];
  winner: string | null;
  isTie: boolean;
}
