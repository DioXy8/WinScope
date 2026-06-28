import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { actsBefore, buildSpeedContext, computeEffectiveSpeed, sortActionsBySpeed } from '../speedOrder';
import type { MoveAction, SwitchAction } from '../actionTypes';

describe('computeEffectiveSpeed', () => {
  it('returns the raw speed unmodified with no boost/status/tailwind', () => {
    const pokemon = createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 });
    expect(computeEffectiveSpeed(pokemon, 100, false)).toBe(100);
  });

  it('applies a positive speed boost', () => {
    const pokemon = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 2 },
    };
    expect(computeEffectiveSpeed(pokemon, 100, false)).toBe(200);
  });

  it('halves speed when paralyzed', () => {
    const pokemon = {
      ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      status: 'par' as const,
    };
    expect(computeEffectiveSpeed(pokemon, 100, false)).toBe(50);
  });

  it('doubles speed under Tailwind', () => {
    const pokemon = createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 });
    expect(computeEffectiveSpeed(pokemon, 100, true)).toBe(200);
  });
});

describe('sortActionsBySpeed', () => {
  it('orders a high-priority move (Protect) before a normal-priority move', () => {
    const battle = createInitialBattleState();
    const context = buildSpeedContext(battle, { 'p1:A': 100, 'p2:B': 200 });

    const protectAction: MoveAction = {
      kind: 'move',
      userKey: 'p1:A',
      userPosition: 'p1a',
      moveName: 'Protect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquakeAction: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const sorted = sortActionsBySpeed([earthquakeAction, protectAction], context);
    expect(sorted[0].kind === 'move' && sorted[0].moveName).toBe('Protect');
  });

  it('orders by speed when priority is equal (faster first, no Trick Room)', () => {
    const battle = createInitialBattleState();
    const context = buildSpeedContext(battle, { 'p1:A': 50, 'p2:B': 150 });

    const slowMove: MoveAction = {
      kind: 'move',
      userKey: 'p1:A',
      userPosition: 'p1a',
      moveName: 'Earthquake',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const fastMove: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const sorted = sortActionsBySpeed([slowMove, fastMove], context);
    expect(sorted[0].userKey).toBe('p2:B');
  });

  it('reverses speed order when Trick Room is active', () => {
    let battle = createInitialBattleState();
    battle = { ...battle, field: { ...battle.field, isTrickRoom: true } };
    const context = buildSpeedContext(battle, { 'p1:A': 50, 'p2:B': 150 });

    const slowMove: MoveAction = {
      kind: 'move',
      userKey: 'p1:A',
      userPosition: 'p1a',
      moveName: 'Earthquake',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const fastMove: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    const sorted = sortActionsBySpeed([fastMove, slowMove], context);
    expect(sorted[0].userKey).toBe('p1:A');
  });
});

describe('actsBefore', () => {
  it('returns true when priority is strictly higher', () => {
    const battle = createInitialBattleState();
    const context = buildSpeedContext(battle, { 'p1:A': 50, 'p2:B': 200 });

    const protectAction: MoveAction = {
      kind: 'move',
      userKey: 'p1:A',
      userPosition: 'p1a',
      moveName: 'Protect',
      targetPositions: [],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const earthquakeAction: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    expect(actsBefore(protectAction, earthquakeAction, context)).toBe(true);
    expect(actsBefore(earthquakeAction, protectAction, context)).toBe(false);
  });

  it('returns false (ambiguous) when speed is exactly equal', () => {
    const battle = createInitialBattleState();
    const context = buildSpeedContext(battle, { 'p1:A': 100, 'p2:B': 100 });

    const moveA: MoveAction = {
      kind: 'move',
      userKey: 'p1:A',
      userPosition: 'p1a',
      moveName: 'Earthquake',
      targetPositions: ['p2a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };
    const moveB: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    expect(actsBefore(moveA, moveB, context)).toBe(false);
    expect(actsBefore(moveB, moveA, context)).toBe(false);
  });

  it('treats switch actions as priority 0 for comparison purposes', () => {
    const battle = createInitialBattleState();
    const context = buildSpeedContext(battle, { 'p1:A': 50, 'p2:B': 200 });

    const switchAction: SwitchAction = {
      kind: 'switch',
      userKey: 'p1:A',
      userPosition: 'p1a',
      incomingKey: 'p1:Bench',
    };
    const earthquakeAction: MoveAction = {
      kind: 'move',
      userKey: 'p2:B',
      userPosition: 'p2a',
      moveName: 'Earthquake',
      targetPositions: ['p1a'],
      willMegaEvolve: false,
      willTerastallize: false,
    };

    expect(actsBefore(earthquakeAction, switchAction, context)).toBe(true);
  });
});
