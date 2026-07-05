import { describe, expect, it } from 'vitest';
import { parsePokePaste, toPartialPokemonSet } from '../pokepasteParser';

const DIOXY_TEAM = `
Delphox-Mega @ Delphoxite
Ability: Levitate
Level: 50
EVs: 11 HP / 5 Def / 18 SpA / 32 Spe
Timid Nature
- Heat Wave
- Psyshock
- Nasty Plot
- Protect

Sneasler @ Focus Sash
Ability: Poison Touch
EVs: 32 Atk / 2 Def / 32 Spe
Jolly Nature
- Dire Claw
- Close Combat
- Fake Out
- Quick Guard

Sinistcha @ Occa Berry
Ability: Hospitality
EVs: 31 HP / 19 Def / 16 SpD
Bold Nature
- Matcha Gotcha
- Rage Powder
- Trick Room
- Protect

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 14 Def / 20 SpD
Careful Nature
- Flare Blitz
- Throat Chop
- Parting Shot
- Fake Out

Floette-Mega (F) @ Floettite
Ability: Fairy Aura
Level: 50
EVs: 10 HP / 24 Def / 15 SpA / 17 Spe
Modest Nature
- Moonblast
- Dazzling Gleam
- Calm Mind
- Protect

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

describe('parsePokePaste', () => {
  it('parses les 6 Pokémon du paste', () => {
    const result = parsePokePaste(DIOXY_TEAM);
    expect(result).toHaveLength(6);
    expect(result.map((p) => p.species)).toEqual([
      'Delphox',
      'Sneasler',
      'Sinistcha',
      'Incineroar',
      'Floette-Eternal',
      'Kingambit',
    ]);
  });

  it('normalise "Delphox-Mega" vers l’espèce de base + flag mega', () => {
    const [delphox] = parsePokePaste(DIOXY_TEAM);
    expect(delphox.species).toBe('Delphox');
    expect(delphox.isMegaInPaste).toBe(true);
    expect(delphox.megaVariant).toBeNull();
    expect(delphox.item).toBe('Delphoxite');
  });

  it('gère "(Genre)" séparément d’un surnom, pour Floette-Mega (F), et applique l’alias Floette-Eternal', () => {
    const floette = parsePokePaste(DIOXY_TEAM).find((p) => p.species === 'Floette-Eternal');
    expect(floette).toBeDefined();
    expect(floette?.nickname).toBeNull();
    expect(floette?.gender).toBe('F');
    expect(floette?.isMegaInPaste).toBe(true);
    expect(floette?.item).toBe('Floettite');
  });

  it('parse ability/level/nature/item correctement', () => {
    const kingambit = parsePokePaste(DIOXY_TEAM).find((p) => p.species === 'Kingambit')!;
    expect(kingambit.ability).toBe('Defiant');
    expect(kingambit.level).toBe(50);
    expect(kingambit.nature).toBe('Adamant');
    expect(kingambit.item).toBe('Black Glasses');
  });

  it('parse les EVs avec les bonnes clés de stat', () => {
    const sinistcha = parsePokePaste(DIOXY_TEAM).find((p) => p.species === 'Sinistcha')!;
    expect(sinistcha.evs).toEqual({ hp: 31, def: 19, spd: 16 });
  });

  it('parse les 4 moves dans l’ordre', () => {
    const sneasler = parsePokePaste(DIOXY_TEAM).find((p) => p.species === 'Sneasler')!;
    expect(sneasler.moves).toEqual(['Dire Claw', 'Close Combat', 'Fake Out', 'Quick Guard']);
  });

  it('Incineroar sans Level explicite retombe sur le défaut 100', () => {
    const incineroar = parsePokePaste(DIOXY_TEAM).find((p) => p.species === 'Incineroar')!;
    expect(incineroar.level).toBe(100);
  });

  it('ignore les blocs vides superflus (lignes vides en trop)', () => {
    const withExtraBlankLines = DIOXY_TEAM.replace(/\n\n/g, '\n\n\n\n');
    expect(parsePokePaste(withExtraBlankLines)).toHaveLength(6);
  });

  it('applique l’alias Floette -> Floette-Eternal même sans Mega (raccourci communautaire)', () => {
    const [floette] = parsePokePaste('Floette @ Leftovers\nAbility: Fairy Aura\n- Moonblast');
    expect(floette.species).toBe('Floette-Eternal');
    expect(floette.isMegaInPaste).toBe(false);
  });

  it('traduit un nom d’espèce français vers l’anglais (ex: Tortank -> Blastoise)', () => {
    const [blastoise] = parsePokePaste('Tortank-Mega @ Blastoisinite\nAbility: Torrent\n- Hydro Pump');
    expect(blastoise.species).toBe('Blastoise');
    expect(blastoise.isMegaInPaste).toBe(true);
  });

  it('traduit sans tenir compte des accents ni de la casse (ex: "ptera" -> Aerodactyl)', () => {
    const [aerodactyl] = parsePokePaste('ptera @ Choice Band\nAbility: Rock Head\n- Rock Slide');
    expect(aerodactyl.species).toBe('Aerodactyl');
  });

  it('traduit un nom français composé (ex: Tyranocif -> Tyranitar)', () => {
    const [tyranitar] = parsePokePaste('Tyranocif @ Assault Vest\nAbility: Sand Stream\n- Rock Slide');
    expect(tyranitar.species).toBe('Tyranitar');
  });

  it('laisse un nom déjà anglais inchangé (pas de fausse traduction)', () => {
    const [incineroar] = parsePokePaste('Incineroar @ Sitrus Berry\nAbility: Intimidate\n- Flare Blitz');
    expect(incineroar.species).toBe('Incineroar');
  });
});

describe('toPartialPokemonSet', () => {
  it('convertit un ParsedPokePasteSet en PartialPokemonSet exploitable par adapter.ts', () => {
    const [delphox] = parsePokePaste(DIOXY_TEAM);
    expect(toPartialPokemonSet(delphox)).toEqual({
      ability: 'Levitate',
      item: 'Delphoxite',
      nature: 'Timid',
      evs: { hp: 11, def: 5, spa: 18, spe: 32 },
      ivs: {},
      teraType: null,
      moves: ['Heat Wave', 'Psyshock', 'Nasty Plot', 'Protect'],
    });
  });
});
