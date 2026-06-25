/**
 * engine/field.ts
 *
 * Fonctions pures de transformation de FieldState (météo, terrain, Trick
 * Room, Gravity) et SideState (hazards, screens, Tailwind). Même principe
 * que pokemon.ts : pas de mutation, pas de lecture du protocole ici.
 */

import type { BattleState, FieldState, SideState, TerrainCondition, WeatherCondition } from './state';

// --- Field (météo / terrain / global) ---------------------------------

export function setWeather(
  field: FieldState,
  weather: WeatherCondition,
  turnsLeft = 5,
): FieldState {
  return { ...field, weather, weatherTurnsLeft: weather ? turnsLeft : 0 };
}

export function clearWeather(field: FieldState): FieldState {
  return { ...field, weather: null, weatherTurnsLeft: 0 };
}

export function setTerrain(
  field: FieldState,
  terrain: TerrainCondition,
  turnsLeft = 5,
): FieldState {
  return { ...field, terrain, terrainTurnsLeft: terrain ? turnsLeft : 0 };
}

export function clearTerrain(field: FieldState): FieldState {
  return { ...field, terrain: null, terrainTurnsLeft: 0 };
}

export function setTrickRoom(field: FieldState, active: boolean, turnsLeft = 5): FieldState {
  return { ...field, isTrickRoom: active, trickRoomTurnsLeft: active ? turnsLeft : 0 };
}

export function setGravity(field: FieldState, active: boolean, turnsLeft = 5): FieldState {
  return { ...field, isGravity: active, gravityTurnsLeft: active ? turnsLeft : 0 };
}

// --- Side (hazards / screens / tailwind) -------------------------------

export function addSpikes(side: SideState): SideState {
  return { ...side, spikes: Math.min(3, side.spikes + 1) };
}

export function setToxicSpikes(side: SideState, active: boolean): SideState {
  return { ...side, toxicSpikes: active };
}

export function setStealthRock(side: SideState, active: boolean): SideState {
  return { ...side, stealthRock: active };
}

export function setStickyWeb(side: SideState, active: boolean): SideState {
  return { ...side, stickyWeb: active };
}

export function clearHazards(side: SideState): SideState {
  return {
    ...side,
    spikes: 0,
    toxicSpikes: false,
    stealthRock: false,
    stickyWeb: false,
  };
}

export function setReflect(side: SideState, active: boolean, turnsLeft = 5): SideState {
  return { ...side, isReflect: active, reflectTurnsLeft: active ? turnsLeft : 0 };
}

export function setLightScreen(side: SideState, active: boolean, turnsLeft = 5): SideState {
  return { ...side, isLightScreen: active, lightScreenTurnsLeft: active ? turnsLeft : 0 };
}

export function setAuroraVeil(side: SideState, active: boolean, turnsLeft = 5): SideState {
  return { ...side, isAuroraVeil: active, auroraVeilTurnsLeft: active ? turnsLeft : 0 };
}

export function setTailwind(side: SideState, active: boolean, turnsLeft = 4): SideState {
  return { ...side, isTailwind: active, tailwindTurnsLeft: active ? turnsLeft : 0 };
}

export function markTerastallizeUsed(side: SideState): SideState {
  return { ...side, hasUsedTerastallize: true };
}

// --- Helpers de haut niveau opérant directement sur BattleState --------

/** Met à jour le FieldState global d'un BattleState (retourne un nouvel état). */
export function updateField(
  battle: BattleState,
  updater: (field: FieldState) => FieldState,
): BattleState {
  return { ...battle, field: updater(battle.field) };
}

/** Met à jour le SideState d'un camp précis ('p1' ou 'p2'). */
export function updateSide(
  battle: BattleState,
  side: 'p1' | 'p2',
  updater: (sideState: SideState) => SideState,
): BattleState {
  return {
    ...battle,
    sides: { ...battle.sides, [side]: updater(battle.sides[side]) },
  };
}
