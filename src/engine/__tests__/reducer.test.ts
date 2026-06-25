import { describe, expect, it } from 'vitest';
import { parseReplayLog } from '../../replay/logParser';
import { SAMPLE_VGC_LOG } from '../../replay/__fixtures__/sampleVgcLog';
import { initBattleStateFromReplay, replayToStates } from '../reducer';

describe('initBattleStateFromReplay', () => {
  const replay = parseReplayLog(SAMPLE_VGC_LOG);
  const initial = initBattleStateFromReplay(replay);

  it('creates a PokemonState for every team-preview pokemon', () => {
    const keys = Object.keys(initial.pokemonByKey);
    expect(keys).toHaveLength(8); // 4 p1 + 4 p2
    expect(initial.pokemonByKey['p1:Incineroar']).toBeDefined();
    expect(initial.pokemonByKey['p2:Calyrex-Shadow']).toBeDefined();
  });

  it('starts with no active pokemon on the field yet', () => {
    expect(Object.keys(initial.activeByPosition)).toHaveLength(0);
  });
});

describe('replayToStates (full sample replay)', () => {
  const replay = parseReplayLog(SAMPLE_VGC_LOG);
  const states = replayToStates(replay);
  const afterTurn0 = states[0];
  const afterTurn1 = states[1];
  const afterTurn2 = states[2];

  it('places the 4 initial switches at the right positions after turn 0', () => {
    expect(afterTurn0.activeByPosition.p1a).toBe('p1:Incineroar');
    expect(afterTurn0.activeByPosition.p1b).toBe('p1:Rillaboom');
    expect(afterTurn0.activeByPosition.p2a).toBe('p2:Urshifu-Rapid-Strike');
    expect(afterTurn0.activeByPosition.p2b).toBe('p2:Tornadus');
  });

  it('applies Fake Out damage to Tornadus in turn 1', () => {
    const tornadus = afterTurn1.pokemonByKey['p2:Tornadus'];
    expect(tornadus.currentHp).toBe(88);
  });

  it('reveals moves used during the turn', () => {
    const incineroar = afterTurn1.pokemonByKey['p1:Incineroar'];
    expect(incineroar.revealedMoves).toContain('Fake Out');

    const rillaboom = afterTurn1.pokemonByKey['p1:Rillaboom'];
    expect(rillaboom.revealedMoves).toContain('Grassy Glide');
  });

  it('applies repeated -damage lines correctly (triple crit KO on Rillaboom)', () => {
    const rillaboom = afterTurn1.pokemonByKey['p1:Rillaboom'];
    expect(rillaboom.currentHp).toBe(0);
    expect(rillaboom.fainted).toBe(true);
  });

  it('removes the fainted pokemon from activeByPosition', () => {
    expect(afterTurn1.activeByPosition.p1b).toBeUndefined();
  });

  it('sets the grassy terrain field effect triggered by Grassy Surge', () => {
    expect(afterTurn1.field.terrain).toBe('grassy');
  });

  it('switches in Amoonguss at p1b during turn 2', () => {
    expect(afterTurn2.activeByPosition.p1b).toBe('p1:Amoonguss');
    const amoonguss = afterTurn2.pokemonByKey['p1:Amoonguss'];
    expect(amoonguss.fainted).toBe(false);
    expect(amoonguss.currentHp).toBe(100);
  });

  it('applies unboost (-1 speed) to Incineroar from Bleakwind Storm', () => {
    const incineroar = afterTurn2.pokemonByKey['p1:Incineroar'];
    expect(incineroar.boosts.spe).toBe(-1);
  });

  it('applies sleep status to Tornadus from Spore', () => {
    const tornadus = afterTurn2.pokemonByKey['p2:Tornadus'];
    expect(tornadus.status).toBe('slp');
  });

  it('clears the weather field after [upkeep] "none" report', () => {
    expect(afterTurn2.field.weather).toBeNull();
  });

  it('heals Incineroar via Leftovers at end of turn 2', () => {
    const incineroar = afterTurn2.pokemonByKey['p1:Incineroar'];
    expect(incineroar.currentHp).toBe(60);
    expect(incineroar.revealedItem).toBe('Leftovers');
  });

  it('produces one BattleState per turn (turns 0 through 3)', () => {
    expect(states).toHaveLength(4);
  });
});
