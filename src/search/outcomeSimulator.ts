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
import { buildVendorPokemon } from '../damagecalc/adapter';
import { getMoveAccuracyFraction, getMoveTargetInfo } from './actionGenerator';
import { actsBefore, buildSpeedContext } from './speedOrder';
import type { SpeedContext } from './speedOrder';
import type { PlayerAction } from './actionTypes';
import type { PokemonPosition } from '../replay/types';

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
    return { battle, notes: [`${action.moveName} (effet non simulé en détail)`] };
  }

  let current = battle;
  const notes: string[] = [];
  for (const targetPosition of action.targetPositions) {
    const { battle: next, note } = applyMoveHitOnTarget(
      current,
      action.userKey,
      attackerSide,
      targetPosition,
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
