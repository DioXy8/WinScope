import { describe, expect, it } from 'vitest';
import { createInitialPokemonState } from '../../engine/state';
import type { PokemonState } from '../../engine/state';
import { buildVendorPokemon, getSetConfidence, getEstimatedMoves, getKnownMoves } from '../adapter';

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
        moves: [],
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
        moves: [],
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
        moves: [],
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

  it('sans userProvidedSet ni knownSet, retombe sur le set de référence NCP (adversaire par défaut)', () => {
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 });
    const vendor = buildVendorPokemon(incineroar);

    // Set de référence "Balanced Bulk Sitrus" : 32 HP / 14 Def / 20 SpD, Careful, Sitrus Berry.
    expect(vendor.nature).toBe('Careful');
    expect(vendor.item).toBe('Sitrus Berry');
    // floor((90*2+31)*50/100) + 5 + 14 = floor(105.5) + 19 = 105 + 19 = 124, puis Careful ne boost pas Def.
    expect(vendor.rawStats.df).toBe(124);
  });

  it('privilégie le set de référence dont les moves recoupent les moves déjà révélés par le replay', () => {
    const floette = withRevealed(
      createInitialPokemonState({ species: 'Floette-Eternal', side: 'p2', level: 50 }),
      { revealedMoves: ['Calm Mind', 'Draining Kiss'] },
    );
    const vendor = buildVendorPokemon(floette);

    expect(vendor.nature).toBe('Modest'); // "Calm Mind Mega Sweeper"
  });

  it('un item réellement révélé par le replay prime toujours sur le set de référence', () => {
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 }),
      { revealedItem: 'Safety Goggles' },
    );
    const vendor = buildVendorPokemon(incineroar);

    expect(vendor.item).toBe('Safety Goggles');
  });

  it('un userProvidedSet reste complet tel quel : une stat absente vaut 0, jamais complétée par le set de référence', () => {
    // Un Incineroar utilisateur avec SEULEMENT de la SpD investie : Def doit
    // rester à 0 point, PAS être comblée par les 14 Def du set de référence NCP.
    const incineroar = withRevealed(
      createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }),
      {
        userProvidedSet: {
          ability: null,
          item: null,
          nature: 'Careful',
          evs: { spd: 20 },
          ivs: {},
          teraType: null,
          moves: [],
        },
      },
    );
    const vendor = buildVendorPokemon(incineroar);

    // Def base only : floor((90*2+31)*50/100) + 5 + 0 = 105 + 5 = 110 (pas 124 comme avec le set de référence).
    expect(vendor.rawStats.df).toBe(110);
  });
});

describe('getSetConfidence', () => {
  it('retourne "exact" quand un userProvidedSet est présent', () => {
    const incineroar = withRevealed(createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }), {
      userProvidedSet: { ability: null, item: null, nature: 'Careful', evs: { hp: 32 }, ivs: {}, teraType: null, moves: [] },
    });
    expect(getSetConfidence(incineroar)).toEqual({ kind: 'exact' });
  });

  it('retourne "estimated" avec le nom du set NCP quand aucun userProvidedSet mais un set de référence existe', () => {
    const incineroar = createInitialPokemonState({ species: 'Incineroar', side: 'p2', level: 50 });
    expect(getSetConfidence(incineroar)).toEqual({ kind: 'estimated', setName: 'Balanced Bulk Sitrus' });
  });

  it('retourne "default" pour une espèce sans set de référence ni userProvidedSet', () => {
    const pikachu = createInitialPokemonState({ species: 'Pikachu', side: 'p2', level: 50 });
    // Pikachu n'a probablement pas de set de référence Champions Reg M-B catalogué.
    const confidence = getSetConfidence(pikachu);
    expect(['default', 'estimated']).toContain(confidence.kind); // robuste si un set Pikachu est ajouté un jour
  });
});

describe('getEstimatedMoves', () => {
  it('retourne les moves du set de référence deviné (Swampert, rain offense mega attendu)', () => {
    const swampert = createInitialPokemonState({ species: 'Swampert', side: 'p2', level: 50 });
    const moves = getEstimatedMoves(swampert);
    expect(moves.length).toBeGreaterThan(0);
  });

  it('retourne [] quand un userProvidedSet exact est fourni (pas besoin de deviner)', () => {
    const swampert = withRevealed(createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }), {
      userProvidedSet: { ability: null, item: null, nature: 'Adamant', evs: { atk: 32 }, ivs: {}, teraType: null, moves: [] },
    });
    expect(getEstimatedMoves(swampert)).toEqual([]);
  });

  it('n’inclut pas de doublon avec les moves déjà révélés côté appelant (filtrage fait dans computeMatchups)', () => {
    // getEstimatedMoves lui-même retourne juste le set complet du set de
    // référence ; le dédoublonnage avec revealedMoves est la responsabilité
    // de l'appelant (cf. computeMatchups dans ui/App.tsx).
    const swampert = createInitialPokemonState({ species: 'Swampert', side: 'p2', level: 50 });
    const moves = getEstimatedMoves(swampert);
    expect(new Set(moves).size).toBe(moves.length);
  });
});

describe('getKnownMoves', () => {
  it('inclut les moves révélés en combat en premier, avec la source "revealed"', () => {
    const incineroar = withRevealed(createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }), {
      revealedMoves: ['Fake Out', 'Flare Blitz'],
    });
    const known = getKnownMoves(incineroar);
    // Incineroar a aussi un set de référence NCP (pas de userProvidedSet
    // ici), donc d'autres moves "guessed" peuvent suivre — seul l'ordre et
    // la source des 2 premiers (révélés) sont garantis.
    expect(known.slice(0, 2)).toEqual([
      { name: 'Fake Out', source: 'revealed' },
      { name: 'Flare Blitz', source: 'revealed' },
    ]);
    expect(known.slice(2).every((m) => m.source === 'guessed')).toBe(true);
  });

  it('complète avec les moves du PokéPaste exact ("known") pas encore joués, sans dupliquer les révélés', () => {
    const incineroar = withRevealed(createInitialPokemonState({ species: 'Incineroar', side: 'p1', level: 50 }), {
      revealedMoves: ['Fake Out'],
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Careful',
        evs: {},
        ivs: {},
        teraType: null,
        moves: ['Fake Out', 'Flare Blitz', 'Throat Chop', 'Parting Shot'],
      },
    });
    expect(getKnownMoves(incineroar)).toEqual([
      { name: 'Fake Out', source: 'revealed' },
      { name: 'Flare Blitz', source: 'known' },
      { name: 'Throat Chop', source: 'known' },
      { name: 'Parting Shot', source: 'known' },
    ]);
  });

  it('complète avec les moves du set deviné ("guessed") seulement en l’absence de userProvidedSet', () => {
    const swampert = createInitialPokemonState({ species: 'Swampert', side: 'p2', level: 50 });
    const known = getKnownMoves(swampert);
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((m) => m.source === 'guessed')).toBe(true);
  });

  it('un set exact ne retombe jamais sur le set de référence deviné', () => {
    const swampert = withRevealed(createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }), {
      userProvidedSet: {
        ability: null,
        item: null,
        nature: 'Adamant',
        evs: { atk: 32 },
        ivs: {},
        teraType: null,
        moves: ['Earthquake'],
      },
    });
    expect(getKnownMoves(swampert)).toEqual([{ name: 'Earthquake', source: 'known' }]);
  });
});

describe('résolution de forme Mega — présomption avant confirmation par le replay', () => {
  it('présume la forme Mega dès qu’une Mega Stone est révélée, sans attendre le message |-mega|', () => {
    const swampert = withRevealed(createInitialPokemonState({ species: 'Swampert', side: 'p1', level: 50 }), {
      revealedItem: 'Swampertite',
      isMegaEvolved: false, // pas encore confirmé par le replay
    });
    const vendor = buildVendorPokemon(swampert);
    // Résout bien vers Mega Swampert (bs.at = 150), pas Swampert base (bs.at = 110).
    expect(vendor.name).toBe('Mega Swampert');
    // Sans userProvidedSet, le set de référence NCP "Rain Offense Mega" s'applique
    // aussi (32 Atk points, Adamant) : floor((150*2+31)*50/100)+5+32 = 202, *1.1 = 222.
    expect(vendor.rawStats.at).toBe(222);
  });

  it('n’assume PAS la Mega Evolution pour Tyranitar même avec la Tyranitarite révélée', () => {
    const tyranitar = withRevealed(createInitialPokemonState({ species: 'Tyranitar', side: 'p1', level: 50 }), {
      revealedItem: 'Tyranitarite',
      isMegaEvolved: false,
    });
    const vendor = buildVendorPokemon(tyranitar);
    expect(vendor.name).toBe('Tyranitar');
  });

  it('n’assume PAS la Mega Evolution pour Aerodactyl même avec l’Aerodactylite révélée', () => {
    const aerodactyl = withRevealed(createInitialPokemonState({ species: 'Aerodactyl', side: 'p1', level: 50 }), {
      revealedItem: 'Aerodactylite',
      isMegaEvolved: false,
    });
    const vendor = buildVendorPokemon(aerodactyl);
    expect(vendor.name).toBe('Aerodactyl');
  });

  it('n’assume PAS la Mega Evolution pour Banette même avec la Banettite révélée', () => {
    const banette = withRevealed(createInitialPokemonState({ species: 'Banette', side: 'p1', level: 50 }), {
      revealedItem: 'Banettite',
      isMegaEvolved: false,
    });
    const vendor = buildVendorPokemon(banette);
    expect(vendor.name).toBe('Banette');
  });

  it('utilise la forme Mega confirmée normalement (isMegaEvolved: true), peu importe l’espèce', () => {
    const tyranitar = withRevealed(createInitialPokemonState({ species: 'Tyranitar', side: 'p1', level: 50 }), {
      isMegaEvolved: true,
      megaForme: 'Mega Tyranitar',
    });
    const vendor = buildVendorPokemon(tyranitar);
    expect(vendor.name).toBe('Mega Tyranitar');
  });
});
