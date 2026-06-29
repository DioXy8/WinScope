/**
 * replay/logParser.ts
 *
 * Transforme le log brut (string, lignes séparées par \n, format
 * "|TYPE|arg1|arg2|...") en une structure ParsedReplayLog exploitable.
 *
 * Ce module NE CONTIENT AUCUNE LOGIQUE DE JEU : il découpe et typifie, mais
 * ne sait pas ce qu'un "-boost" signifie pour l'état de la partie. Cette
 * logique vit dans engine/reducer.ts.
 */

import type {
  HpStatus,
  ParsedPlayer,
  ParsedReplayLog,
  ParsedTeamPreviewPokemon,
  PokemonDetails,
  PokemonIdent,
  RawTaggedLine,
  StatusCondition,
  TurnLine,
} from './types';

/**
 * Découpe une seule ligne brute "|type|arg1|arg2|[tag1]|[tag2] val" en RawTaggedLine.
 * Les tags (`[from] ability: Intimidate`, `[of] p1a: Landorus`, `[miss]`, `[still]`...)
 * sont extraits dans `tags` plutôt que de polluer `args`.
 */
/**
 * Liste fermée des noms de tags utilisés par le protocole Showdown.
 * On restreint volontairement à cette liste (plutôt qu'un regex générique
 * sur "tout ce qui est entre crochets") car certains champs légitimes
 * commencent eux-mêmes par des crochets sans être des tags, par exemple
 * le tier "[Gen 9] VGC 2025 Reg H (Bo3)" dans une ligne "|tier|...".
 */
const KNOWN_TAGS = new Set([
  'from',
  'of',
  'miss',
  'still',
  'silent',
  'anim',
  'upkeep',
  'eat',
  'msg',
  'name',
  'intoxicated',
  'zeffect',
  'consumed',
  'damage',
  'identify',
  'weaken',
  'block',
]);

export function parseLine(rawLine: string): RawTaggedLine | null {
  const line = rawLine.replace(/\r$/, '');
  if (!line.startsWith('|')) {
    // Ligne hors-protocole (ex: ligne vide entre deux blocs) -> ignorée par l'appelant.
    return null;
  }

  const parts = line.split('|');
  // parts[0] est toujours '' (la ligne commence par '|')
  const type = parts[1] ?? '';
  const rest = parts.slice(2);

  const args: string[] = [];
  const tags: Record<string, string | true> = {};

  for (const token of rest) {
    const tagMatch = token.match(/^\[([a-zA-Z0-9]+)\](.*)$/);
    if (tagMatch && KNOWN_TAGS.has(tagMatch[1].toLowerCase())) {
      const key = tagMatch[1].toLowerCase();
      const value = tagMatch[2].trim();
      tags[key] = value === '' ? true : value;
    } else {
      args.push(token);
    }
  }

  return { type, args, tags, raw: line };
}

/** Parse l'identifiant d'un Pokémon, ex: "p1a: Sparky" ou "p2: Dragonite" (inactif). */
export function parsePokemonIdent(raw: string): PokemonIdent {
  const colonIndex = raw.indexOf(':');
  const posPart = (colonIndex === -1 ? raw : raw.slice(0, colonIndex)).trim();
  const name = (colonIndex === -1 ? '' : raw.slice(colonIndex + 1)).trim();

  const sideMatch = posPart.match(/^(p[1-4])([a-d])?$/);
  if (!sideMatch) {
    // Forme inattendue : on retombe sur un side par défaut pour ne pas planter le parsing,
    // l'appelant pourra logguer un warning si besoin.
    return { position: null, side: 'p1', name: name || posPart, raw };
  }

  const side = sideMatch[1] as ParsedPlayer['side'];
  const letter = sideMatch[2];
  const position = letter ? (`${side}${letter}` as PokemonIdent['position']) : null;

  return { position, side, name, raw };
}

/** Parse une chaîne DETAILS, ex: "Sawsbuck, L50, F, shiny, tera:Water" ou "Arceus-*". */
export function parsePokemonDetails(raw: string): PokemonDetails {
  const segments = raw.split(',').map((s) => s.trim());
  let species = segments[0] ?? raw;
  const formeUnknown = species.endsWith('-*');
  if (formeUnknown) species = species.slice(0, -2);

  // Showdown nomme les formes Mega "Espèce-Mega" (ex: "Swampert-Mega",
  // "Charizard-Mega-X"), notamment quand un Pokémon déjà Mega-évolué
  // switch out puis revient sur le terrain plus tard dans le match (le
  // |-mega| initial n'est émis qu'une fois). On normalise ici vers
  // l'espèce de base + un flag séparé, pour que la clé pokemonByKey reste
  // stable (`p1:Swampert`, pas `p1:Swampert-Mega`) et que isMegaEvolved
  // soit (re)détectable même sans revoir la ligne |-mega| d'origine.
  const megaSuffixMatch = species.match(/^(.+)-Mega(-[XY])?$/);
  const isMegaForme = megaSuffixMatch !== null;
  const baseSpeciesIfMega = megaSuffixMatch ? megaSuffixMatch[1] : null;
  const megaVariant = (megaSuffixMatch?.[2]?.slice(1) ?? null) as 'X' | 'Y' | null;
  if (megaSuffixMatch) {
    species = megaSuffixMatch[1];
  }

  let level = 100;
  let gender: 'M' | 'F' | null = null;
  let shiny = false;
  let teraType: string | null = null;

  for (const seg of segments.slice(1)) {
    if (/^L\d+$/.test(seg)) {
      level = parseInt(seg.slice(1), 10);
    } else if (seg === 'M' || seg === 'F') {
      gender = seg;
    } else if (seg === 'shiny') {
      shiny = true;
    } else if (seg.startsWith('tera:')) {
      teraType = seg.slice('tera:'.length);
    }
  }

  return {
    species,
    level,
    gender,
    shiny,
    teraType,
    formeUnknown,
    isMegaForme,
    baseSpeciesIfMega,
    megaVariant,
  };
}

/**
 * Parse une chaîne HP STATUS, ex: "97/100 par", "0 fnt", "55/55", "/100" (vue adverse masquée).
 */
export function parseHpStatus(raw: string): HpStatus {
  const trimmed = raw.trim();
  const [hpPart, statusPart] = trimmed.split(' ');
  const status = (statusPart ?? '') as StatusCondition;

  if (hpPart === '0') {
    return { hp: 0, maxHp: 0, isPercentage: false, status, fainted: true };
  }

  const [hpStr, maxStr] = hpPart.split('/');
  const hp = hpStr === '' ? 0 : parseInt(hpStr, 10);
  const maxHp = maxStr !== undefined ? parseInt(maxStr, 10) : hp;

  // HP Percentage Mod (vue adverse) : le max est typiquement 100 (ou 48 sans le mod).
  // On ne peut pas distinguer formellement "vrai max=100" de "pourcentage=100" sans
  // contexte additionnel ; le reducer décide en fonction du side (le sien = absolu,
  // l'adverse = pourcentage si le mod est actif). On expose juste maxHp tel que lu ici.
  const isPercentage = maxStr === '100' || maxStr === '48';

  return { hp, maxHp, isPercentage, status, fainted: hp === 0 };
}

/**
 * Parse le log complet d'un replay en structure typée et groupée par tour.
 */
export function parseReplayLog(log: string): ParsedReplayLog {
  const lines = log.split('\n');

  const result: ParsedReplayLog = {
    format: '',
    gametype: 'doubles',
    genNum: 9,
    tier: '',
    rules: [],
    players: [],
    teamPreview: [],
    teamSizes: {},
    turns: [[]],
    winner: null,
    isTie: false,
  };

  let currentTurn = 0;

  for (const rawLine of lines) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;

    switch (parsed.type) {
      case 'player': {
        const [side, username, avatar, ratingStr] = parsed.args;
        if (username) {
          result.players.push({
            side: side as ParsedPlayer['side'],
            username,
            avatar: avatar ?? '',
            rating: ratingStr ? parseInt(ratingStr, 10) || null : null,
          });
        }
        break;
      }
      case 'gametype': {
        result.gametype = parsed.args[0] as ParsedReplayLog['gametype'];
        break;
      }
      case 'gen': {
        result.genNum = parseInt(parsed.args[0], 10);
        break;
      }
      case 'tier': {
        result.tier = parsed.args[0] ?? '';
        result.format = result.tier;
        break;
      }
      case 'rule': {
        result.rules.push(parsed.args[0] ?? '');
        break;
      }
      case 'teamsize': {
        const [side, sizeStr] = parsed.args;
        if (side === 'p1' || side === 'p2') {
          result.teamSizes[side] = parseInt(sizeStr, 10);
        }
        break;
      }
      case 'poke': {
        const [side, detailsStr, itemFlag] = parsed.args;
        if (side === 'p1' || side === 'p2') {
          result.teamPreview.push({
            side,
            details: parsePokemonDetails(detailsStr ?? ''),
            hasItem: itemFlag === 'item',
          });
        }
        break;
      }
      case 'turn': {
        currentTurn = parseInt(parsed.args[0], 10);
        result.turns[currentTurn] = result.turns[currentTurn] ?? [];
        // La ligne |turn|N elle-même est aussi rangée, pratique pour l'UI (afficher le numéro).
        result.turns[currentTurn].push({ ...parsed, turn: currentTurn });
        continue; // déjà poussée, ne pas re-pousser plus bas
      }
      case 'win': {
        result.winner = parsed.args[0] ?? null;
        break;
      }
      case 'tie': {
        result.isTie = true;
        break;
      }
      default:
        break;
    }

    // Toute ligne (y compris celles déjà traitées ci-dessus comme |poke| ou |player|)
    // est aussi conservée dans turns[currentTurn] pour permettre au battle engine de
    // tout rejouer dans l'ordre exact, sans dupliquer de logique de parsing.
    if (parsed.type !== 'turn') {
      result.turns[currentTurn] = result.turns[currentTurn] ?? [];
      (result.turns[currentTurn] as TurnLine[]).push({ ...parsed, turn: currentTurn });
    }
  }

  return result;
}
