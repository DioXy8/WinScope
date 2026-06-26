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
