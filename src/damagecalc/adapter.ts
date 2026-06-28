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
    public readonly name: string,
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

function computeRawStats(
  baseStats: ChampionsPokedexEntry['bs'],
  level: number,
  evs: Partial<Record<StatId | 'hp', number>>,
  ivs: Partial<Record<StatId | 'hp', number>>,
  nature: string,
): VendorStatBlock {
  const natureEntry = NATURES[nature] ?? ['', ''];
  const [boostedStat, reducedStat] = natureEntry;

  const hpEv = evs.hp ?? 0;
  const hpIv = ivs.hp ?? 31;
  const hp = Math.floor(((2 * baseStats.hp + hpIv + Math.floor(hpEv / 4)) * level) / 100) + level + 10;

  const result: VendorStatBlock = { hp, at: 0, df: 0, sa: 0, sd: 0, sp: 0 };

  const baseStatMap: Record<string, number> = {
    at: baseStats.at,
    df: baseStats.df,
    sa: baseStats.sa,
    sd: baseStats.sd,
    sp: baseStats.sp,
  };
  const evMap: Record<string, number> = {
    at: evs.atk ?? 0,
    df: evs.def ?? 0,
    sa: evs.spa ?? 0,
    sd: evs.spd ?? 0,
    sp: evs.spe ?? 0,
  };
  const ivMap: Record<string, number> = {
    at: ivs.atk ?? 31,
    df: ivs.def ?? 31,
    sa: ivs.spa ?? 31,
    sd: ivs.spd ?? 31,
    sp: ivs.spe ?? 31,
  };

  for (const key of VENDOR_STAT_KEYS) {
    const base = baseStatMap[key];
    const ev = evMap[key];
    const iv = ivMap[key];
    let stat = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
    const natureMod = key === boostedStat ? 1.1 : key === reducedStat ? 0.9 : 1.0;
    stat = Math.floor(stat * natureMod);
    result[key] = stat;
  }

  return result;
}

const DEFAULT_EVS: Partial<Record<StatId | 'hp', number>> = {};
const DEFAULT_IVS: Partial<Record<StatId | 'hp', number>> = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};
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
export function buildVendorPokemon(pokemon: PokemonState): VendorPokemon {
  const dexName = resolveDexName(pokemon);
  const entry = lookupPokedexEntry(dexName);

  const userSet = pokemon.userProvidedSet;
  const evs = userSet?.evs ?? pokemon.knownSet.evs ?? DEFAULT_EVS;
  const ivs = userSet?.ivs ?? pokemon.knownSet.ivs ?? DEFAULT_IVS;
  const nature = userSet?.nature ?? pokemon.knownSet.nature ?? DEFAULT_NATURE;
  const ability = pokemon.revealedAbility ?? userSet?.ability ?? entry.ab;
  const item = pokemon.itemConsumed ? '' : pokemon.revealedItem ?? userSet?.item ?? '';

  const rawStats = computeRawStats(entry.bs, pokemon.level, evs, ivs, nature);

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

  const evBlock: VendorStatBlock = {
    hp: evs.hp ?? 0,
    at: evs.atk ?? 0,
    df: evs.def ?? 0,
    sa: evs.spa ?? 0,
    sd: evs.spd ?? 0,
    sp: evs.spe ?? 0,
  };
  const ivBlock: VendorStatBlock = {
    hp: ivs.hp ?? 31,
    at: ivs.atk ?? 31,
    df: ivs.def ?? 31,
    sa: ivs.spa ?? 31,
    sd: ivs.spd ?? 31,
    sp: ivs.spe ?? 31,
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
    HPEVs: evBlock.hp,
    HPIVs: ivBlock.hp,
    HPSPs: Math.round(evBlock.hp / 4),

    rawStats,
    stats: boostedStats,
    boosts,

    evs: evBlock,
    ivs: ivBlock,
    sps: {
      hp: Math.round(evBlock.hp / 4),
      at: Math.round(evBlock.at / 4),
      df: Math.round(evBlock.df / 4),
      sa: Math.round(evBlock.sa / 4),
      sd: Math.round(evBlock.sd / 4),
      sp: Math.round(evBlock.sp / 4),
    },
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
