/**
 * engine/state.ts
 *
 * Définit la structure de données centrale du moteur : BattleState.
 * C'est l'état complet et immuable d'un combat à un instant T (un tour donné).
 *
 * Ce fichier ne contient AUCUNE logique de transition (pas de "appliquer ce
 * move" ou "appliquer ce switch") : c'est uniquement la FORME des données.
 * La logique qui transforme un BattleState en un autre (en lisant les lignes
 * du replay) vit dans engine/reducer.ts.
 */

import type { PokemonPosition, StatId, StatusCondition } from '../replay/types';

/**
 * Ce qu'on sait d'un set Pokémon (EVs/IVs/nature/ability/item) à un instant
 * donné. Conformément à la règle du projet : les moves et l'item sont
 * toujours connus une fois révélés dans le replay ; tout le reste (EVs, IVs,
 * nature, ability tant qu'elle n'a pas été déclenchée) peut rester `null`
 * jusqu'à ce que l'utilisateur le renseigne manuellement (voir sets/).
 */
export interface PartialPokemonSet {
  ability: string | null;
  item: string | null;
  nature: string | null;
  evs: Partial<Record<StatId | 'hp', number>>;
  ivs: Partial<Record<StatId | 'hp', number>>;
  teraType: string | null;
}

/** Un set Pokémon vide, utilisé comme valeur par défaut avant toute déduction. */
export function createEmptyPartialSet(): PartialPokemonSet {
  return {
    ability: null,
    item: null,
    nature: null,
    evs: {},
    ivs: {},
    teraType: null,
  };
}

/** État complet d'un Pokémon (actif ou non) à un instant T du combat. */
export interface PokemonState {
  /** Nom d'espèce tel que révélé (ex: "Incineroar"). */
  species: string;
  /** Surnom affiché dans le replay, si différent de l'espèce. */
  nickname: string;
  /** Position actuelle sur le terrain ("p1a", "p2b"...), ou null si sur le banc / KO et retiré. */
  position: PokemonPosition | null;
  side: 'p1' | 'p2';
  level: number;

  currentHp: number;
  /** Null si on ne connaît jamais le maxHp réel (cas de l'adversaire sans HP Percentage Mod désactivé). */
  maxHp: number | null;
  /** true si currentHp/maxHp sont exprimés en pourcentage plutôt qu'en valeurs absolues. */
  hpIsPercentage: boolean;

  status: StatusCondition;
  /** Compteur interne pour les statuts à durée (ex: sommeil, toxic stacks). */
  statusTurns: number;

  /** Stat boosts actuels, de -6 à +6, pour chaque stat modifiable. */
  boosts: Record<StatId, number>;

  /** Volatiles actifs (confusion, taunt, substitute, encore, etc.) par nom. */
  volatiles: Set<string>;

  /** Attaques vues utilisées par ce Pokémon au cours du replay. */
  revealedMoves: string[];
  /** PP restant connu pour chaque move révélé (estimé si jamais affiché explicitement). */
  revealedPp: Record<string, number>;

  revealedItem: string | null;
  /** true si l'objet a été consommé/retiré (ex: Sitrus Berry mangée, Knock Off). */
  itemConsumed: boolean;

  revealedAbility: string | null;

  isTerastallized: boolean;
  teraType: string | null;

  /** true si ce Pokémon a Mega-évolué (mécanique réintroduite dans Champions). */
  isMegaEvolved: boolean;
  /** Nom de la Mega Stone utilisée, ex: "Charizardite Y". Null si pas de Mega Evolution. */
  megaStone: string | null;
  /**
   * Forme Mega résultante telle qu'elle doit être recherchée dans la dex,
   * ex: "Mega Charizard Y". Calculée depuis le couple (species, megaStone)
   * au moment où |-mega| est lu, car le protocole ne donne que la stone.
   */
  megaForme: string | null;

  fainted: boolean;

  /** Ce qu'on sait/déduit automatiquement depuis le log (item, moves, ability si déclenchée). */
  knownSet: PartialPokemonSet;
  /** Complété manuellement par l'utilisateur pour ce qui n'est jamais révélé (EVs, nature...). */
  userProvidedSet: PartialPokemonSet | null;
}

/** Crée un PokemonState initial "vierge" pour un Pokémon vu en Team Preview. */
export function createInitialPokemonState(params: {
  species: string;
  side: 'p1' | 'p2';
  level: number;
}): PokemonState {
  return {
    species: params.species,
    nickname: params.species,
    position: null,
    side: params.side,
    level: params.level,
    currentHp: 100,
    maxHp: null,
    hpIsPercentage: true,
    status: '',
    statusTurns: 0,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    volatiles: new Set(),
    revealedMoves: [],
    revealedPp: {},
    revealedItem: null,
    itemConsumed: false,
    revealedAbility: null,
    isTerastallized: false,
    teraType: null,
    isMegaEvolved: false,
    megaStone: null,
    megaForme: null,
    fainted: false,
    knownSet: createEmptyPartialSet(),
    userProvidedSet: null,
  };
}

/** Hazards et conditions actives du côté d'un joueur (pas liées à un Pokémon précis). */
export interface SideState {
  /** Nombre de couches de Spikes posées (0-3). */
  spikes: number;
  /** Toxic Spikes posées (0-2). */
  toxicSpikes: boolean;
  /** Stealth Rock posé. */
  stealthRock: boolean;
  /** Sticky Web posé. */
  stickyWeb: boolean;

  isReflect: boolean;
  reflectTurnsLeft: number;
  isLightScreen: boolean;
  lightScreenTurnsLeft: number;
  isAuroraVeil: boolean;
  auroraVeilTurnsLeft: number;

  isTailwind: boolean;
  tailwindTurnsLeft: number;

  /** Pokémon de ce côté ayant déjà fait Tera ce match (règle: un seul par équipe). */
  hasUsedTerastallize: boolean;
}

export function createInitialSideState(): SideState {
  return {
    spikes: 0,
    toxicSpikes: false,
    stealthRock: false,
    stickyWeb: false,
    isReflect: false,
    reflectTurnsLeft: 0,
    isLightScreen: false,
    lightScreenTurnsLeft: 0,
    isAuroraVeil: false,
    auroraVeilTurnsLeft: 0,
    isTailwind: false,
    tailwindTurnsLeft: 0,
    hasUsedTerastallize: false,
  };
}

export type WeatherCondition =
  | null
  | 'sun'
  | 'rain'
  | 'sand'
  | 'snow'
  | 'harshsun'
  | 'heavyrain';

export type TerrainCondition = null | 'electric' | 'grassy' | 'misty' | 'psychic';

/** Conditions de terrain globales, communes aux deux joueurs. */
export interface FieldState {
  weather: WeatherCondition;
  weatherTurnsLeft: number;
  terrain: TerrainCondition;
  terrainTurnsLeft: number;
  isTrickRoom: boolean;
  trickRoomTurnsLeft: number;
  isGravity: boolean;
  gravityTurnsLeft: number;
}

export function createInitialFieldState(): FieldState {
  return {
    weather: null,
    weatherTurnsLeft: 0,
    terrain: null,
    terrainTurnsLeft: 0,
    isTrickRoom: false,
    trickRoomTurnsLeft: 0,
    isGravity: false,
    gravityTurnsLeft: 0,
  };
}

/**
 * État complet et immuable du combat à un instant T (typiquement : juste
 * avant ou juste après un tour donné). Chaque ligne du replay appliquée par
 * le reducer produit un NOUVEL objet BattleState plutôt que de muter
 * l'existant, ce qui permet de conserver tout l'historique pour l'UI
 * (scrubber façon chess.com).
 */
export interface BattleState {
  turnNumber: number;

  field: FieldState;
  sides: {
    p1: SideState;
    p2: SideState;
  };

  /**
   * Toutes les Pokémon connues, actives ou non, indexées par une clé stable
   * (pas la position, qui change si le Pokémon switch) : on utilise
   * `${side}:${species}` tant que Species Clause est en vigueur (règle VGC
   * standard, un seul exemplaire de chaque espèce par équipe).
   */
  pokemonByKey: Record<string, PokemonState>;

  /** Position -> clé du Pokémon actif à cette position, pour résolution rapide. */
  activeByPosition: Partial<Record<PokemonPosition, string>>;
}

export function createInitialBattleState(): BattleState {
  return {
    turnNumber: 0,
    field: createInitialFieldState(),
    sides: {
      p1: createInitialSideState(),
      p2: createInitialSideState(),
    },
    pokemonByKey: {},
    activeByPosition: {},
  };
}
