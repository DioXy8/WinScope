import { describe, expect, it } from 'vitest';
import { createInitialBattleState, createInitialPokemonState } from '../../engine/state';
import { estimateWinProbability } from '../evaluator';

describe('estimateWinProbability', () => {
  it('returns 50 for two full-HP, identical sides', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 100 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(50);
  });

  it('favors the side with more remaining HP', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 20 },
      },
    };
    expect(estimateWinProbability(battle)).toBeGreaterThan(50);
  });

  it('returns 99 when the opposing side has no pokemon left', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), fainted: true, currentHp: 0 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(100);
  });

  it('returns 1 when our side has no pokemon left', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), fainted: true, currentHp: 0 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 100 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(0);
  });

  it('never returns exactly 0 or 100 while pokemon remain on both sides', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 100 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 1 },
      },
    };
    const result = estimateWinProbability(battle);
    expect(result).toBeLessThanOrEqual(99);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('pénalise fortement un dernier Pokémon isolé face à 2 adversaires pleine forme (désavantage structurel du double)', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Klefki': {
          ...createInitialPokemonState({ species: 'Klefki', side: 'p1', level: 50 }),
          maxHp: 100,
          currentHp: 30,
        },
        'p2:Floette': {
          ...createInitialPokemonState({ species: 'Floette-Eternal', side: 'p2', level: 50 }),
          maxHp: 100,
          currentHp: 90,
        },
        'p2:Sinistcha': {
          ...createInitialPokemonState({ species: 'Sinistcha', side: 'p2', level: 50 }),
          maxHp: 100,
          currentHp: 95,
        },
      },
    };
    const result = estimateWinProbability(battle);
    // Avant le correctif (poids additif seul) ce genre de situation ressortait
    // autour de 30% ; avec la pénalité structurelle, nettement plus bas.
    expect(result).toBeLessThan(25);
  });

  it('n’applique PAS la pénalité isolé quand les deux camps sont à 1 Pokémon vivant chacun (pas d’asymétrie réelle)', () => {
    let battle = createInitialBattleState();
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:A': { ...createInitialPokemonState({ species: 'A', side: 'p1', level: 50 }), maxHp: 100, currentHp: 50 },
        'p2:B': { ...createInitialPokemonState({ species: 'B', side: 'p2', level: 50 }), maxHp: 100, currentHp: 50 },
      },
    };
    expect(estimateWinProbability(battle)).toBe(50);
  });

  it('valorise significativement un gros boost type Shell Smash (+2/+2/+2, -1/-1) par rapport à un Pokémon neutre de même %HP', () => {
    // Régression : avant le correctif, le facteur de boost était plafonné à
    // ±50% avec un poids de 0.04/palier — un Shell Smash (somme nette +4)
    // n'apportait que +16%, largement sous-évalué face à l'impact réel
    // d'un tel boost (dégâts ~doublés, joue quasi toujours en premier).
    let battle = createInitialBattleState();
    const boosted = {
      ...createInitialPokemonState({ species: 'Blastoise', side: 'p1', level: 50 }),
      maxHp: 100,
      currentHp: 100,
      boosts: { atk: 2, def: -1, spa: 2, spd: -1, spe: 2 },
    };
    const neutral = {
      ...createInitialPokemonState({ species: 'Blastoise', side: 'p1', level: 50 }),
      maxHp: 100,
      currentHp: 100,
    };
    const opponent = {
      ...createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      maxHp: 100,
      currentHp: 100,
    };

    const withBoost = estimateWinProbability({
      ...battle,
      pokemonByKey: { 'p1:Blastoise': boosted, 'p2:Incineroar': opponent },
    });
    const withoutBoost = estimateWinProbability({
      ...battle,
      pokemonByKey: { 'p1:Blastoise': neutral, 'p2:Incineroar': { ...opponent } },
    });

    expect(withBoost).toBeGreaterThan(withoutBoost);
    // Le boost à lui seul (sans différence d'alive count ni de %HP) doit
    // suffire à sortir du 50/50 de façon notable, pas juste +1 ou +2 points.
    expect(withBoost - withoutBoost).toBeGreaterThanOrEqual(5);
  });

  it('does not let never-sent-out Team Preview ghosts (Reg M-B) drag a decisive sweep back to 50/50', () => {
    let battle = createInitialBattleState();
    const mk = (species: string, side: 'p1' | 'p2', hp: number, sentOut: boolean, fainted = false) => ({
      ...createInitialPokemonState({ species, side, level: 50 }),
      maxHp: 100,
      currentHp: hp,
      hasBeenSentOut: sentOut,
      fainted,
    });
    battle = {
      ...battle,
      pokemonByKey: {
        'p1:Blastoise': mk('Blastoise', 'p1', 100, true),
        'p1:Incineroar': mk('Incineroar', 'p1', 100, true),
        // p2 a entièrement perdu ses 2 Pokémon CONFIRMÉS (déjà envoyés) ce tour,
        // sans que p1 encaisse le moindre dégât. p2 a 4 entrées Team Preview
        // jamais envoyées : au plus 2 sont réelles (Reg M-B, bring-4), les 2
        // autres sont des fantômes garantis — impossible de savoir lesquelles.
        'p2:Farigiraf': mk('Farigiraf', 'p2', 0, true, true),
        'p2:Incineroar': mk('Incineroar', 'p2', 0, true, true),
        'p2:Weavile': mk('Weavile', 'p2', 100, false),
        'p2:Mawile': mk('Mawile', 'p2', 100, false),
        'p2:Whimsicott': mk('Whimsicott', 'p2', 100, false),
        'p2:Tyranitar': mk('Tyranitar', 'p2', 100, false),
      },
    };
    const result = estimateWinProbability(battle);
    // Avant le correctif, ce genre de tour ressortait à ~50/50 (les 4
    // fantômes de Team Preview comptaient comme pleinement vivants). Balayer
    // tout le board confirmé adverse sans dommage doit rester nettement
    // favorable, même si p2 a en théorie ~2 réserves inconnues restantes.
    expect(result).toBeGreaterThan(55);
  });
});
