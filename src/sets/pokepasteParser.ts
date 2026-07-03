/**
 * sets/pokepasteParser.ts
 *
 * Parse un PokéPaste (format d'export standard Showdown/PokePaste.es, 6
 * blocs séparés par une ligne vide) en une liste de ParsedPokePasteSet.
 *
 * Ce module ne connaît RIEN du BattleState ni du moteur vendor : il produit
 * une représentation neutre, ensuite convertie en PartialPokemonSet (voir
 * toPartialPokemonSet) et branchée sur les PokemonState correspondants par
 * sets/applyUserSets.ts.
 *
 * Normalisation Mega : on réutilise volontairement la même règle que
 * replay/logParser.ts (parsePokemonDetails) — un PokéPaste écrit le nom de
 * forme Mega en suffixe ("Delphox-Mega", "Charizard-Mega-X", exactement
 * comme le protocole Showdown), donc species est ramenée à l'espèce de
 * base pour que la clé produite corresponde à `${side}:${species}` dans
 * pokemonByKey (cf. engine/reducer.ts::pokemonKey).
 */

import type { PartialPokemonSet } from '../engine/state';
import type { StatId } from '../replay/types';

const STAT_ABBREVIATIONS: Record<string, StatId | 'hp'> = {
  hp: 'hp',
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};

export interface ParsedPokePasteSet {
  /** Surnom donné dans le paste, si présent (ex: "Nickname (Species)"). */
  nickname: string | null;
  /**
   * Espèce de BASE, normalisée (le suffixe "-Mega"/"-Mega-X"/"-Mega-Y" a
   * été retiré) — c'est cette valeur qui doit matcher PokemonState.species.
   */
  species: string;
  /** true si le paste liste ce Pokémon sous sa forme Mega (donc porte une Mega Stone). */
  isMegaInPaste: boolean;
  megaVariant: 'X' | 'Y' | null;
  gender: 'M' | 'F' | null;
  item: string | null;
  ability: string | null;
  level: number;
  shiny: boolean;
  teraType: string | null;
  nature: string | null;
  evs: Partial<Record<StatId | 'hp', number>>;
  ivs: Partial<Record<StatId | 'hp', number>>;
  moves: string[];
}

function createEmptyParsedSet(): ParsedPokePasteSet {
  return {
    nickname: null,
    species: '',
    isMegaInPaste: false,
    megaVariant: null,
    gender: null,
    item: null,
    ability: null,
    level: 100,
    shiny: false,
    teraType: null,
    nature: null,
    evs: {},
    ivs: {},
    moves: [],
  };
}

/**
 * Alias d'espèces : certains Pokémon sont désignés par un raccourci courant
 * dans les PokéPaste communautaires qui ne correspond PAS au nom exact
 * utilisé dans POKEDEX_CHAMPIONS / le protocole replay. Actuellement connu :
 *
 *  - "Floette" : la seule Floette capable de Mega-évoluer dans Champions
 *    est modélisée sous le nom "Floette-Eternal" (comme la vraie Eternal
 *    Flower Floette des jeux principaux), qui n'a PAS de nom "Floette" nu
 *    dans la dex. Mais la convention communautaire écrit couramment
 *    "Floette-Mega" plutôt que "Floette-Eternal-Mega" — une fois le
 *    suffixe "-Mega" retiré on obtient donc "Floette", qui ne matcherait
 *    jamais rien sans cet alias.
 *
 * Si un autre cas similaire est découvert, l'ajouter ici plutôt que dans la
 * logique de normalisation générique.
 */
const SPECIES_ALIASES: Record<string, string> = {
  Floette: 'Floette-Eternal',
};

function applySpeciesAlias(species: string): string {
  return SPECIES_ALIASES[species] ?? species;
}

/** Retire le suffixe "-Mega"/"-Mega-X"/"-Mega-Y" d'un nom d'espèce, comme parsePokemonDetails. */
function normalizeMegaSpecies(rawSpecies: string): {
  species: string;
  isMegaInPaste: boolean;
  megaVariant: 'X' | 'Y' | null;
} {
  const megaSuffixMatch = rawSpecies.match(/^(.+)-Mega(-[XY])?$/);
  if (!megaSuffixMatch) {
    return { species: applySpeciesAlias(rawSpecies), isMegaInPaste: false, megaVariant: null };
  }
  return {
    species: applySpeciesAlias(megaSuffixMatch[1]),
    isMegaInPaste: true,
    megaVariant: (megaSuffixMatch[2]?.slice(1) ?? null) as 'X' | 'Y' | null,
  };
}

/**
 * Parse la première ligne d'un bloc, ex :
 *   "Floette-Mega (F) @ Floettite"
 *   "Sinistcha @ Occa Berry"
 *   "Incineroar-Therian"           (pas d'item)
 *   "Ash (Pikachu) @ Light Ball"   (surnom + espèce)
 */
function parseFirstLine(line: string): {
  nickname: string | null;
  rawSpecies: string;
  gender: 'M' | 'F' | null;
  item: string | null;
} {
  let rest = line.trim();
  let item: string | null = null;

  const atIdx = rest.indexOf(' @ ');
  if (atIdx !== -1) {
    item = rest.slice(atIdx + 3).trim();
    rest = rest.slice(0, atIdx).trim();
  }

  let gender: 'M' | 'F' | null = null;
  let nickname: string | null = null;

  const parenMatch = rest.match(/^(.+?)\s+\(([^)]+)\)$/);
  if (parenMatch) {
    const inner = parenMatch[2];
    if (inner === 'M' || inner === 'F') {
      gender = inner;
      rest = parenMatch[1].trim();
    } else {
      // "Nickname (Species)" : le contenu des parenthèses est l'espèce réelle.
      nickname = parenMatch[1].trim();
      rest = inner.trim();
    }
  }

  return { nickname, rawSpecies: rest, gender, item };
}

/** Parse une ligne "EVs: 11 HP / 5 Def / 18 SpA / 32 Spe" ou "IVs: 0 Atk / 30 SpD". */
function parseStatLine(line: string): Partial<Record<StatId | 'hp', number>> {
  const colonIdx = line.indexOf(':');
  const body = colonIdx !== -1 ? line.slice(colonIdx + 1) : line;
  const result: Partial<Record<StatId | 'hp', number>> = {};

  for (const chunk of body.split('/')) {
    const match = chunk.trim().match(/^(\d+)\s+(\w+)$/);
    if (!match) continue;
    const [, amountRaw, abbrevRaw] = match;
    const statKey = STAT_ABBREVIATIONS[abbrevRaw.toLowerCase()];
    if (!statKey) continue;
    result[statKey] = parseInt(amountRaw, 10);
  }

  return result;
}

/** Parse un seul bloc (un Pokémon) d'un PokéPaste. */
function parsePokePasteBlock(block: string): ParsedPokePasteSet {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result = createEmptyParsedSet();
  if (lines.length === 0) return result;

  const { nickname, rawSpecies, gender, item } = parseFirstLine(lines[0]);
  const { species, isMegaInPaste, megaVariant } = normalizeMegaSpecies(rawSpecies);
  result.nickname = nickname;
  result.species = species;
  result.isMegaInPaste = isMegaInPaste;
  result.megaVariant = megaVariant;
  result.gender = gender;
  result.item = item && item.length > 0 ? item : null;

  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) {
      const move = line.replace(/^-+\s*/, '').trim();
      if (move.length > 0) result.moves.push(move);
      continue;
    }

    const abilityMatch = line.match(/^Ability:\s*(.+)$/i);
    if (abilityMatch) {
      result.ability = abilityMatch[1].trim();
      continue;
    }

    const levelMatch = line.match(/^Level:\s*(\d+)$/i);
    if (levelMatch) {
      result.level = parseInt(levelMatch[1], 10);
      continue;
    }

    const shinyMatch = line.match(/^Shiny:\s*(Yes|No)$/i);
    if (shinyMatch) {
      result.shiny = shinyMatch[1].toLowerCase() === 'yes';
      continue;
    }

    const teraMatch = line.match(/^Tera Type:\s*(.+)$/i);
    if (teraMatch) {
      result.teraType = teraMatch[1].trim();
      continue;
    }

    const evMatch = line.match(/^EVs:/i);
    if (evMatch) {
      result.evs = parseStatLine(line);
      continue;
    }

    const ivMatch = line.match(/^IVs:/i);
    if (ivMatch) {
      result.ivs = parseStatLine(line);
      continue;
    }

    // "Timid Nature" (format standard) ou "Nature: Timid" (format alternatif).
    const natureSuffixMatch = line.match(/^(\w+)\s+Nature$/i);
    if (natureSuffixMatch) {
      result.nature = natureSuffixMatch[1];
      continue;
    }
    const naturePrefixMatch = line.match(/^Nature:\s*(\w+)$/i);
    if (naturePrefixMatch) {
      result.nature = naturePrefixMatch[1];
      continue;
    }
    // Ligne non reconnue (Happiness, Hidden Power, commentaire...) : ignorée
    // volontairement, sans erreur, pour ne jamais bloquer le parsing global.
  }

  return result;
}

/**
 * Parse un PokéPaste complet (6 Pokémon, blocs séparés par une ou plusieurs
 * lignes vides). Les blocs vides ou mal formés (sans espèce identifiable)
 * sont silencieusement ignorés plutôt que de lever une erreur, pour rester
 * tolérant aux variations de mise en forme (espaces en trop, saut de ligne
 * final, etc.).
 */
export function parsePokePaste(raw: string): ParsedPokePasteSet[] {
  const blocks = raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  return blocks.map(parsePokePasteBlock).filter((set) => set.species.length > 0);
}

/**
 * Convertit un ParsedPokePasteSet en PartialPokemonSet (le format attendu
 * par PokemonState.userProvidedSet, cf. engine/state.ts). Les champs
 * ability/item/nature non trouvés dans le paste restent `null` plutôt que
 * de forcer une valeur, pour laisser adapter.ts retomber sur knownSet ou
 * les valeurs par défaut si besoin.
 */
export function toPartialPokemonSet(parsed: ParsedPokePasteSet): PartialPokemonSet {
  return {
    ability: parsed.ability,
    item: parsed.item,
    nature: parsed.nature,
    evs: parsed.evs,
    ivs: parsed.ivs,
    teraType: parsed.teraType,
    moves: parsed.moves,
  };
}
