import { describe, expect, it } from 'vitest';
import { parseReplayLog } from '../../replay/logParser';
import { SAMPLE_MEGA_EVOLUTION_LINES, SAMPLE_VGC_LOG } from '../../replay/__fixtures__/sampleVgcLog';
import { applyLine, initBattleStateFromReplay, replayToStates } from '../reducer';
import { createInitialBattleState, createInitialPokemonState } from '../state';

describe('parseLine', () => {
  it('parses a simple line with no tags', () => {
    const result = parseLine('|turn|3');
    expect(result).toEqual({
      type: 'turn',
      args: ['3'],
      tags: {},
      raw: '|turn|3',
    });
  });

  it('parses tags like [from] and [of]', () => {
    const result = parseLine(
      '|-boost|p1a: Landorus|atk|1|[from] ability: Intimidate|[of] p2a: Gyarados',
    );
    expect(result?.type).toBe('-boost');
    expect(result?.args).toEqual(['p1a: Landorus', 'atk', '1']);
    expect(result?.tags).toEqual({
      from: 'ability: Intimidate',
      of: 'p2a: Gyarados',
    });
  });

  it('parses boolean tags like [miss] and [still]', () => {
    const result = parseLine('|move|p1a: Incineroar|Fake Out|p2a: Urshifu|[miss]');
    expect(result?.tags).toEqual({ miss: true });
  });

  it('returns null for non-protocol lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('some random text')).toBeNull();
  });
});

describe('parsePokemonIdent', () => {
  it('parses an active pokemon ident', () => {
    expect(parsePokemonIdent('p1a: Sparky')).toEqual({
      position: 'p1a',
      side: 'p1',
      name: 'Sparky',
      raw: 'p1a: Sparky',
    });
  });

  it('parses an inactive (side-only) pokemon ident', () => {
    expect(parsePokemonIdent('p1: Dragonite')).toEqual({
      position: null,
      side: 'p1',
      name: 'Dragonite',
      raw: 'p1: Dragonite',
    });
  });

  it('handles doubles position letters b/c/d', () => {
    expect(parsePokemonIdent('p2b: Tornadus').position).toBe('p2b');
  });
});

describe('parsePokemonDetails', () => {
  it('parses species only', () => {
    expect(parsePokemonDetails('Deoxys-Speed')).toEqual({
      species: 'Deoxys-Speed',
      level: 100,
      gender: null,
      shiny: false,
      teraType: null,
      formeUnknown: false,
    });
  });

  it('parses level, gender, shiny', () => {
    expect(parsePokemonDetails('Sawsbuck, L50, F, shiny')).toEqual({
      species: 'Sawsbuck',
      level: 50,
      gender: 'F',
      shiny: true,
      teraType: null,
      formeUnknown: false,
    });
  });

  it('parses tera type', () => {
    const result = parsePokemonDetails('Flutter Mane, tera:Fairy');
    expect(result.teraType).toBe('Fairy');
  });

  it('marks unrevealed team-preview forme', () => {
    const result = parsePokemonDetails('Arceus-*');
    expect(result.formeUnknown).toBe(true);
    expect(result.species).toBe('Arceus');
  });
});

describe('parseHpStatus', () => {
  it('parses absolute hp with no status', () => {
    expect(parseHpStatus('97/100')).toEqual({
      hp: 97,
      maxHp: 100,
      isPercentage: true,
      status: '',
      fainted: false,
    });
  });

  it('parses hp with a status condition', () => {
    const result = parseHpStatus('55/55 par');
    expect(result.status).toBe('par');
    expect(result.fainted).toBe(false);
  });

  it('parses fainted (0 fnt)', () => {
    expect(parseHpStatus('0 fnt')).toEqual({
      hp: 0,
      maxHp: 0,
      isPercentage: false,
      status: 'fnt',
      fainted: true,
    });
  });
});

describe('parseReplayLog (full sample)', () => {
  const parsed = parseReplayLog(SAMPLE_VGC_LOG);

  it('extracts header metadata', () => {
    expect(parsed.gametype).toBe('doubles');
    expect(parsed.genNum).toBe(9);
    expect(parsed.tier).toBe('[Gen 9] VGC 2025 Reg H (Bo3)');
    expect(parsed.teamSizes).toEqual({ p1: 4, p2: 4 });
  });

  it('extracts both players', () => {
    expect(parsed.players).toHaveLength(2);
    expect(parsed.players[0]).toMatchObject({ side: 'p1', username: 'Alice' });
    expect(parsed.players[1]).toMatchObject({ side: 'p2', username: 'Bob' });
  });

  it('extracts team preview pokemon for both sides', () => {
    const p1Preview = parsed.teamPreview.filter((p) => p.side === 'p1');
    const p2Preview = parsed.teamPreview.filter((p) => p.side === 'p2');
    expect(p1Preview).toHaveLength(4);
    expect(p2Preview).toHaveLength(4);
    expect(p1Preview[0].details.species).toBe('Incineroar');
    expect(p2Preview[2].details.species).toBe('Calyrex-Shadow');
  });

  it('groups lines by turn number, including turn 0 (pre-battle)', () => {
    expect(parsed.turns[0].some((l) => l.type === 'switch')).toBe(true);
    expect(parsed.turns[1].some((l) => l.type === 'move')).toBe(true);
    expect(parsed.turns[2].some((l) => l.type === 'switch')).toBe(true);
  });

  it('captures the winner', () => {
    expect(parsed.winner).toBe('Alice');
    expect(parsed.isTie).toBe(false);
  });

  it('captures a faint event in turn 1', () => {
    const turn1 = parsed.turns[1];
    const faintLine = turn1.find((l) => l.type === 'faint');
    expect(faintLine?.args).toEqual(['p1b: Rillaboom']);
  });

  it('captures field start (terrain) with a [from] tag', () => {
    const turn1 = parsed.turns[1];
    const terrainLine = turn1.find((l) => l.type === '-fieldstart');
    expect(terrainLine?.args).toEqual(['move: Grassy Terrain']);
    expect(terrainLine?.tags.from).toBe('ability: Grassy Surge');
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
    const lines = parseReplayLog(
      `|gametype|doubles\n${SAMPLE_MEGA_EVOLUTION_LINES}|switch|p1a: Incineroar|Incineroar, F|100/100\n`,
    ).turns.flat();
    for (const line of lines) {
      battle = applyLine(battle, line);
    }
    // Garchomp a switch out (remplacé par Incineroar à p1a), mais reste mega pour le reste du match.
    expect(battle.pokemonByKey['p1:Garchomp'].isMegaEvolved).toBe(true);
  });
});
