/**
 * damagecalc/types.ts
 *
 * Types décrivant EXACTEMENT les objets que le moteur vendor (engine.js)
 * attend en entrée. Ces formes ont été déterminées en lisant le code
 * source de damage_MASTER.js / damage_SV.js / ko_chance.js (pas deviné),
 * et validées par exécution réelle du moteur sur des cas concrets.
 *
 * adapter.ts est responsable de construire ces objets à partir d'un
 * PokemonState (engine/state.ts) + son set complété (knownSet/userProvidedSet).
 */

export interface VendorStatBlock {
  hp: number;
  at: number;
  df: number;
  sa: number;
  sd: number;
  sp: number;
}

/** Objet "Pokemon" tel qu'attendu par GET_DAMAGE_SV. */
export interface VendorPokemon {
  name: string;
  type1: string;
  type2: string | '';
  level: number;

  curHP: number;
  maxHP: number;
  HPraw: number;
  HPEVs: number;
  HPIVs: number;
  HPSPs: number;

  rawStats: VendorStatBlock;
  stats: VendorStatBlock;
  boosts: { at: number; df: number; sa: number; sd: number; sp: number };

  evs: VendorStatBlock;
  ivs: VendorStatBlock;
  sps: VendorStatBlock;
  nature: string;

  ability: string;
  item: string;
  status: '' | 'Burned' | 'Paralyzed' | 'Poisoned' | 'Badly Poisoned' | 'Asleep' | 'Frozen';

  isDynamax: boolean;
  isTerastalize: boolean;
  tera_type: string | null;
  teraSTAB1: string | null;
  teraSTAB2: string | null;

  isMega?: boolean;
  highestStat?: string;
  abilityOn?: boolean;
  isChild?: boolean;

  moves?: unknown[];
  usedOppMoveIndex?: number;

  hasType(...types: string[]): boolean;
}

/** Objet "Move" tel qu'attendu par GET_DAMAGE_SV. */
export interface VendorMove {
  name: string;
  bp: number;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  isPriority?: boolean;
  isSpread?: boolean;
  isGen3Spread?: boolean;
  hasSecondaryEffect?: boolean;
  makesContact?: boolean;
  isCrit?: boolean;
  isZ?: boolean;
  ignoresBurn?: boolean;
  ignoresScreens?: boolean;
}

/** Objet "Field" tel qu'attendu par GET_DAMAGE_SV. */
export interface VendorField {
  weather: string;
  terrain: string;
  isGravity: boolean;
  isForesight: boolean;
  isNeutralizingGas: boolean;
  isAuroraVeil?: boolean;
  isReflect?: boolean;
  isLightScreen?: boolean;
  format?: string;

  isFairyAuraActive: boolean;
  isDarkAuraActive: boolean;
  isAuraBreakActive: boolean;
  isTabletsOfRuinActive: boolean;
  isVesselOfRuinActive: boolean;
  isSwordOfRuinActive: boolean;
  isBeadsOfRuinActive: boolean;

  getWeather(): string;
  getTerrain(): string;
  getTailwind(sideIndex: 0 | 1): boolean;
  getSwamp(sideIndex: 0 | 1): boolean;
  getSide(sideIndex: 0 | 1): Record<string, unknown>;
  getNeutralGas(): boolean;
  clearWeather(): void;
}

export interface DamageResult {
  rolls: number[];
  minPercent: number;
  maxPercent: number;
  description: string;
}
