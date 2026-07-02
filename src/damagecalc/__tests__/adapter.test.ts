import { describe, expect, it } from 'vitest';
import { createInitialPokemonState } from '../../engine/state';
import type { PokemonState } from '../../engine/state';
import { buildVendorPokemon } from '../adapter';

function withRevealed(p: PokemonState, overrides: Partial<PokemonState>): PokemonState {
  return { ...p, ...overrides };
}

/**
 * Ces tests verrouillent la VRAIE formule de Pokémon Champions
 * (stat_data.js::CALC_HP_CHAMP / CALC_STAT_CHAMP du NCP VGC Damage
 * Calculator), pas la formule classique des jeux principaux. Régression
 * corrigée le 02/07 : computeRawStats traitait les "EVs" du PokéPaste comme
 * des EVs classiques 0-252 (floor(ev/4)) alors que ce sont des Stat Points
 * 0-32 ajoutés DIRECTEMENT au stat, avec IVs fixées à 31 et niveau fixé à
 * 50 (constantes du jeu, jamais variables).
 */
describe('buildVendorPokemon — formule de stats Pokémon Champions', () => {
  it('calcule HP = floor((base*2+31)*50/100) + 50 + 10 + statPoints (Sinistcha, 31 HP points)', () => {
    // Sinistcha base HP = 71. Set réel de l'utilisateur : 31 HP / 19 Def / 16 SpD, Bold.
    const sinistcha = withRevealed(createInitialPokemonState({ species: 'Sinistcha', side: 'p1', level: 50 }), {
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Bold',
        evs: { hp: 31, def: 19, spd: 16 },
        ivs: {},
        teraType: null,
      },
    });

    const vendor = buildVendorPokemon(sinistcha);

    // floor((71*2+31)*50/100) + 50 + 10 + 31 = floor(86.5) + 91 = 86 + 91 = 177
    expect(vendor.rawStats.hp).toBe(177);
  });

  it('calcule Def avec le bonus de nature APRÈS l’ajout des Stat Points (Sinistcha Bold, 19 Def points)', () => {
    const sinistcha = withRevealed(createInitialPokemonState({ species: 'Sinistcha', side: 'p1', level: 50 }), {
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Bold',
        evs: { hp: 31, def: 19, spd: 16 },
        ivs: {},
        teraType: null,
      },
    });

    const vendor = buildVendorPokemon(sinistcha);

    // Sinistcha base Def = 106.
    // floor((106*2+31)*50/100) + 5 + 19 = floor(121.5) + 24 = 121 + 24 = 145
    // Bold booste Def : floor(145 * 1.1) = floor(159.5) = 159
    expect(vendor.rawStats.df).toBe(159);
  });

  it('n’applique jamais la nature aux HP', () => {
    const kingambit = withRevealed(createInitialPokemonState({ species: 'Kingambit', side: 'p1', level: 50 }), {
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Adamant', // n'affecte ni HP ni Atk (Adamant = +Atk/-SpA, ici on vérifie juste HP)
        evs: { hp: 32, atk: 32 },
        ivs: {},
        teraType: null,
      },
    });

    const vendor = buildVendorPokemon(kingambit);
    // Kingambit base HP = 100. floor((100*2+31)*50/100) + 50 + 10 + 32 = floor(115.5) + 92 = 115 + 92 = 207
    expect(vendor.rawStats.hp).toBe(207);
  });

  it('sans set fourni (0 Stat Points partout), retombe sur le stat de base neutre', () => {
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 });
    const vendor = buildVendorPokemon(incineroar);

    // Incineroar base Atk = 115, nature neutre (Hardy par défaut), 0 Stat Points.
    // floor((115*2+31)*50/100) + 5 + 0 = floor(130.5) + 5 = 130 + 5 = 135
    expect(vendor.rawStats.at).toBe(135);
  });

  it('fixe toujours les IVs à 31, quel que soit le set fourni (pas de génétique individuelle en Champions)', () => {
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 });
    const vendor = buildVendorPokemon(incineroar);

    expect(vendor.ivs).toEqual({ hp: 31, at: 31, df: 31, sa: 31, sd: 31, sp: 31 });
  });
});
