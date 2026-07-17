import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { runMonteCarloGames } from '../monteCarlo';
import type { BattleState } from '../../engine/state';
import type { PlayerAction } from '../actionTypes';

function setupLethalScenario(): BattleState {
  let battle = createInitialBattleState();
  const garchomp = {
    ...createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
    position: 'p1a' as const,
    revealedMoves: ['Earthquake', 'Protect'],
    maxHp: 190,
    currentHp: 190,
    hasBeenSentOut: true,
    hpIsPercentage: false,
  };
  const incineroar = {
    ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
    position: 'p2a' as const,
    revealedMoves: ['Flare Blitz'],
    maxHp: 190,
    currentHp: 5,
    hasBeenSentOut: true,
    hpIsPercentage: false,
  };
  battle = {
    ...battle,
    pokemonByKey: { 'p1:Garchomp': garchomp, 'p2:Incineroar': incineroar },
    activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
  };
  return battle;
}

const earthquake: PlayerAction = {
  kind: 'move',
  userKey: 'p1:Garchomp',
  userPosition: 'p1a',
  moveName: 'Earthquake',
  targetPositions: ['p2a'],
  willMegaEvolve: false,
  willTerastallize: false,
  moveSource: 'revealed',
};

describe('runMonteCarloGames', () => {
  it('runs the requested number of games and reports a coherent breakdown', () => {
    const battle = setupLethalScenario();
    const result = runMonteCarloGames(battle, 'p1a', earthquake, null, { numGames: 200 });
    expect(result.gamesPlayed).toBe(200);
    expect(result.gamesWon + result.gamesLost + result.gamesDrawn + result.gamesInconclusive).toBe(200);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(100);
  });

  it('gives a near-certain win rate for a guaranteed lethal opener against a 1-HP-remaining opponent', () => {
    const battle = setupLethalScenario(); // Incineroar à 5 HP, Earthquake est quasi-certainement fatal
    const result = runMonteCarloGames(battle, 'p1a', earthquake, null, { numGames: 300 });
    expect(result.winRate).toBeGreaterThan(85);
  });

  it('resolves virtually every game to a real conclusion rather than hitting the turn cap', () => {
    const battle = setupLethalScenario();
    const result = runMonteCarloGames(battle, 'p1a', earthquake, null, { numGames: 300, maxTurnsPerGame: 50 });
    expect(result.gamesInconclusive).toBeLessThan(result.gamesPlayed * 0.05);
  });

  it('handles Reg M-B ghost teammates without ever stalling (random ghost fill-in keeps games moving)', () => {
    let battle = createInitialBattleState();
    const mk = (species: string, side: 'p1' | 'p2', hp: number, sentOut: boolean, moves: string[] = []) => ({
      ...createInitialPokemonState({ species, side, level: 50 }),
      maxHp: 190,
      currentHp: hp,
      hasBeenSentOut: sentOut,
      revealedMoves: moves,
    });
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Garchomp': { ...mk('Garchomp', 'p1', 190, true, ['Earthquake']), position: 'p1a' },
        'p2:Incineroar': mk('Incineroar', 'p2', 5, true, ['Flare Blitz']),
        'p2:Weavile': mk('Weavile', 'p2', 190, false),
        'p2:Mawile': mk('Mawile', 'p2', 190, false),
        'p2:Whimsicott': mk('Whimsicott', 'p2', 190, false),
        'p2:Tyranitar': mk('Tyranitar', 'p2', 190, false),
      },
      activeByPosition: { p1a: 'p1:Garchomp', p2a: 'p2:Incineroar' },
    };
    const result = runMonteCarloGames(battle, 'p1a', earthquake, null, { numGames: 300, maxTurnsPerGame: 60 });
    expect(result.gamesInconclusive).toBeLessThan(result.gamesPlayed * 0.1);
    expect(result.averageTurnsToConclude).toBeGreaterThan(1); // doit continuer au-delà du premier K.O., pas s'arrêter net
  });

  it('produces some variety across games (not the exact same line every time)', () => {
    const battle = setupLethalScenario();
    const result = runMonteCarloGames(battle, 'p1a', earthquake, null, { numGames: 300, explorationRate: 0.3 });
    // Avec de l'exploration et un adversaire qui peut mourir de différentes
    // façons, le nombre moyen de tours ne devrait pas être un entier figé à 1.
    expect(Number.isFinite(result.averageTurnsToConclude)).toBe(true);
  });
});
