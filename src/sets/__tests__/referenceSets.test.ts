import { describe, expect, it } from 'vitest';
import { getReferenceSets, pickBestReferenceSet, referenceSetToPartialPokemonSet } from '../referenceSets';

describe('referenceSets', () => {
  it('retourne un tableau vide pour une espèce sans set catalogué', () => {
    expect(getReferenceSets('Definitely Not A Real Pokemon')).toEqual([]);
  });

  it('retourne les sets catalogués pour Incineroar avec les bons champs', () => {
    const sets = getReferenceSets('Incineroar');
    expect(sets.length).toBeGreaterThan(0);
    const balanced = sets.find((s) => s.setName === 'Balanced Bulk Sitrus');
    expect(balanced).toBeDefined();
    expect(balanced?.nature).toBe('Careful');
    expect(balanced?.item).toBe('Sitrus Berry');
    expect(balanced?.evs).toEqual({ hp: 32, atk: 0, def: 14, spa: 0, spd: 20, spe: 0 });
    expect(balanced?.moves).toContain('Flare Blitz');
  });

  it('catalogue bien Floette-Eternal avec ses 2 sets Mega (clé espèce de base)', () => {
    const sets = getReferenceSets('Floette-Eternal');
    expect(sets.map((s) => s.setName).sort()).toEqual(['Calm Mind Mega Sweeper', 'Max Speed Mega Attacker']);
    expect(sets.every((s) => s.item === 'Floettite')).toBe(true);
  });

  it('pickBestReferenceSet retombe sur le premier set si aucun move n’est révélé', () => {
    const picked = pickBestReferenceSet('Kingambit', []);
    expect(picked).not.toBeNull();
  });

  it('pickBestReferenceSet privilégie le set dont les moves recoupent le plus les moves révélés', () => {
    // Kingambit a 2 sets : "Black Glasses Offense" (Kowtow Cleave/Iron Head/Sucker Punch/Low Kick)
    // et "Speedy Sash" (mêmes moves, item différent) — on teste plutôt sur
    // Floette-Eternal où les deux sets ont des movepools bien distincts.
    const picked = pickBestReferenceSet('Floette-Eternal', ['Calm Mind', 'Draining Kiss']);
    expect(picked?.setName).toBe('Calm Mind Mega Sweeper');

    const pickedOther = pickBestReferenceSet('Floette-Eternal', ['Light of Ruin']);
    expect(pickedOther?.setName).toBe('Max Speed Mega Attacker');
  });

  it('pickBestReferenceSet retourne null pour une espèce sans set', () => {
    expect(pickBestReferenceSet('Definitely Not A Real Pokemon', ['Tackle'])).toBeNull();
  });

  it('referenceSetToPartialPokemonSet produit un PartialPokemonSet exploitable par adapter.ts', () => {
    const [set] = getReferenceSets('Kingambit');
    const partial = referenceSetToPartialPokemonSet(set);
    expect(partial).toEqual({
      ability: set.ability,
      item: set.item,
      nature: set.nature,
      evs: set.evs,
      ivs: {},
      teraType: null,
    });
  });
});
