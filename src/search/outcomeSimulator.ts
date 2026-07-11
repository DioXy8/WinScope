/**
 * search/outcomeSimulator.ts
 *
 * Simule le résultat d'un tour complet (jusqu'à 4 actions : 2 par camp)
 * appliqué à un BattleState. Le hasard du jeu (accuracy, critiques) est
 * modélisé par un ARBRE DE BRANCHES PONDÉRÉES plutôt que par un tirage
 * aléatoire : pour "ce move peut toucher ou rater", on produit 2 branches
 * (touche avec sa probabilité, rate avec la sienne) plutôt que de choisir
 * une issue au hasard. Plus coûteux en calcul mais déterministe et
 * exhaustif — cohérent avec la demande du projet ("couvrir toutes les
 * possibilités").
 *
 * Les dégâts eux-mêmes (16 rolls 85-100% du damage calculator) sont
 * résumés par leur MOYENNE dans ce module : énumérer les 16 rolls en plus
 * des branches accuracy/crit ferait exploser le nombre de branches sans
 * changer significativement l'évaluation finale (l'écart min-max reste
 * disponible séparément via damageCalc.ts pour l'UI).
 *
 * Limites assumées pour cette première version, à étendre plus tard :
 * - Les effets secondaires probabilistes (ex: 10% paralysie de Body Slam)
 *   ne sont PAS branchés séparément.
 * - Pas de prise en charge des doubles hits / multi-hits (Bullet Seed...).
 * - Les moves status (Protect, Tailwind...) ne modifient pas encore l'état
 *   en détail (pas de pose de volatile/side condition ici) — seulement
 *   notés pour l'évaluateur en aval.
 */

import { markFainted, resetOnSwitchOut, setHp, setPosition } from '../engine/pokemon';
import type { BattleState, PokemonState } from '../engine/state';
import { calculateDamage } from '../damagecalc/damageCalc';
import { buildVendorPokemon, isOffensiveMove, isSpreadMove } from '../damagecalc/adapter';
import { getMoveAccuracyFraction, getMoveTargetInfo } from './actionGenerator';
import { actsBefore, buildSpeedContext } from './speedOrder';
import type { SpeedContext } from './speedOrder';
import type { PlayerAction } from './actionTypes';
import type { PokemonPosition, StatId } from '../replay/types';

/** Une feuille de l'arbre de simulation : un BattleState résultant + la probabilité de cette branche. */
export interface SimulationBranch {
  battle: BattleState;
  probability: number;
  notes: string[];
}

const STANDARD_CRIT_CHANCE = 1 / 24;

/** Construit le SpeedContext nécessaire pour ordonner les actions, depuis les vraies stats calculées. */
export function buildSpeedContextFromBattle(battle: BattleState): SpeedContext {
  const rawSpeedByKey: Record<string, number> = {};
  for (const [key, pokemon] of Object.entries(battle.pokemonByKey)) {
    if (pokemon.fainted || pokemon.position === null) continue;
    try {
      rawSpeedByKey[key] = buildVendorPokemon(pokemon).rawStats.sp;
    } catch {
      continue;
    }
  }
  return buildSpeedContext(battle, rawSpeedByKey);
}

function getPokemonAtPosition(battle: BattleState, position: PokemonPosition): PokemonState | null {
  const key = battle.activeByPosition[position];
  return key ? battle.pokemonByKey[key] ?? null : null;
}

function updatePokemonInBattle(
  battle: BattleState,
  key: string,
  updater: (p: PokemonState) => PokemonState,
): BattleState {
  const existing = battle.pokemonByKey[key];
  if (!existing) return battle;
  return { ...battle, pokemonByKey: { ...battle.pokemonByKey, [key]: updater(existing) } };
}

function applySwitchAction(battle: BattleState, userPosition: PokemonPosition, incomingKey: string): BattleState {
  const outgoingKey = battle.activeByPosition[userPosition];
  let next = battle;
  if (outgoingKey) {
    next = updatePokemonInBattle(next, outgoingKey, resetOnSwitchOut);
  }
  next = updatePokemonInBattle(next, incomingKey, (p) => setPosition(p, userPosition));
  return {
    ...next,
    activeByPosition: { ...next.activeByPosition, [userPosition]: incomingKey },
  };
}

function applyMoveHitOnTarget(
  battle: BattleState,
  attackerKey: string,
  attackerSide: 'p1' | 'p2',
  targetPosition: PokemonPosition,
  moveName: string,
  isCritical: boolean,
): { battle: BattleState; note: string } {
  const targetKey = battle.activeByPosition[targetPosition];
  if (!targetKey) return { battle, note: `${moveName}: cible absente` };
  const attacker = battle.pokemonByKey[attackerKey];
  const target = battle.pokemonByKey[targetKey];
  if (!attacker || !target || target.fainted) {
    return { battle, note: `${moveName}: cible déjà K.O.` };
  }

  if (target.volatiles.has('Protect')) {
    return { battle, note: `${moveName}: bloqué par Protect` };
  }
  if (target.volatiles.has('QuickGuard') && (getMoveTargetInfo(moveName)?.priority ?? 0) > 0) {
    return { battle, note: `${moveName}: bloqué par Quick Guard` };
  }
  if (target.volatiles.has('WideGuard') && isSpreadMove(moveName)) {
    return { battle, note: `${moveName}: bloqué par Wide Guard` };
  }
  if (target.volatiles.has('CraftyShield') && !isOffensiveMove(moveName)) {
    return { battle, note: `${moveName}: bloqué par Crafty Shield` };
  }

  let result;
  try {
    result = calculateDamage(attacker, target, moveName, battle, attackerSide);
  } catch {
    return { battle, note: `${moveName}: non calculable (hors dex Champions)` };
  }

  const avgDamage = result.rolls.reduce((a, b) => a + b, 0) / result.rolls.length;
  const finalDamage = Math.round(isCritical ? avgDamage * 1.5 : avgDamage);

  const maxHp = target.maxHp ?? buildVendorPokemon(target).maxHP;
  const newHp = Math.max(0, target.currentHp - finalDamage);

  let next = updatePokemonInBattle(battle, targetKey, (p) =>
    setHp(p, newHp, maxHp, p.hpIsPercentage && p.maxHp === null),
  );
  if (newHp <= 0) {
    next = updatePokemonInBattle(next, targetKey, markFainted);
    const { [targetPosition]: _removed, ...rest } = next.activeByPosition;
    next = { ...next, activeByPosition: rest };
  }

  return {
    battle: next,
    note: `${moveName} (${attacker.species}) → ${target.species}: ${finalDamage} dégâts${isCritical ? ' (crit)' : ''}${newHp <= 0 ? ' [K.O.]' : ''}`,
  };
}

/**
 * Moves de statut auto-ciblés (aucune cible offensive, `targetPositions`
 * vide) qui modifient les propres stats de l'utilisateur. Nos données
 * vendorisées (championsData.json) ne stockent que type/catégorie des
 * moves, pas leurs effets de boost — table construite à la main, couvrant
 * les moves de setup les plus courants en VGC/Champions. Un move de statut
 * absent de cette table est encore traité comme "sans effet simulé" (le
 * combat reste inchangé pour cette action) plutôt que de planter — dégradé
 * mais pas cassé, à étendre au fil des besoins plutôt que de prétendre
 * couvrir tous les moves de statut existants.
 *
 * RÉGRESSION IMPORTANTE CORRIGÉE ICI : avant ce correctif, TOUS les moves
 * de statut (Shell Smash, Calm Mind, Swords Dance...) étaient traités comme
 * "sans effet" dans la simulation — un Pokémon qui Shell Smash n'était donc
 * jamais différent, dans l'état simulé, d'un Pokémon qui n'a rien fait ce
 * tour. Ça faussait complètement l'espérance de victoire de toute action de
 * boost, qui semblait alors aussi neutre qu'un pass.
 */
const SELF_BOOST_MOVES: Record<string, Partial<Record<StatId, number>>> = {
  'Shell Smash': { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 },
  'Calm Mind': { spa: 1, spd: 1 },
  'Swords Dance': { atk: 2 },
  'Dragon Dance': { atk: 1, spe: 1 },
  'Nasty Plot': { spa: 2 },
  'Bulk Up': { atk: 1, def: 1 },
  'Quiver Dance': { spa: 1, spd: 1, spe: 1 },
  Agility: { spe: 2 },
  'Rock Polish': { spe: 2 },
  Autotomize: { spe: 2 },
  'Iron Defense': { def: 2 },
  'Cosmic Power': { def: 1, spd: 1 },
  'Cotton Guard': { def: 3 },
  Growth: { atk: 1, spa: 1 },
  'Work Up': { atk: 1, spa: 1 },
  'Hone Claws': { atk: 1 },
  'Tail Glow': { spa: 3 },
  'Belly Drum': { atk: 6 },
  'Victory Dance': { atk: 1, def: 1, spe: 1 },
  'No Retreat': { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  'Clangorous Soul': { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  Coil: { atk: 1, def: 1 },
};

/**
 * Protections de ZONE (protègent tout le côté du lanceur, pas seulement
 * lui-même, contrairement à Protect) — chacune avec une portée précise :
 *  - Quick Guard : bloque les moves prioritaires (priorité > 0).
 *  - Wide Guard : bloque les moves de zone (Earthquake, Dazzling Gleam...).
 *  - Crafty Shield : bloque les moves de catégorie Statut ciblés (Thunder
 *    Wave, Taunt...) mais PAS les dégâts directs.
 */
const QUICK_GUARD_MOVES = new Set(['Quick Guard']);
const WIDE_GUARD_MOVES = new Set(['Wide Guard']);
const CRAFTY_SHIELD_MOVES = new Set(['Crafty Shield']);

/** Nom du volatile posé sur CHAQUE Pokémon actif du côté du lanceur, pour ces 3 moves de zone. */
function sideGuardVolatileName(moveName: string): 'QuickGuard' | 'WideGuard' | 'CraftyShield' | null {
  if (QUICK_GUARD_MOVES.has(moveName)) return 'QuickGuard';
  if (WIDE_GUARD_MOVES.has(moveName)) return 'WideGuard';
  if (CRAFTY_SHIELD_MOVES.has(moveName)) return 'CraftyShield';
  return null;
}

/**
 * Famille "Protect" classique (protection totale contre un move ciblé,
 * priorité +4) — la portée est différente des protections de zone
 * ci-dessus (Quick Guard/Wide Guard/Crafty Shield), gérées séparément.
 */
const PROTECT_MOVES = new Set([
  'Protect',
  'Detect',
  'Spiky Shield',
  'Baneful Bunker',
  "King's Shield",
  'Obstruct',
  'Silk Trap',
  'Burning Bulwark',
]);

/** Applique un boost, borné à [-6, 6] comme les vraies mécaniques de jeu. */
function applyBoostDelta(pokemon: PokemonState, delta: Partial<Record<StatId, number>>): PokemonState {
  const nextBoosts = { ...pokemon.boosts };
  for (const [stat, amount] of Object.entries(delta) as [StatId, number][]) {
    nextBoosts[stat] = Math.max(-6, Math.min(6, nextBoosts[stat] + amount));
  }
  return { ...pokemon, boosts: nextBoosts };
}

/**
 * Rage Powder / Follow Me : redirigent vers le lanceur tous les moves
 * single-target adverses visant un autre Pokémon de son côté ce tour-ci.
 * Ne redirige PAS les moves de zone (Earthquake, Dazzling Gleam...), qui
 * touchent leurs cibles normales quoi qu'il arrive — comportement réel.
 */
const REDIRECT_MOVES = new Set(['Rage Powder', 'Follow Me']);

/**
 * Si `moveName` est un move single-target (pas de zone) et qu'un Pokémon
 * actif du côté visé a activé Rage Powder/Follow Me ce tour, renvoie sa
 * position à la place de la cible d'origine. Sinon renvoie la position
 * inchangée. Simplification assumée : ignore les exceptions d'immunité à
 * la redirection (Overcoat contre Rage Powder, types Vol/Odorat immunisé
 * contre Rage Powder spécifiquement) — un cas plus rare que la redirection
 * elle-même, à affiner si besoin plutôt que d'alourdir cette première passe.
 */
function resolveRedirectedTarget(
  battle: BattleState,
  attackerSide: 'p1' | 'p2',
  moveName: string,
  targetPosition: PokemonPosition,
): PokemonPosition {
  if (isSpreadMove(moveName)) return targetPosition;
  const targetSide = targetPosition.startsWith('p1') ? 'p1' : 'p2';
  // La redirection ne s'applique qu'aux moves visant le côté ADVERSE — un
  // move de soutien visant son propre allié (Helping Hand, Pollen Puff...)
  // ne doit jamais être redirigé même si cet allié a activé Rage Powder.
  if (targetSide === attackerSide) return targetPosition;
  for (const [pos, key] of Object.entries(battle.activeByPosition)) {
    if (!pos.startsWith(targetSide)) continue;
    const p = battle.pokemonByKey[key];
    if (p && !p.fainted && p.volatiles.has('Redirect')) {
      return pos as PokemonPosition;
    }
  }
  return targetPosition;
}

function applySingleAction(
  battle: BattleState,
  action: PlayerAction,
  attackerSide: 'p1' | 'p2',
  isCritical: boolean,
): { battle: BattleState; notes: string[] } {
  if (action.kind === 'switch') {
    const next = applySwitchAction(battle, action.userPosition, action.incomingKey);
    return { battle: next, notes: [`Switch en ${action.incomingKey}`] };
  }

  if (action.targetPositions.length === 0) {
    if (REDIRECT_MOVES.has(action.moveName)) {
      const userPokemon = battle.pokemonByKey[action.userKey];
      if (!userPokemon || userPokemon.fainted) {
        return { battle, notes: [`${action.moveName} (utilisateur indisponible)`] };
      }
      const nextBattle = updatePokemonInBattle(battle, action.userKey, (p) => ({
        ...p,
        volatiles: new Set(p.volatiles).add('Redirect'),
      }));
      return {
        battle: nextBattle,
        notes: [`${action.moveName} (${userPokemon.species}): redirige les attaques ciblées ce tour`],
      };
    }

    const guardName = sideGuardVolatileName(action.moveName);
    if (guardName) {
      const userPokemon = battle.pokemonByKey[action.userKey];
      if (!userPokemon || userPokemon.fainted) {
        return { battle, notes: [`${action.moveName} (utilisateur indisponible)`] };
      }
      // Protège TOUT le côté (les 2 emplacements actifs en double), pas
      // seulement le lanceur — contrairement à Protect classique.
      let nextBattle = battle;
      for (const [pos, key] of Object.entries(battle.activeByPosition)) {
        if (!pos.startsWith(userPokemon.side)) continue;
        nextBattle = updatePokemonInBattle(nextBattle, key, (p) => ({
          ...p,
          volatiles: new Set(p.volatiles).add(guardName),
        }));
      }
      return {
        battle: nextBattle,
        notes: [`${action.moveName} (${userPokemon.species}): protège le côté ${userPokemon.side} ce tour`],
      };
    }

    if (PROTECT_MOVES.has(action.moveName)) {
      const userPokemon = battle.pokemonByKey[action.userKey];
      if (!userPokemon || userPokemon.fainted) {
        return { battle, notes: [`${action.moveName} (utilisateur indisponible)`] };
      }
      const nextBattle = updatePokemonInBattle(battle, action.userKey, (p) => ({
        ...p,
        volatiles: new Set(p.volatiles).add('Protect'),
      }));
      return { battle: nextBattle, notes: [`${action.moveName} (${userPokemon.species}): protégé ce tour`] };
    }

    const boostDelta = SELF_BOOST_MOVES[action.moveName];
    if (!boostDelta) {
      return { battle, notes: [`${action.moveName} (effet non simulé en détail)`] };
    }
    const userPokemon = battle.pokemonByKey[action.userKey];
    if (!userPokemon || userPokemon.fainted) {
      return { battle, notes: [`${action.moveName} (utilisateur indisponible)`] };
    }
    const nextBattle = updatePokemonInBattle(battle, action.userKey, (p) => applyBoostDelta(p, boostDelta));
    const boostSummary = Object.entries(boostDelta)
      .map(([stat, amount]) => `${stat.toUpperCase()} ${amount > 0 ? `+${amount}` : amount}`)
      .join(', ');
    return { battle: nextBattle, notes: [`${action.moveName} (${userPokemon.species}): ${boostSummary}`] };
  }

  let current = battle;
  const notes: string[] = [];
  for (const targetPosition of action.targetPositions) {
    const redirectedTarget = resolveRedirectedTarget(current, attackerSide, action.moveName, targetPosition);
    const { battle: next, note } = applyMoveHitOnTarget(
      current,
      action.userKey,
      attackerSide,
      redirectedTarget,
      action.moveName,
      isCritical,
    );
    current = next;
    notes.push(note);
  }
  return { battle: current, notes };
}

/**
 * Simule un tour complet : jusqu'à 4 actions (2 par camp), dans l'ordre de
 * vitesse réel, en générant une branche par combinaison (touché/raté) ×
 * (crit/non-crit) pour chaque action offensive. Retourne la liste de
 * branches pondérées, dont la somme des probabilités vaut 1.
 *
 * Avertissement combinatoire : avec N actions offensives à accuracy <100%,
 * le nombre de branches croît jusqu'à 4^N (accuracy × crit). Avec 4 actions
 * max par tour en doubles, le pire cas reste gérable (≤256 branches), mais
 * turnAnalyzer.ts doit rester vigilant s'il appelle ça pour de nombreuses
 * combinaisons d'actions candidates.
 */
export function simulateTurn(
  battle: BattleState,
  p1Actions: PlayerAction[],
  p2Actions: PlayerAction[],
): SimulationBranch[] {
  const speedContext = buildSpeedContextFromBattle(battle);

  const switchActions = [...p1Actions, ...p2Actions].filter(
    (a): a is PlayerAction & { kind: 'switch' } => a.kind === 'switch',
  );
  const moveActionsWithSide: { action: PlayerAction; side: 'p1' | 'p2' }[] = [
    ...p1Actions.filter((a) => a.kind === 'move').map((action) => ({ action, side: 'p1' as const })),
    ...p2Actions.filter((a) => a.kind === 'move').map((action) => ({ action, side: 'p2' as const })),
  ];

  moveActionsWithSide.sort((a, b) => {
    if (actsBefore(a.action, b.action, speedContext)) return -1;
    if (actsBefore(b.action, a.action, speedContext)) return 1;
    return 0;
  });

  let branches: SimulationBranch[] = [{ battle, probability: 1, notes: [] }];

  for (const switchAction of switchActions) {
    branches = branches.map((branch) => {
      const next = applySwitchAction(branch.battle, switchAction.userPosition, switchAction.incomingKey);
      return { ...branch, battle: next, notes: [...branch.notes, `Switch en ${switchAction.incomingKey}`] };
    });
  }

  for (const { action, side } of moveActionsWithSide) {
    if (action.kind !== 'move') continue;
    const accuracyFraction = getMoveAccuracyFraction(action.moveName);
    const hasOffensiveTarget = action.targetPositions.length > 0;
    const isStatusEffect = !hasOffensiveTarget;

    const nextBranches: SimulationBranch[] = [];

    for (const branch of branches) {
      const attacker = getPokemonAtPosition(branch.battle, action.userPosition);
      if (!attacker || attacker.fainted) {
        nextBranches.push(branch);
        continue;
      }

      const missProbability = isStatusEffect ? 0 : 1 - accuracyFraction;
      const hitProbability = 1 - missProbability;

      if (missProbability > 0) {
        nextBranches.push({
          ...branch,
          probability: branch.probability * missProbability,
          notes: [...branch.notes, `${action.moveName} (${attacker.species}) rate`],
        });
      }

      if (hitProbability > 0) {
        if (isStatusEffect) {
          const { battle: afterStatus, notes } = applySingleAction(branch.battle, action, side, false);
          nextBranches.push({
            battle: afterStatus,
            probability: branch.probability * hitProbability,
            notes: [...branch.notes, ...notes],
          });
        } else {
          const { battle: afterCrit, notes: critNotes } = applySingleAction(branch.battle, action, side, true);
          nextBranches.push({
            battle: afterCrit,
            probability: branch.probability * hitProbability * STANDARD_CRIT_CHANCE,
            notes: [...branch.notes, ...critNotes],
          });

          const { battle: afterNormal, notes: normalNotes } = applySingleAction(
            branch.battle,
            action,
            side,
            false,
          );
          nextBranches.push({
            battle: afterNormal,
            probability: branch.probability * hitProbability * (1 - STANDARD_CRIT_CHANCE),
            notes: [...branch.notes, ...normalNotes],
          });
        }
      }
    }

    branches = nextBranches;
  }

  return branches;
}
