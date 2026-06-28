/**
 * search/actionTypes.ts
 *
 * Types représentant une "action" qu'un joueur peut choisir pour UN de ses
 * Pokémon actifs à un tour donné : utiliser un move (sur une cible précise,
 * éventuellement en Mega/Tera), ou switcher.
 *
 * En VGC doubles, un "tour complet" pour un joueur = une action par
 * Pokémon actif (2 actions). Ce fichier décrit l'unité de base ; la
 * combinatoire des paires/quadruplets est gérée par actionGenerator.ts et
 * turnAnalyzer.ts.
 */

import type { PokemonPosition } from '../replay/types';

export type MoveTargetType =
  | 'normal'
  | 'any'
  | 'adjacentAlly'
  | 'adjacentAllyOrSelf'
  | 'adjacentFoe'
  | 'all'
  | 'allAdjacent'
  | 'allAdjacentFoes'
  | 'allies'
  | 'allySide'
  | 'allyTeam'
  | 'foeSide'
  | 'randomNormal'
  | 'scripted'
  | 'self';

export interface MoveTargetInfo {
  target: MoveTargetType;
  pp: number;
  priority: number;
  /**
   * "100" (string) pour un % de précision normal, ou null si le move ne
   * peut jamais manquer (Aerial Ace) OU n'a pas de notion d'accuracy
   * (Status move comme Protect — à distinguer via le `target` du move:
   * une cible 'self'/'allySide'/etc. + accuracy null = jamais de jet de
   * précision à faire).
   */
  accuracy: string | null;
}

/** Une action "move" : qui l'utilise, lequel, sur qui (si applicable), et options. */
export interface MoveAction {
  kind: 'move';
  userKey: string;
  userPosition: PokemonPosition;
  moveName: string;
  targetPositions: PokemonPosition[];
  willMegaEvolve: boolean;
  willTerastallize: boolean;
}

/** Une action "switch" : remplacer le Pokémon actif par un autre du banc. */
export interface SwitchAction {
  kind: 'switch';
  userKey: string;
  userPosition: PokemonPosition;
  incomingKey: string;
}

export type PlayerAction = MoveAction | SwitchAction;

/** Le choix complet d'un joueur pour un tour : une action par Pokémon actif. */
export interface PlayerTurnChoice {
  side: 'p1' | 'p2';
  actions: PlayerAction[];
}

/** Représentation lisible d'une action, pour l'affichage UI. */
export function describeAction(action: PlayerAction, userLabel: string): string {
  if (action.kind === 'switch') {
    return `${userLabel} switch`;
  }
  if (action.targetPositions.length === 0) {
    return `${userLabel} utilise ${action.moveName}`;
  }
  return `${userLabel} utilise ${action.moveName} → ${action.targetPositions.join(', ')}`;
}
