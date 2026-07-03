/**
 * engine/reducer.ts
 *
 * Le cœur du moteur : prend un BattleState et une TurnLine (une ligne du
 * protocole déjà parsée), et retourne le NOUVEL état qui en résulte.
 *
 * applyLine() est une grosse fonction de dispatch (switch sur line.type)
 * qui délègue à des petites fonctions de transition, elles-mêmes appuyées
 * sur les helpers purs de pokemon.ts et field.ts.
 *
 * Limite assumée (cf. SIM-PROTOCOL.md) : pour un Pokémon adverse, le HP lu
 * dans le replay est presque toujours un pourcentage ("/100"), jamais une
 * valeur absolue, sauf si ce camp est le point de vue d'origine du log (rare
 * pour un replay téléchargé, qui est généralement vu depuis la perspective
 * spectateur). On traite donc les DEUX camps de façon symétrique : le vrai
 * maxHP n'est connu que si l'utilisateur le fournit (cf. sets/), ou déduit
 * plus tard d'un calcul de stats.
 */

import {
  parseHpStatus,
  parsePokemonDetails,
  parsePokemonIdent,
} from '../replay/logParser';
import type { ParsedReplayLog, PokemonPosition, StatId, TurnLine } from '../replay/types';
import {
  addSpikes,
  clearHazards,
  markTerastallizeUsed,
  setAuroraVeil,
  setGravity,
  setLightScreen,
  setReflect,
  setStealthRock,
  setStickyWeb,
  setTailwind,
  setTerrain,
  setTrickRoom,
  setWeather,
  updateField,
  updateSide,
} from './field';
import { resolveMegaForme } from './megaStones';
import {
  addVolatile,
  applyBoost,
  applyStatus,
  clearBoosts,
  clearStatus,
  consumeItem,
  markFainted,
  removeVolatile,
  resetOnSwitchOut,
  revealAbility,
  revealItem,
  revealMove,
  setBoost,
  setHp,
  setMegaEvolved,
  setPosition,
  setTerastallized,
} from './pokemon';
import { createInitialBattleState, createInitialPokemonState } from './state';
import type { BattleState, PokemonState } from './state';

const STAT_ABBR: Record<string, StatId> = {
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};

/** Clé stable d'un Pokémon, indépendante de sa position actuelle sur le terrain. */
function pokemonKey(side: 'p1' | 'p2', species: string): string {
  return `${side}:${species}`;
}

/**
 * Retrouve la clé d'un Pokémon depuis son ident protocole (ex: "p1a: Sparky").
 * Si le Pokémon est déjà actif à cette position, on utilise activeByPosition
 * (gère les surnoms). Sinon on retombe sur le nom donné (cas: pas encore vu).
 */
function resolvePokemonKey(
  battle: BattleState,
  identRaw: string,
): { key: string; side: 'p1' | 'p2' } | null {
  const ident = parsePokemonIdent(identRaw);
  const side = ident.side as 'p1' | 'p2';
  if (side !== 'p1' && side !== 'p2') return null;

  if (ident.position) {
    const existingKey = battle.activeByPosition[ident.position];
    if (existingKey && battle.pokemonByKey[existingKey]) {
      return { key: existingKey, side };
    }
  }

  // Pas encore actif à cette position connue : on cherche par nom/espèce
  // parmi les Pokémon déjà connus de ce camp (gère les surnoms personnalisés).
  const bySpeciesOrNickname = Object.values(battle.pokemonByKey).find(
    (p) => p.side === side && (p.species === ident.name || p.nickname === ident.name),
  );
  if (bySpeciesOrNickname) {
    return { key: pokemonKey(side, bySpeciesOrNickname.species), side };
  }

  return null;
}

/** Retrouve la position active (si existante) d'un Pokémon donné par sa clé. */
function findActivePosition(
  battle: BattleState,
  key: string,
): PokemonPosition | null {
  for (const [pos, k] of Object.entries(battle.activeByPosition)) {
    if (k === key) return pos as PokemonPosition;
  }
  return null;
}

/** Retire un Pokémon de activeByPosition (switch out, faint) sans toucher au reste de l'état. */
function clearActivePosition(battle: BattleState, key: string): BattleState {
  const position = findActivePosition(battle, key);
  if (!position) return battle;
  const { [position]: _removed, ...rest } = battle.activeByPosition;
  return { ...battle, activeByPosition: rest };
}
function updatePokemon(
  battle: BattleState,
  key: string,
  updater: (p: PokemonState) => PokemonState,
): BattleState {
  const existing = battle.pokemonByKey[key];
  if (!existing) return battle;
  return {
    ...battle,
    pokemonByKey: { ...battle.pokemonByKey, [key]: updater(existing) },
  };
}

/** Extrait le nom d'un item depuis un tag [from], ex: "item: Leftovers" -> "Leftovers". Retourne null si le tag ne concerne pas un item (ex: "ability: ..."). */
function extractItemFromTag(fromTag: string | true | undefined): string | null {
  if (typeof fromTag !== 'string') return null;
  const match = fromTag.match(/^item:\s*(.+)$/);
  return match ? match[1].trim() : null;
}

/** Extrait le nom utile d'une CONDITION du type "move: Trick Room" ou "Trick Room". */
function stripEffectPrefix(condition: string): string {
  const colonIndex = condition.indexOf(':');
  return colonIndex === -1 ? condition.trim() : condition.slice(colonIndex + 1).trim();
}

const TERRAIN_NAMES: Record<string, 'electric' | 'grassy' | 'misty' | 'psychic'> = {
  'Electric Terrain': 'electric',
  'Grassy Terrain': 'grassy',
  'Misty Terrain': 'misty',
  'Psychic Terrain': 'psychic',
};

const WEATHER_NAMES: Record<
  string,
  'sun' | 'rain' | 'sand' | 'snow' | 'harshsun' | 'heavyrain'
> = {
  SunnyDay: 'sun',
  RainDance: 'rain',
  Sandstorm: 'sand',
  Snowscape: 'snow',
  Hail: 'snow',
  DesolateLand: 'harshsun',
  PrimordialSea: 'heavyrain',
};

/**
 * Initialise un BattleState à partir du Team Preview d'un ParsedReplayLog :
 * crée un PokemonState "vierge" par Pokémon annoncé, avant tout switch réel.
 */
export function initBattleStateFromReplay(replay: ParsedReplayLog): BattleState {
  let battle = createInitialBattleState();

  for (const entry of replay.teamPreview) {
    const key = pokemonKey(entry.side, entry.details.species);
    const pokemon = createInitialPokemonState({
      species: entry.details.species,
      side: entry.side,
      level: entry.details.level,
    });
    battle = {
      ...battle,
      pokemonByKey: { ...battle.pokemonByKey, [key]: pokemon },
    };
  }

  return battle;
}

/**
 * Applique une unique ligne du protocole au BattleState et retourne le
 * nouvel état. Toute ligne non reconnue est ignorée sans erreur (le
 * protocole a beaucoup de messages cosmétiques qu'on n'a pas besoin de
 * modéliser pour le moteur d'évaluation).
 */
export function applyLine(battle: BattleState, line: TurnLine): BattleState {
  switch (line.type) {
    case 'turn': {
      const turnNumber = parseInt(line.args[0], 10);
      let next = { ...battle, turnNumber };
      for (const key of Object.keys(next.pokemonByKey)) {
        next = updatePokemon(next, key, (p) =>
          p.switchedInThisTurn ? { ...p, switchedInThisTurn: false } : p,
        );
      }
      return next;
    }

    case 'switch':
    case 'drag': {
      const [identRaw, detailsRaw, hpRaw] = line.args;
      const ident = parsePokemonIdent(identRaw);
      const details = parsePokemonDetails(detailsRaw);
      const hpStatus = parseHpStatus(hpRaw ?? '');
      const side = ident.side as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2' || !ident.position) return battle;

      // `details.species` est déjà l'espèce de BASE (le suffixe "-Mega"
      // éventuel a été normalisé par parsePokemonDetails), donc la clé
      // reste stable même si ce Pokémon switch-in déjà Mega-évolué un
      // tour précédent (le |-mega| d'origine n'est émis qu'une seule fois).
      const key = pokemonKey(side, details.species);

      // Le Pokémon qui occupait cette position avant doit être "libéré"
      // (boosts/volatiles remis à zéro), sauf s'il vient de fainter (déjà
      // géré par |faint| séparément, qui retire la position).
      const outgoingKey = battle.activeByPosition[ident.position];
      let next = battle;
      if (outgoingKey && outgoingKey !== key && next.pokemonByKey[outgoingKey]) {
        next = updatePokemon(next, outgoingKey, resetOnSwitchOut);
      }

      // Crée le PokemonState s'il n'existait pas encore (ne devrait pas
      // arriver si le Team Preview a été parsé, mais robustesse en plus).
      let pokemon = next.pokemonByKey[key];
      if (!pokemon) {
        pokemon = createInitialPokemonState({
          species: details.species,
          side,
          level: details.level,
        });
      }

      pokemon = setPosition(pokemon, ident.position);
      pokemon = {
        ...pokemon,
        nickname: ident.name,
        fainted: false,
        hasBeenSentOut: true,
        switchedInThisTurn: true,
      };
      pokemon = setHp(pokemon, hpStatus.hp, hpStatus.maxHp, hpStatus.isPercentage);
      if (details.teraType) {
        pokemon = setTerastallized(pokemon, details.teraType);
      }
      // Restaure l'état Mega si les DETAILS l'indiquent mais qu'on ne
      // l'avait pas encore (cas: replay commençant après la Mega
      // Evolution, ou |-mega| jamais vu pour une raison quelconque).
      if (details.isMegaForme && !pokemon.isMegaEvolved) {
        const megaForme = details.megaVariant
          ? `Mega ${details.species} ${details.megaVariant}`
          : `Mega ${details.species}`;
        pokemon = { ...pokemon, isMegaEvolved: true, megaForme };
      }

      return {
        ...next,
        pokemonByKey: { ...next.pokemonByKey, [key]: pokemon },
        activeByPosition: { ...next.activeByPosition, [ident.position]: key },
      };
    }

    case 'faint': {
      const resolved = resolvePokemonKey(battle, line.args[0]);
      if (!resolved) return battle;
      let next = updatePokemon(battle, resolved.key, markFainted);
      next = clearActivePosition(next, resolved.key);
      return next;
    }

    case '-damage':
    case '-heal': {
      const [identRaw, hpRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      const hpStatus = parseHpStatus(hpRaw ?? '');
      const itemFromTag = extractItemFromTag(line.tags.from);
      let next = updatePokemon(battle, resolved.key, (p) => {
        let updated = setHp(p, hpStatus.hp, hpStatus.maxHp, hpStatus.isPercentage);
        if (itemFromTag) updated = revealItem(updated, itemFromTag);
        if (hpStatus.fainted) updated = markFainted(updated);
        return updated;
      });
      if (hpStatus.fainted) {
        next = clearActivePosition(next, resolved.key);
      }
      return next;
    }

    case '-sethp': {
      const [identRaw, hpRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      const hpStatus = parseHpStatus(hpRaw ?? '');
      return updatePokemon(battle, resolved.key, (p) =>
        setHp(p, hpStatus.hp, hpStatus.maxHp, hpStatus.isPercentage),
      );
    }

    case '-boost':
    case '-unboost': {
      const [identRaw, statRaw, amountRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      const stat = STAT_ABBR[statRaw];
      if (!resolved || !stat) return battle;
      const amount = parseInt(amountRaw, 10) * (line.type === '-unboost' ? -1 : 1);
      return updatePokemon(battle, resolved.key, (p) => applyBoost(p, stat, amount));
    }

    case '-setboost': {
      const [identRaw, statRaw, amountRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      const stat = STAT_ABBR[statRaw];
      if (!resolved || !stat) return battle;
      const amount = parseInt(amountRaw, 10);
      return updatePokemon(battle, resolved.key, (p) => setBoost(p, stat, amount));
    }

    case '-clearboost': {
      const resolved = resolvePokemonKey(battle, line.args[0]);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, clearBoosts);
    }

    case '-clearallboost': {
      let next = battle;
      for (const key of Object.keys(next.pokemonByKey)) {
        next = updatePokemon(next, key, clearBoosts);
      }
      return next;
    }

    case '-status': {
      const [identRaw, statusRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, (p) =>
        applyStatus(p, statusRaw as PokemonState['status']),
      );
    }

    case '-curestatus': {
      const resolved = resolvePokemonKey(battle, line.args[0]);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, clearStatus);
    }

    case '-cureteam': {
      const resolved = resolvePokemonKey(battle, line.args[0]);
      if (!resolved) return battle;
      let next = battle;
      for (const [key, p] of Object.entries(next.pokemonByKey)) {
        if (p.side === resolved.side) {
          next = updatePokemon(next, key, clearStatus);
        }
      }
      return next;
    }

    case '-start': {
      const [identRaw, effectRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, (p) =>
        addVolatile(p, stripEffectPrefix(effectRaw ?? '')),
      );
    }

    case '-end': {
      const [identRaw, effectRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, (p) =>
        removeVolatile(p, stripEffectPrefix(effectRaw ?? '')),
      );
    }

    case 'move': {
      const [identRaw, moveRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved || !moveRaw) return battle;
      return updatePokemon(battle, resolved.key, (p) => revealMove(p, moveRaw));
    }

    case '-item': {
      const [identRaw, itemRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved || !itemRaw) return battle;
      return updatePokemon(battle, resolved.key, (p) => revealItem(p, itemRaw));
    }

    case '-enditem': {
      const [identRaw, itemRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved) return battle;
      return updatePokemon(battle, resolved.key, (p) => {
        const withItem = itemRaw ? revealItem(p, itemRaw) : p;
        return consumeItem(withItem);
      });
    }

    case '-ability': {
      const [identRaw, abilityRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved || !abilityRaw) return battle;
      return updatePokemon(battle, resolved.key, (p) => revealAbility(p, abilityRaw));
    }

    case '-mega': {
      const [identRaw, , megaStoneRaw] = line.args; // args[1]=baseSpecies (ignoré), args[2]=megastone
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved || !megaStoneRaw) return battle;
      const megaForme = resolveMegaForme(megaStoneRaw);
      return updatePokemon(battle, resolved.key, (p) =>
        setMegaEvolved(p, megaStoneRaw, megaForme),
      );
    }

    case '-terastallize': {
      const [identRaw, typeRaw] = line.args;
      const resolved = resolvePokemonKey(battle, identRaw);
      if (!resolved || !typeRaw) return battle;
      let next = updatePokemon(battle, resolved.key, (p) => setTerastallized(p, typeRaw));
      next = updateSide(next, resolved.side, markTerastallizeUsed);
      return next;
    }

    // --- Field (météo / terrain / global) ---

    case '-weather': {
      const [weatherRaw] = line.args;
      if (!weatherRaw || weatherRaw === 'none') {
        return updateField(battle, (f) => setWeather(f, null));
      }
      const mapped = WEATHER_NAMES[weatherRaw] ?? null;
      // [upkeep] = la météo continue, ne pas réinitialiser le compteur de tours.
      if (line.tags.upkeep) return battle;
      return updateField(battle, (f) => setWeather(f, mapped));
    }

    case '-fieldstart': {
      const condition = stripEffectPrefix(line.args[0] ?? '');
      if (condition === 'Trick Room') {
        return updateField(battle, (f) => setTrickRoom(f, true));
      }
      if (condition === 'Gravity') {
        return updateField(battle, (f) => setGravity(f, true));
      }
      const terrain = TERRAIN_NAMES[condition];
      if (terrain) {
        return updateField(battle, (f) => setTerrain(f, terrain));
      }
      return battle;
    }

    case '-fieldend': {
      const condition = stripEffectPrefix(line.args[0] ?? '');
      if (condition === 'Trick Room') {
        return updateField(battle, (f) => setTrickRoom(f, false));
      }
      if (condition === 'Gravity') {
        return updateField(battle, (f) => setGravity(f, false));
      }
      if (TERRAIN_NAMES[condition]) {
        return updateField(battle, (f) => setTerrain(f, null));
      }
      return battle;
    }

    // --- Side (hazards / screens / tailwind) ---

    case '-sidestart': {
      const [sideRaw, conditionRaw] = line.args;
      const side = sideRaw?.slice(0, 2) as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') return battle;
      const condition = stripEffectPrefix(conditionRaw ?? '');

      return updateSide(battle, side, (s) => {
        switch (condition) {
          case 'Spikes':
            return addSpikes(s);
          case 'Toxic Spikes':
            return { ...s, toxicSpikes: true };
          case 'Stealth Rock':
            return setStealthRock(s, true);
          case 'Sticky Web':
            return setStickyWeb(s, true);
          case 'Reflect':
            return setReflect(s, true);
          case 'Light Screen':
            return setLightScreen(s, true);
          case 'Aurora Veil':
            return setAuroraVeil(s, true);
          case 'Tailwind':
            return setTailwind(s, true);
          default:
            return s;
        }
      });
    }

    case '-sideend': {
      const [sideRaw, conditionRaw] = line.args;
      const side = sideRaw?.slice(0, 2) as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') return battle;
      const condition = stripEffectPrefix(conditionRaw ?? '');

      return updateSide(battle, side, (s) => {
        switch (condition) {
          case 'Reflect':
            return setReflect(s, false);
          case 'Light Screen':
            return setLightScreen(s, false);
          case 'Aurora Veil':
            return setAuroraVeil(s, false);
          case 'Tailwind':
            return setTailwind(s, false);
          default:
            return s;
        }
      });
    }

    case 'win':
    case 'tie':
    default:
      return battle;
  }
}

/**
 * Rejoue l'intégralité d'un replay parsé et retourne la liste des
 * BattleState successifs, un par tour (index 0 = avant le premier |turn|).
 */
export function replayToStates(replay: ParsedReplayLog): BattleState[] {
  let battle = initBattleStateFromReplay(replay);
  const states: BattleState[] = [];

  for (const turnLines of replay.turns) {
    for (const line of turnLines) {
      battle = applyLine(battle, line);
    }
    states.push(battle);
  }

  return states;
}
