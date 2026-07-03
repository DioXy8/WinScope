/**
 * search/actionGenerator.ts
 *
 * Génère la liste des actions PLAUSIBLES qu'un Pokémon actif donné peut
 * jouer à un tour donné : un MoveAction par (move révélé × cible légale),
 * et un SwitchAction par Pokémon valide du banc.
 *
 * "Plausible" = on se limite aux moves déjà révélés dans le replay pour ce
 * Pokémon (cf. PokemonState.revealedMoves), pas à tout son movepool
 * théorique — cohérent avec la règle du projet (on travaille avec ce qui
 * est connu/saisi, pas avec des suppositions sur des moves jamais vus).
 *
 * Ce module ne simule rien : il liste juste "ce qu'on pourrait jouer".
 * outcomeSimulator.ts s'occupe d'évaluer le résultat de chaque action.
 */

import type { BattleState, PokemonState } from '../engine/state';
import type { PokemonPosition } from '../replay/types';
import moveTargetsData from '../damagecalc/vendor/data/moveTargets.json';
import type { MoveAction, MoveTargetInfo, MoveTargetType, SwitchAction, PlayerAction } from './actionTypes';

const MOVE_TARGETS: Record<string, MoveTargetInfo> = moveTargetsData as any;

export function getMoveTargetInfo(moveName: string): MoveTargetInfo | null {
  return MOVE_TARGETS[moveName] ?? null;
}

/**
 * Convertit l'accuracy brute d'un move en probabilité de toucher (0-1).
 * Retourne 1 si le move ne peut jamais manquer ou n'a pas de notion de
 * précision (Status move ciblant soi/son camp).
 */
export function getMoveAccuracyFraction(moveName: string): number {
  const info = getMoveTargetInfo(moveName);
  if (!info || info.accuracy === null) return 1;
  const parsed = parseInt(info.accuracy, 10);
  if (Number.isNaN(parsed)) return 1;
  return parsed / 100;
}

function sideOfPosition(position: PokemonPosition): 'p1' | 'p2' {
  return position.startsWith('p1') ? 'p1' : 'p2';
}

function allActivePositions(battle: BattleState): PokemonPosition[] {
  return Object.keys(battle.activeByPosition) as PokemonPosition[];
}

/**
 * Résout les positions ciblées par un move pour les types de cible FIXES
 * (spread/self/field) — pas de choix pour le joueur. Retourne null si le
 * type de cible demande un choix unique (géré par resolveSingleTargetOptions).
 */
function resolveFixedTargets(
  battle: BattleState,
  userPosition: PokemonPosition,
  targetType: MoveTargetType,
): PokemonPosition[] | null {
  const userSide = sideOfPosition(userPosition);
  const opposingSide = userSide === 'p1' ? 'p2' : 'p1';
  const active = allActivePositions(battle);

  switch (targetType) {
    case 'self':
    case 'allySide':
    case 'allyTeam':
    case 'foeSide':
    case 'all':
      return [];
    case 'allAdjacent':
      return active.filter((p) => p !== userPosition);
    case 'allAdjacentFoes':
      return active.filter((p) => sideOfPosition(p) === opposingSide);
    case 'allies':
      return active.filter((p) => sideOfPosition(p) === userSide && p !== userPosition);
    default:
      return null;
  }
}

/** Pour les types de cible à choix unique, retourne chaque cible valide séparément. */
function resolveSingleTargetOptions(
  battle: BattleState,
  userPosition: PokemonPosition,
  targetType: MoveTargetType,
): PokemonPosition[][] {
  const userSide = sideOfPosition(userPosition);
  const opposingSide = userSide === 'p1' ? 'p2' : 'p1';
  const active = allActivePositions(battle);

  switch (targetType) {
    case 'normal':
    case 'any':
    case 'randomNormal':
      return active.filter((p) => p !== userPosition).map((p) => [p]);
    case 'adjacentFoe':
      return active.filter((p) => sideOfPosition(p) === opposingSide).map((p) => [p]);
    case 'adjacentAlly':
      return active.filter((p) => sideOfPosition(p) === userSide && p !== userPosition).map((p) => [p]);
    case 'adjacentAllyOrSelf':
      return active.filter((p) => sideOfPosition(p) === userSide).map((p) => [p]);
    case 'scripted':
      return [];
    default:
      return [];
  }
}

/** Génère toutes les combinaisons de cibles plausibles pour un move donné. */
export function resolveMoveTargets(
  battle: BattleState,
  userPosition: PokemonPosition,
  moveName: string,
): PokemonPosition[][] {
  const info = getMoveTargetInfo(moveName);
  if (!info) return [];

  const fixed = resolveFixedTargets(battle, userPosition, info.target);
  if (fixed !== null) return [fixed];

  return resolveSingleTargetOptions(battle, userPosition, info.target);
}

function isLockedByChoiceItem(pokemon: PokemonState): string | null {
  const item = pokemon.revealedItem ?? '';
  const isChoiceItem = item === 'Choice Band' || item === 'Choice Specs' || item === 'Choice Scarf';
  if (!isChoiceItem) return null;
  const lastMove = pokemon.revealedMoves[pokemon.revealedMoves.length - 1];
  return lastMove ?? null;
}

const FIELD_OR_SELF_TARGETS = new Set(['self', 'allySide', 'allyTeam', 'all', 'foeSide']);

/** Approximation : une move "status" cible typiquement soi/son camp plutôt qu'un adversaire. */
function isLikelyStatusMove(moveName: string): boolean {
  const info = getMoveTargetInfo(moveName);
  if (!info) return false;
  return info.target === 'self' || info.target === 'allySide' || info.target === 'allyTeam';
}

/**
 * Génère les MoveAction plausibles pour un Pokémon actif donné : un par
 * (move révélé non bloqué × cible légale). Filtre les moves désactivés par
 * Taunt (status uniquement), Disable (move spécifique), ou le lock d'un
 * Choice item.
 */
export function generateMoveActions(battle: BattleState, position: PokemonPosition): MoveAction[] {
  const key = battle.activeByPosition[position];
  if (!key) return [];
  const pokemon = battle.pokemonByKey[key];
  if (!pokemon || pokemon.fainted) return [];

  const choiceLockedMove = isLockedByChoiceItem(pokemon);
  const isTaunted = pokemon.volatiles.has('Taunt');
  const disabledMove = [...pokemon.volatiles].find((v) => v.startsWith('Disable:'))?.split(':')[1];

  const actions: MoveAction[] = [];

  for (const moveName of pokemon.revealedMoves) {
    if (choiceLockedMove && moveName !== choiceLockedMove) continue;
    if (disabledMove && moveName === disabledMove) continue;
    if (isTaunted && isLikelyStatusMove(moveName)) continue;

    const info = getMoveTargetInfo(moveName);
    const targetOptions = resolveMoveTargets(battle, position, moveName);
    const isFieldOrSelf = info ? FIELD_OR_SELF_TARGETS.has(info.target) : false;

    if (targetOptions.length === 0 && !isFieldOrSelf) {
      continue;
    }

    const iterable = targetOptions.length > 0 ? targetOptions : [[]];
    for (const targets of iterable) {
      actions.push({
        kind: 'move',
        userKey: key,
        userPosition: position,
        moveName,
        targetPositions: targets,
        willMegaEvolve: false,
        willTerastallize: false,
      });
    }
  }

  return actions;
}

/**
 * Génère les SwitchAction plausibles : un par Pokémon vivant du banc RÉEL.
 * Exige `hasBeenSentOut` (déjà entré sur le terrain au moins une fois dans
 * ce combat) — sans quoi les Pokémon seulement annoncés en Team Preview
 * mais jamais amenés (cf. Reg M-B "bring 6, pick 4") seraient proposés
 * comme switches valides indéfiniment, puisqu'ils ne fainteront jamais.
 */
export function generateSwitchActions(battle: BattleState, position: PokemonPosition): SwitchAction[] {
  const activeKey = battle.activeByPosition[position];
  if (!activeKey) return [];
  const activePokemon = battle.pokemonByKey[activeKey];
  if (!activePokemon) return [];

  if (activePokemon.volatiles.has('Trapped')) return [];

  const side = activePokemon.side;
  const activeKeys = new Set(Object.values(battle.activeByPosition));

  return Object.entries(battle.pokemonByKey)
    .filter(([key, p]) => p.side === side && p.hasBeenSentOut && !p.fainted && !activeKeys.has(key))
    .map(([incomingKey]) => ({
      kind: 'switch' as const,
      userKey: activeKey,
      userPosition: position,
      incomingKey,
    }));
}

/** Toutes les actions plausibles (moves + switches) pour un Pokémon actif donné. */
export function generateActionsForPosition(battle: BattleState, position: PokemonPosition): PlayerAction[] {
  return [...generateMoveActions(battle, position), ...generateSwitchActions(battle, position)];
}
