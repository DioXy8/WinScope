/**
 * damagecalc/adapter.ts
 *
 * Construit les objets VendorPokemon / VendorField / VendorMove (le
 * contrat exact attendu par engine.js, documenté dans types.ts) à partir
 * d'un PokemonState (engine/state.ts) + son set complété, et d'un
 * BattleState pour le contexte de terrain.
 *
 * C'est la SEULE couche qui connaît à la fois le vocabulaire de notre
 * moteur d'état (engine/) et celui du moteur vendor (damagecalc/vendor/).
 * Si le moteur vendor a un quirk/bug, on le corrige ici ou dans le vendor,
 * jamais ailleurs dans le code.
 */

import type { BattleState, PokemonState, WeatherCondition, TerrainCondition } from '../engine/state';
import type { StatId } from '../replay/types';
import championsData from './vendor/data/championsData.json';
import type { VendorField, VendorMove, VendorPokemon, VendorStatBlock } from './types';
import { pickBestReferenceSet } from '../sets/referenceSets';

type ChampionsPokedexEntry = {
  t1: string;
  t2?: string;
  bs: { hp: number; at: number; df: number; sa: number; sd: number; sp: number };
  w?: number;
  ab: string;
  formes?: string[];
  isAlternateForme?: boolean;
};

const POKEDEX: Record<string, ChampionsPokedexEntry> = championsData.POKEDEX_CHAMPIONS as any;
const MOVES: Record<string, any> = championsData.MOVES_CHAMPIONS as any;
const NATURES: Record<string, [string, string]> = championsData.NATURES as any;

export class DexLookupError extends Error {
  constructor(
    message: string,
    public readonly kind: 'pokemon-not-found' | 'move-not-found',
    /** Le nom du Pokémon ou move qui n'a pas été trouvé dans la dex. */
    public readonly entityName: string,
  ) {
    super(message);
    this.name = 'DexLookupError';
  }
}

function resolveDexName(pokemon: PokemonState): string {
  if (pokemon.isMegaEvolved && pokemon.megaForme) return pokemon.megaForme;
  return pokemon.species;
}

function lookupPokedexEntry(dexName: string): ChampionsPokedexEntry {
  const entry = POKEDEX[dexName];
  if (!entry) {
    throw new DexLookupError(
      `"${dexName}" n'est pas dans la dex Pokémon Champions (roster actuel). ` +
        `Vérifie que le replay correspond bien au format Champions, ou que ce Pokémon ` +
        `n'a pas été ajouté dans une Regulation plus récente que celle supportée.`,
      'pokemon-not-found',
      dexName,
    );
  }
  return entry;
}

function lookupMove(moveName: string) {
  const entry = MOVES[moveName];
  if (!entry) {
    throw new DexLookupError(
      `Le move "${moveName}" n'est pas dans la liste des moves Pokémon Champions.`,
      'move-not-found',
      moveName,
    );
  }
  return entry;
}

/**
 * true si le move est offensif (Physical/Special, donc inflige des dégâts
 * directs), false pour un move Status (Protect, Calm Mind, Tailwind...) ou
 * si le move est inconnu de la dex Champions. Utilisé par l'UI pour ne pas
 * afficher de "% de dégâts" sur des moves qui n'en infligent pas.
 */
export function isOffensiveMove(moveName: string): boolean {
  const entry = MOVES[moveName];
  if (!entry) return false;
  return entry.category === 'Physical' || entry.category === 'Special';
}

const VENDOR_STAT_KEYS: (keyof VendorStatBlock)[] = ['at', 'df', 'sa', 'sd', 'sp'];

/**
 * Applique un stage de boost (-6..+6) à une stat, avec la même formule que
 * getModifiedStat() dans le moteur vendor (floor, pas round) — il est
 * essentiel de rester bit-à-bit identique à cette fonction, car le moteur
 * vendor utilise `stats` (boosté) à la place de `rawStats` (brut) dès qu'un
 * boost non nul est présent (cf. calcAttack/calcDefense dans engine.js).
 */
function applyBoostToStat(stat: number, stage: number): number {
  if (stage > 0) return Math.floor((stat * (2 + stage)) / 2);
  if (stage < 0) return Math.floor((stat * 2) / (2 - stage));
  return stat;
}

function computeBoostedStats(rawStats: VendorStatBlock, boosts: VendorPokemon['boosts']): VendorStatBlock {
  return {
    hp: rawStats.hp, // HP n'est jamais boosté par les stages +/-6.
    at: applyBoostToStat(rawStats.at, boosts.at),
    df: applyBoostToStat(rawStats.df, boosts.df),
    sa: applyBoostToStat(rawStats.sa, boosts.sa),
    sd: applyBoostToStat(rawStats.sd, boosts.sd),
    sp: applyBoostToStat(rawStats.sp, boosts.sp),
  };
}

/**
 * Calcule les stats brutes (avant boosts de combat), selon la VRAIE formule
 * de Pokémon Champions — PAS la formule classique des jeux principaux.
 *
 * Source : stat_data.js::CALC_HP_CHAMP / CALC_STAT_CHAMP du NCP VGC Damage
 * Calculator (référence adoptée par ce projet) :
 *   HP  = floor((base*2+31)*50/100) + 50 + 10 + statPoints
 *   Stat = floor((floor((base*2+31)*50/100) + 5 + statPoints) * nature)
 *
 * Confirmé empiriquement par les PokéPaste réels de l'utilisateur : ses
 * "EVs: 31 HP / 19 Def / 16 SpD" ne sont PAS des EVs classiques 0-252 (qui
 * seraient des multiples de 4), mais des "Stat Points" 0-32 par stat.
 * Champions simplifie radicalement les mécaniques historiques :
 *  - le niveau est TOUJOURS 50 (constante du jeu, jamais variable),
 *  - les IVs sont TOUJOURS 31 (pas de génétique individuelle dans ce jeu),
 *  - les Stat Points s'AJOUTENT DIRECTEMENT au stat de base (pas de /4
 *    comme les EVs classiques), après le calcul de base mais avant la
 *    nature (sauf HP, jamais affectée par la nature).
 *
 * BUG CORRIGÉ (02/07) : la version précédente utilisait la formule
 * classique (2*base+iv+floor(ev/4))*level/100+5 en traitant les valeurs de
 * "EVs:" comme des EVs 0-252 — ce qui sous-évaluait fortement les stats dès
 * qu'un vrai PokéPaste était fourni (ex: Sinistcha 19 Def → seulement 4
 * points d'investissement classique au lieu des 19 points Champions réels).
 */
function computeRawStats(
  baseStats: ChampionsPokedexEntry['bs'],
  statPoints: Partial<Record<StatId | 'hp', number>>,
  nature: string,
): VendorStatBlock {
  const natureEntry = NATURES[nature] ?? ['', ''];
  const [boostedStat, reducedStat] = natureEntry;

  const hpPoints = statPoints.hp ?? 0;
  const hp = Math.floor(((baseStats.hp * 2 + 31) * 50) / 100) + 50 + 10 + hpPoints;

  const result: VendorStatBlock = { hp, at: 0, df: 0, sa: 0, sd: 0, sp: 0 };

  const baseStatMap: Record<string, number> = {
    at: baseStats.at,
    df: baseStats.df,
    sa: baseStats.sa,
    sd: baseStats.sd,
    sp: baseStats.sp,
  };
  const pointsMap: Record<string, number> = {
    at: statPoints.atk ?? 0,
    df: statPoints.def ?? 0,
    sa: statPoints.spa ?? 0,
    sd: statPoints.spd ?? 0,
    sp: statPoints.spe ?? 0,
  };

  for (const key of VENDOR_STAT_KEYS) {
    const base = baseStatMap[key];
    const points = pointsMap[key];
    const natureMod = key === boostedStat ? 1.1 : key === reducedStat ? 0.9 : 1.0;
    const beforeNature = Math.floor(((base * 2 + 31) * 50) / 100) + 5 + points;
    result[key] = Math.floor(beforeNature * natureMod);
  }

  return result;
}

/** IVs toujours 31 dans Pokémon Champions (pas de génétique individuelle) — constante, jamais lue depuis un set. */
const FIXED_IVS: VendorStatBlock = { hp: 31, at: 31, df: 31, sa: 31, sd: 31, sp: 31 };
const DEFAULT_NATURE = 'Hardy';

/**
 * Construit le VendorPokemon attendu par le moteur de calcul, depuis un
 * PokemonState. Lance DexLookupError si le Pokémon n'est pas dans la dex
 * Champions.
 *
 * Les champs EVs/IVs/nature non révélés dans le replay sont pris dans
 * userProvidedSet s'ils ont été saisis manuellement, sinon des valeurs
 * neutres par défaut sont utilisées (31 IVs partout, 0 EVs, nature Hardy).
 */
const STAT_POINT_KEYS: (StatId | 'hp')[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/**
 * Fusionne plusieurs sources de Stat Points par ordre de priorité,
 * stat par stat. Utilisé UNIQUEMENT pour combiner knownSet (révélé par le
 * replay) et referenceSet (deviné) — jamais pour userProvidedSet, car un
 * PokéPaste utilisateur est toujours complet par construction : une stat
 * absente y signifie "0 point volontairement", pas "inconnue", donc elle
 * ne doit jamais être complétée par une autre source (cf. buildVendorPokemon).
 */
function mergeStatPoints(
  ...sources: Array<Partial<Record<StatId | 'hp', number>> | undefined>
): Partial<Record<StatId | 'hp', number>> {
  const result: Partial<Record<StatId | 'hp', number>> = {};
  for (const key of STAT_POINT_KEYS) {
    for (const source of sources) {
      if (source && source[key] !== undefined) {
        result[key] = source[key];
        break;
      }
    }
  }
  return result;
}

export type SetConfidence =
  | { kind: 'exact' }
  | { kind: 'estimated'; setName: string }
  | { kind: 'default' };

/**
 * Indique la fiabilité du set utilisé pour CE Pokémon dans les calculs de
 * dégâts, pour affichage transparent dans l'UI (cf. PokemonCard) :
 *  - 'exact'     : PokéPaste utilisateur fourni (userProvidedSet) — stats réelles.
 *  - 'estimated' : aucun set exact, mais un set de référence NCP a été
 *                  trouvé pour cette espèce (deviné, potentiellement faux).
 *  - 'default'   : aucun set exact ni de référence — stats neutres (0
 *                  Stat Points, nature Hardy), la pire hypothèse possible.
 *
 * Reproduit EXACTEMENT la même priorité que buildVendorPokemon — à tenir
 * synchronisé si cette priorité change un jour.
 */
export function getSetConfidence(pokemon: PokemonState): SetConfidence {
  if (pokemon.userProvidedSet) return { kind: 'exact' };
  const referenceSet = pickBestReferenceSet(pokemon.species, pokemon.revealedMoves);
  if (referenceSet) return { kind: 'estimated', setName: referenceSet.setName };
  return { kind: 'default' };
}

export type KnownMove = { name: string; source: 'revealed' | 'known' | 'guessed' };

/**
 * Liste complète des moves qu'on peut raisonnablement afficher pour ce
 * Pokémon, avec leur fiabilité :
 *  - 'revealed' : déjà joué en combat (PokemonState.revealedMoves).
 *  - 'known'    : pas encore joué, mais présent dans le PokéPaste exact de
 *                 l'utilisateur (userProvidedSet) — fiable à 100%.
 *  - 'guessed'  : pas encore joué, tiré du set de référence NCP deviné —
 *                 peut être faux.
 *
 * Dédoublonné (un move révélé n'apparaît qu'une fois même s'il est aussi
 * dans le PokéPaste ou le set deviné). Ordre : revealed, puis known, puis
 * guessed.
 */
export function getKnownMoves(pokemon: PokemonState): KnownMove[] {
  const seen = new Set<string>();
  const result: KnownMove[] = [];

  for (const name of pokemon.revealedMoves) {
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, source: 'revealed' });
  }

  for (const name of pokemon.userProvidedSet?.moves ?? []) {
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, source: 'known' });
  }

  for (const name of getEstimatedMoves(pokemon)) {
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, source: 'guessed' });
  }

  return result;
}

/**
 * Retourne les moves du set de référence deviné pour ce Pokémon — utile
 * pour proposer des calculs de dégâts sur des moves probables d'après le
 * set NCP mais pas encore révélés en combat. Retourne [] si un set exact
 * (PokéPaste) est disponible (on a alors déjà les vrais moves quelque
 * part côté UI) ou si aucun set de référence n'a été trouvé.
 */
export function getEstimatedMoves(pokemon: PokemonState): string[] {
  if (pokemon.userProvidedSet) return [];
  const referenceSet = pickBestReferenceSet(pokemon.species, pokemon.revealedMoves);
  return referenceSet?.moves ?? [];
}

export function buildVendorPokemon(pokemon: PokemonState): VendorPokemon {
  const dexName = resolveDexName(pokemon);
  const entry = lookupPokedexEntry(dexName);

  const userSet = pokemon.userProvidedSet;
  // pokemon.species reste l'espèce de BASE même Mega-évoluée (cf.
  // engine/reducer.ts), donc c'est la bonne clé pour chercher un set de
  // référence — le dex NCP catalogue aussi ses sets par espèce de base.
  const referenceSet = pickBestReferenceSet(pokemon.species, pokemon.revealedMoves);

  // Historiquement nommé "evs" dans PartialPokemonSet (cf. engine/state.ts),
  // mais représente en réalité des Stat Points 0-32 (voir computeRawStats).
  // Un PokéPaste utilisateur (userSet) est toujours complet par
  // construction : on l'utilise TEL QUEL sans compléter par le reste (une
  // stat qui y est absente vaut 0, pas "à deviner"). Sans userSet, on
  // fusionne knownSet (révélé par le replay, prioritaire) et referenceSet
  // (deviné, en dernier recours) stat par stat.
  const statPoints = userSet?.evs ?? mergeStatPoints(pokemon.knownSet.evs, referenceSet?.evs);
  const nature = userSet?.nature ?? pokemon.knownSet.nature ?? referenceSet?.nature ?? DEFAULT_NATURE;
  const ability = pokemon.revealedAbility ?? userSet?.ability ?? referenceSet?.ability ?? entry.ab;
  const item =
    pokemon.itemConsumed ? '' : pokemon.revealedItem ?? userSet?.item ?? referenceSet?.item ?? '';

  const rawStats = computeRawStats(entry.bs, statPoints, nature);

  const maxHp = pokemon.maxHp ?? rawStats.hp;
  const curHp = pokemon.hpIsPercentage
    ? Math.round((pokemon.currentHp / 100) * maxHp)
    : pokemon.currentHp;

  const statusMap: Record<string, VendorPokemon['status']> = {
    brn: 'Burned',
    par: 'Paralyzed',
    psn: 'Poisoned',
    tox: 'Badly Poisoned',
    slp: 'Asleep',
    frz: 'Frozen',
    '': '',
  };

  const boosts = {
    at: pokemon.boosts.atk,
    df: pokemon.boosts.def,
    sa: pokemon.boosts.spa,
    sd: pokemon.boosts.spd,
    sp: pokemon.boosts.spe,
  };

  // `rawStats` = stats brutes sans boost. `stats` = stats avec le stage de
  // boost déjà appliqué. Le moteur vendor lit l'un ou l'autre selon le
  // contexte (cf. calcAttack/calcDefense dans engine.js) — lui donner la
  // même valeur dans les deux annule silencieusement tout effet des boosts
  // de combat (Calm Mind, Intimidate, etc.), ce qui était le bug initial.
  const boostedStats = computeBoostedStats(rawStats, boosts);

  const spBlock: VendorStatBlock = {
    hp: statPoints.hp ?? 0,
    at: statPoints.atk ?? 0,
    df: statPoints.def ?? 0,
    sa: statPoints.spa ?? 0,
    sd: statPoints.spd ?? 0,
    sp: statPoints.spe ?? 0,
  };

  const teraType = pokemon.isTerastallized ? pokemon.teraType : null;

  return {
    name: dexName,
    type1: entry.t1,
    type2: entry.t2 ?? '',
    level: pokemon.level,

    curHP: curHp,
    maxHP: maxHp,
    HPraw: maxHp,
    HPEVs: spBlock.hp,
    HPIVs: FIXED_IVS.hp,
    HPSPs: spBlock.hp,

    rawStats,
    stats: boostedStats,
    boosts,

    // `evs`/`sps` ne sont utilisés par le moteur vendor que pour des
    // chaînes de description texte (jamais affichées ici, resultDisplayMode
    // est forcé à "raw"), mais on les remplit correctement quand même par
    // cohérence de contrat de type — ce sont bien les mêmes Stat Points.
    evs: spBlock,
    ivs: FIXED_IVS,
    sps: spBlock,
    nature,

    ability,
    item,
    status: statusMap[pokemon.status] ?? '',

    isDynamax: false,
    isTerastalize: pokemon.isTerastallized,
    tera_type: teraType,
    teraSTAB1: teraType,
    teraSTAB2: null,

    isMega: pokemon.isMegaEvolved,

    hasType(...types: string[]) {
      return types.includes(this.type1) || (this.type2 !== '' && types.includes(this.type2));
    },
  };
}

export function buildVendorMove(
  moveName: string,
  isTerastallized: boolean,
  teraType: string | null,
): VendorMove {
  const entry = lookupMove(moveName);
  return {
    name: moveName,
    bp: entry.bp ?? 0,
    type: isTerastallized && moveName === 'Tera Blast' && teraType ? teraType : entry.type,
    category: entry.category,
    isPriority: !!entry.isPriority,
    isSpread: !!entry.isSpread,
    isGen3Spread: !!entry.isGen3Spread,
    hasSecondaryEffect: !!entry.hasSecondaryEffect,
    makesContact: !!entry.makesContact,
  };
}

function anyActivePokemonHasAbility(battle: BattleState, abilityName: string): boolean {
  return Object.values(battle.pokemonByKey).some(
    (p) => p.position !== null && !p.fainted && p.revealedAbility === abilityName,
  );
}

const WEATHER_TO_VENDOR: Record<NonNullable<WeatherCondition>, string> = {
  sun: 'Sunny Day',
  rain: 'Rain Dance',
  sand: 'Sandstorm',
  snow: 'Snow',
  harshsun: 'Desolate Land',
  heavyrain: 'Primordial Sea',
};

const TERRAIN_TO_VENDOR: Record<NonNullable<TerrainCondition>, string> = {
  electric: 'Electric Terrain',
  grassy: 'Grassy Terrain',
  misty: 'Misty Terrain',
  psychic: 'Psychic Terrain',
};

/**
 * Construit le VendorField attendu par le moteur depuis le BattleState
 * global. `perspectiveSide` indique de quel côté field.getTailwind(0)/(1)
 * etc. doivent être interprétés (0 = perspectiveSide, 1 = l'autre).
 */
export function buildVendorField(battle: BattleState, perspectiveSide: 'p1' | 'p2'): VendorField {
  const otherSide = perspectiveSide === 'p1' ? 'p2' : 'p1';
  const weatherStr = battle.field.weather ? WEATHER_TO_VENDOR[battle.field.weather] : '';
  const terrainStr = battle.field.terrain ? TERRAIN_TO_VENDOR[battle.field.terrain] : '';

  const sides = {
    [perspectiveSide]: battle.sides[perspectiveSide],
    [otherSide]: battle.sides[otherSide],
  } as Record<'p1' | 'p2', BattleState['sides']['p1']>;

  return {
    weather: weatherStr,
    terrain: terrainStr,
    isGravity: battle.field.isGravity,
    isForesight: false,
    isNeutralizingGas: anyActivePokemonHasAbility(battle, 'Neutralizing Gas'),
    isAuroraVeil: battle.sides[perspectiveSide].isAuroraVeil || battle.sides[otherSide].isAuroraVeil,
    isReflect: battle.sides[perspectiveSide].isReflect,
    isLightScreen: battle.sides[perspectiveSide].isLightScreen,
    format: 'Doubles',

    isFairyAuraActive: anyActivePokemonHasAbility(battle, 'Fairy Aura'),
    isDarkAuraActive: anyActivePokemonHasAbility(battle, 'Dark Aura'),
    isAuraBreakActive: anyActivePokemonHasAbility(battle, 'Aura Break'),
    isTabletsOfRuinActive: anyActivePokemonHasAbility(battle, 'Tablets of Ruin'),
    isVesselOfRuinActive: anyActivePokemonHasAbility(battle, 'Vessel of Ruin'),
    isSwordOfRuinActive: anyActivePokemonHasAbility(battle, 'Sword of Ruin'),
    isBeadsOfRuinActive: anyActivePokemonHasAbility(battle, 'Beads of Ruin'),

    getWeather() {
      return weatherStr;
    },
    getTerrain() {
      return terrainStr;
    },
    getTailwind(sideIndex: 0 | 1) {
      const side = sideIndex === 0 ? perspectiveSide : otherSide;
      return sides[side].isTailwind;
    },
    getSwamp() {
      return false;
    },
    getSide(sideIndex: 0 | 1) {
      const side = sideIndex === 0 ? perspectiveSide : otherSide;
      return sides[side] as unknown as Record<string, unknown>;
    },
    getNeutralGas() {
      return anyActivePokemonHasAbility(battle, 'Neutralizing Gas');
    },
    clearWeather() {
      // no-op: la météo réelle est gérée par notre BattleState, pas par le moteur vendor.
    },
  };
}
