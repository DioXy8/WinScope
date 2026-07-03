import { describe, expect, it } from 'vitest';
import {
  createInitialBattleState,
  createInitialPokemonState,
  type BattleState,
} from '../../engine/state';
import { parsePokePaste } from '../pokepasteParser';
import { applyUserPokePasteToStates, matchPokePasteToSide } from '../applyUserSets';

const USER_PASTE = `
Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 14 Def / 20 SpD
Careful Nature
- Flare Blitz
- Throat Chop
- Parting Shot
- Fake Out

Kingambit @ Black Glasses
Ability: Defiant
Level: 50
EVs: 32 HP / 32 Atk / 2 SpD
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Swords Dance
- Protect
`;

function makeStateWithRoster(p1Species: string[], p2Species: string[]): BattleState {
  const base = createInitialBattleState();
  const pokemonByKey: BattleState['pokemonByKey'] = {};
  for (const species of p1Species) {
    pokemonByKey[`p1:${species}`] = createInitialPokemonState({ species, side: 'p1', level: 50 });
  }
  for (const species of p2Species) {
    pokemonByKey[`p2:${species}`] = createInitialPokemonState({ species, side: 'p2', level: 50 });
  }
  return { ...base, pokemonByKey };
}

describe('matchPokePasteToSide', () => {
  it('identifie p1 comme le côté utilisateur quand ses espèces matchent', () => {
    const state = makeStateWithRoster(
      ['Incineroar', 'Kingambit'],
      ['Garchomp', 'Rillaboom'],
    );
    const parsed = parsePokePaste(USER_PASTE);
    const result = matchPokePasteToSide([state], parsed);
    expect(result.side).toBe('p1');
    expect(result.matchedCount).toBe(2);
  });

  it('identifie p2 quand c’est l’utilisateur qui joue de ce côté-là dans ce replay', () => {
    const state = makeStateWithRoster(
      ['Garchomp', 'Rillaboom'],
      ['Incineroar', 'Kingambit'],
    );
    const parsed = parsePokePaste(USER_PASTE);
    const result = matchPokePasteToSide([state], parsed);
    expect(result.side).toBe('p2');
  });

  it('retourne side=null si aucun côté ne correspond suffisamment', () => {
    const state = makeStateWithRoster(['Garchomp'], ['Rillaboom']);
    const parsed = parsePokePaste(USER_PASTE);
    const result = matchPokePasteToSide([state], parsed);
    expect(result.side).toBeNull();
  });
});

describe('applyUserPokePasteToStates', () => {
  it('assigne userProvidedSet uniquement au côté utilisateur identifié', () => {
    const state = makeStateWithRoster(['Incineroar', 'Kingambit'], ['Garchomp', 'Rillaboom']);
    const parsed = parsePokePaste(USER_PASTE);
    const { states, match } = applyUserPokePasteToStates([state], parsed);

    expect(match.side).toBe('p1');
    expect(states[0].pokemonByKey['p1:Incineroar'].userProvidedSet).toEqual({
      ability: 'Intimidate',
      item: 'Sitrus Berry',
      nature: 'Careful',
      evs: { hp: 32, def: 14, spd: 20 },
      ivs: {},
      teraType: null,
      moves: ['Flare Blitz', 'Throat Chop', 'Parting Shot', 'Fake Out'],
    });
    expect(states[0].pokemonByKey['p1:Kingambit'].userProvidedSet?.nature).toBe('Adamant');
    // Le côté adverse ne doit jamais recevoir de userProvidedSet.
    expect(states[0].pokemonByKey['p2:Garchomp'].userProvidedSet).toBeNull();
  });

  it('ne modifie rien si aucun côté ne matche', () => {
    const state = makeStateWithRoster(['Garchomp'], ['Rillaboom']);
    const parsed = parsePokePaste(USER_PASTE);
    const { states, match } = applyUserPokePasteToStates([state], parsed);

    expect(match.side).toBeNull();
    expect(states).toBe([state][0] ? states : states); // no throw
    expect(states[0].pokemonByKey['p1:Garchomp'].userProvidedSet).toBeNull();
  });

  it('applique le set à tous les tours (BattleState[]), pas seulement le premier', () => {
    const state1 = makeStateWithRoster(['Incineroar'], ['Garchomp']);
    const state2 = makeStateWithRoster(['Incineroar'], ['Garchomp']);
    const parsed = parsePokePaste(USER_PASTE);
    const { states } = applyUserPokePasteToStates([state1, state2], parsed);

    expect(states[0].pokemonByKey['p1:Incineroar'].userProvidedSet?.ability).toBe('Intimidate');
    expect(states[1].pokemonByKey['p1:Incineroar'].userProvidedSet?.ability).toBe('Intimidate');
  });
});
