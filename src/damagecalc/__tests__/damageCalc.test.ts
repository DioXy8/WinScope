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
          evs: { atk: 32, spe: 2 },
          ivs: {},
          teraType: null,
          moves: [],
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
          evs: { atk: 32 },
          ivs: {},
          teraType: null,
          moves: [],
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

describe('malus de dégâts spread (-25%) — cf. calcGeneralMods du moteur vendor', () => {
  /**
   * Construit un battle en double avec 1 attaquant p1a et jusqu'à 2
   * opposants (p2a toujours vivant, p2b vivant ou K.O. selon le test).
   */
  function setupSpreadBattle(p2bFainted: boolean) {
    let battle = createInitialBattleState();
    const swampert = {
      ...createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      hasBeenSentOut: true,
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Adamant',
        evs: { atk: 32 },
        ivs: {},
        teraType: null,
        moves: ['Earthquake'],
      },
    };
    const sinistcha = {
      ...createInitialPokemonState({ species: 'Sinistcha', side: 'p2', level: 50 }),
      position: 'p2a' as const,
      hasBeenSentOut: true,
    };
    const floette = {
      ...createInitialPokemonState({ species: 'Floette-Eternal', side: 'p2', level: 50 }),
      position: (p2bFainted ? null : 'p2b') as 'p2b' | null,
      hasBeenSentOut: true,
      fainted: p2bFainted,
    };
    battle = {
      ...battle,
      pokemonByKey: { 'p1:Swampert': swampert, 'p2:Sinistcha': sinistcha, 'p2:Floette-Eternal': floette },
      activeByPosition: p2bFainted
        ? { p1a: 'p1:Swampert', p2a: 'p2:Sinistcha' }
        : { p1a: 'p1:Swampert', p2a: 'p2:Sinistcha', p2b: 'p2:Floette-Eternal' },
    };
    return { battle, swampert, sinistcha };
  }

  it('applique le malus -25% quand un move spread touche 2 adversaires réellement vivants', () => {
    const { battle, swampert, sinistcha } = setupSpreadBattle(false);
    const withMalus = calculateDamage(swampert, sinistcha, 'Earthquake', battle, 'p1');

    const { battle: singleBattle } = setupSpreadBattle(true);
    const withoutMalus = calculateDamage(swampert, sinistcha, 'Earthquake', singleBattle, 'p1');

    // ~0.75x : dégâts avec malus strictement inférieurs à sans malus.
    expect(withMalus.maxDamage).toBeLessThan(withoutMalus.maxDamage);
    expect(withMalus.maxDamage / withoutMalus.maxDamage).toBeCloseTo(0.75, 1);
  });

  it('NE réduit PAS les dégâts d’un move spread quand un seul adversaire reste vivant sur le terrain', () => {
    // Régression : le moteur vendor applique le malus dès que le move est
    // "isSpread" et le format "Doubles", SANS regarder si un deuxième
    // adversaire est réellement présent. On corrige ça dans damageCalc.ts.
    const { battle, swampert, sinistcha } = setupSpreadBattle(true);
    const result = calculateDamage(swampert, sinistcha, 'Earthquake', battle, 'p1');

    const { battle: fullBattle } = setupSpreadBattle(false);
    const reduced = calculateDamage(swampert, sinistcha, 'Earthquake', fullBattle, 'p1');

    expect(result.maxDamage).toBeGreaterThan(reduced.maxDamage);
  });

  it('ne touche pas les moves non-spread (Flare Blitz) même en double avec 2 adversaires vivants', () => {
    const { battle } = setupSpreadBattle(false);
    const incineroar = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      position: 'p1a' as const,
      hasBeenSentOut: true,
    };
    const target = battle.pokemonByKey['p2:Sinistcha'];

    const withTwoTargets = calculateDamage(incineroar, target, 'Flare Blitz', battle, 'p1');
    const { battle: singleBattle } = setupSpreadBattle(true);
    const withOneTarget = calculateDamage(incineroar, singleBattle.pokemonByKey['p2:Sinistcha'], 'Flare Blitz', singleBattle, 'p1');

    expect(withTwoTargets.maxDamage).toBe(withOneTarget.maxDamage);
  });
});
