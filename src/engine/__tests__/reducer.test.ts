import { describe, expect, it } from 'vitest';
import { parseReplayLog } from '../../replay/logParser';
import { SAMPLE_MEGA_EVOLUTION_LINES, SAMPLE_VGC_LOG } from '../../replay/__fixtures__/sampleVgcLog';
import { applyLine, initBattleStateFromReplay, replayToStates } from '../reducer';
import { createInitialBattleState, createInitialPokemonState } from '../state';

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
  // states[0] = turn 0 (team preview + initial switches)
  // states[1] = end of turn 1
  // states[2] = end of turn 2
  // states[3] = end of turn 3 (win)
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

  it('marks a freshly switched-in pokemon with switchedInThisTurn, cleared on the next turn', () => {
    const amoonguss = afterTurn2.pokemonByKey['p1:Amoonguss'];
    expect(amoonguss.switchedInThisTurn).toBe(true);

    const afterTurn3 = states[3];
    const amoongussLater = afterTurn3.pokemonByKey['p1:Amoonguss'];
    expect(amoongussLater.switchedInThisTurn).toBe(false);
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
    // -weather|none without [upkeep] should clear; here it's reported as
    // upkeep with "none" meaning weather has expired (no active weather to begin with)
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

describe('Mega Evolution support (-mega line)', () => {
  it('marks the pokemon as mega-evolved and resolves the resulting forme', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Garchomp': createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      },
    };

    const lines = parseReplayLog(`|gametype|doubles\n${SAMPLE_MEGA_EVOLUTION_LINES}`).turns.flat();
    for (const line of lines) {
      battle = applyLine(battle, line);
    }

    const garchomp = battle.pokemonByKey['p1:Garchomp'];
    expect(garchomp.isMegaEvolved).toBe(true);
    expect(garchomp.megaStone).toBe('Garchompite');
    expect(garchomp.megaForme).toBe('Mega Garchomp');
    expect(garchomp.revealedItem).toBe('Garchompite');
  });

  it('keeps the mega-evolved flag set even after the pokemon switches out', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Garchomp': createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      },
    };
    const lines = parseReplayLog(`|gametype|doubles\n${SAMPLE_MEGA_EVOLUTION_LINES}|switch|p1a: Incineroar|Incineroar, F|100/100\n`).turns.flat();
    for (const line of lines) {
      battle = applyLine(battle, line);
    }
    // Garchomp a switch out (remplacé par Incineroar à p1a), mais reste mega pour le reste du match.
    expect(battle.pokemonByKey['p1:Garchomp'].isMegaEvolved).toBe(true);
  });

  it('regression: re-entering with a Showdown "-Mega" suffixed detail keeps the same pokemonByKey entry', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Garchomp': createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
        'p1:Incineroar': createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      },
    };
    // Garchomp mega-évolue, switch out (remplacé par Incineroar), puis
    // revient sur le terrain : Showdown renvoie alors "Garchomp-Mega" dans
    // les DETAILS plutôt que "Garchomp" simple, puisque le |-mega| d'origine
    // n'est émis qu'une seule fois dans tout le match.
    const lines = parseReplayLog(
      `|gametype|doubles\n${SAMPLE_MEGA_EVOLUTION_LINES}|switch|p1a: Incineroar|Incineroar, F|100/100\n|switch|p1a: Garchomp|Garchomp-Mega, M|100/100\n`,
    ).turns.flat();
    for (const line of lines) {
      battle = applyLine(battle, line);
    }

    // Une seule entrée pour Garchomp, jamais "p1:Garchomp-Mega".
    expect(battle.pokemonByKey['p1:Garchomp']).toBeDefined();
    expect(battle.pokemonByKey['p1:Garchomp-Mega']).toBeUndefined();
    expect(battle.pokemonByKey['p1:Garchomp'].isMegaEvolved).toBe(true);
    expect(battle.pokemonByKey['p1:Garchomp'].megaForme).toBe('Mega Garchomp');
    expect(battle.activeByPosition.p1a).toBe('p1:Garchomp');
  });

  it('regression: restores isMegaEvolved from switch DETAILS alone if the original |-mega| line was never seen', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Swampert': createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }),
      },
    };
    // Replay tronqué qui ne montre QUE le switch-in avec la forme déjà Mega
    // (pas de |-mega| dans ce fragment) : on doit tout de même reconnaître
    // l'état Mega depuis les DETAILS, plutôt que planter sur une dex lookup
    // avec un nom de forme jamais résolu.
    const lines = parseReplayLog(
      `|gametype|doubles\n|switch|p1a: Swampert|Swampert-Mega, M|100/100\n`,
    ).turns.flat();
    for (const line of lines) {
      battle = applyLine(battle, line);
    }

    const swampert = battle.pokemonByKey['p1:Swampert'];
    expect(swampert.isMegaEvolved).toBe(true);
    expect(swampert.megaForme).toBe('Mega Swampert');
  });
});
