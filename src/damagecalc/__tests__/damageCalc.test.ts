import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { calculateDamage, DexLookupError } from '../damageCalc';
import type { PokemonState } from '../../engine/state';

function withRevealed(p: PokemonState, overrides: Partial<PokemonState>): PokemonState {
  return { ...p, ...overrides };
}

describe('calculateDamage', () => {
  it('computes plausible damage for Incineroar Fake Out into Garchomp', () => {
    const battle = createInitialBattleState();
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      { revealedAbility: 'Intimidate', revealedItem: 'Safety Goggles' },
    );
    const garchomp = withRevealed(
      createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
      { revealedAbility: 'Rough Skin', revealedItem: 'Leftovers', maxHp: 190, currentHp: 190, hpIsPercentage: false },
    );

    const result = calculateDamage(incineroar, garchomp, 'Fake Out', battle, 'p1');

    expect(result.rolls.length).toBeGreaterThan(0);
    expect(result.minDamage).toBeGreaterThan(0);
    expect(result.maxDamage).toBeGreaterThanOrEqual(result.minDamage);
    expect(result.maxPercent).toBeLessThan(100);
  });

  it('computes a near-OHKO for Mega Garchomp Earthquake into Incineroar', () => {
    const battle = createInitialBattleState();
    const megaGarchomp = withRevealed(
      createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      {
        isMegaEvolved: true,
        megaStone: 'Garchompite',
        megaForme: 'Mega Garchomp',
        revealedAbility: 'Sand Force',
        revealedItem: 'Garchompite',
        userProvidedSet: {
          ability: null,
          item: null,
          nature: 'Adamant',
          evs: { atk: 252, spe: 4 },
          ivs: {},
          teraType: null,
        },
      },
    );
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      { revealedAbility: 'Intimidate', maxHp: 190, currentHp: 190, hpIsPercentage: false },
    );

    const result = calculateDamage(megaGarchomp, incineroar, 'Earthquake', battle, 'p1');

    expect(result.maxPercent).toBeGreaterThan(80);
  });

  it('throws DexLookupError for a pokemon not in the Champions dex', () => {
    const battle = createInitialBattleState();
    const notInChampions = createInitialPokemonState({ species: 'Definitely Not A Real Mon', side: 'p1', level: 50 });
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 });

    expect(() => calculateDamage(notInChampions, incineroar, 'Tackle', battle, 'p1')).toThrow(DexLookupError);
  });

  it('throws DexLookupError for a move not in the Champions move list', () => {
    const battle = createInitialBattleState();
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 });
    const garchomp = createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 });

    expect(() =>
      calculateDamage(incineroar, garchomp, 'Definitely Not A Real Move', battle, 'p1'),
    ).toThrow(DexLookupError);
  });

  it('accounts for active weather (sun boosting fire moves)', () => {
    let battle = createInitialBattleState();
    battle = { ...battle, field: { ...battle.field, weather: 'sun', weatherTurnsLeft: 5 } };

    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 });
    const garchomp = withRevealed(
      createInitialPokemonState({ species: 'Garchomp', side: 'p2', level: 50 }),
      { maxHp: 190, currentHp: 190, hpIsPercentage: false },
    );

    const noWeather = calculateDamage(
      incineroar,
      garchomp,
      'Flamethrower',
      createInitialBattleState(),
      'p1',
    );
    const withSun = calculateDamage(incineroar, garchomp, 'Flamethrower', battle, 'p1');

    expect(withSun.maxDamage).toBeGreaterThan(noWeather.maxDamage);
  });

  it('increases attacker damage output as the attack boost stage increases (regression: stats vs rawStats mixup)', () => {
    const battle = createInitialBattleState();
    const garchomp = withRevealed(
      createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 }),
      {
        userProvidedSet: {
          ability: null,
          item: null,
          nature: 'Adamant',
          evs: { atk: 252 },
          ivs: {},
          teraType: null,
        },
      },
    );
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      { maxHp: 190, currentHp: 190, hpIsPercentage: false },
    );

    const noBoost = calculateDamage(garchomp, incineroar, 'Earthquake', battle, 'p1');
    const plusOne = calculateDamage(
      { ...garchomp, boosts: { ...garchomp.boosts, atk: 1 } },
      incineroar,
      'Earthquake',
      battle,
      'p1',
    );
    const plusTwo = calculateDamage(
      { ...garchomp, boosts: { ...garchomp.boosts, atk: 2 } },
      incineroar,
      'Earthquake',
      battle,
      'p1',
    );

    expect(plusOne.maxDamage).toBeGreaterThan(noBoost.maxDamage);
    expect(plusTwo.maxDamage).toBeGreaterThan(plusOne.maxDamage);
  });

  it('increases defender bulk (reduces damage taken) as the defense boost stage increases', () => {
    const battle = createInitialBattleState();
    const garchomp = createInitialPokemonState({ species: 'Garchomp', side: 'p1', level: 50 });
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      { maxHp: 190, currentHp: 190, hpIsPercentage: false },
    );

    const noBoost = calculateDamage(garchomp, incineroar, 'Earthquake', battle, 'p1');
    const defenderPlusOne = calculateDamage(
      garchomp,
      { ...incineroar, boosts: { ...incineroar.boosts, def: 1 } },
      'Earthquake',
      battle,
      'p1',
    );

    expect(defenderPlusOne.maxDamage).toBeLessThan(noBoost.maxDamage);
  });
});
