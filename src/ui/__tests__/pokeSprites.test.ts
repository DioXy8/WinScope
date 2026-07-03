import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpriteCandidateSlugs } from '../pokeSprites';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', mock);
  return mock;
}

describe('getSpriteCandidateSlugs', () => {
  it('utilise le slug de l’espèce de base pour un Pokémon non-Mega', () => {
    expect(getSpriteCandidateSlugs('Incineroar', false, null)).toEqual(['incineroar']);
  });

  it('essaie d’abord le slug Mega puis retombe sur l’espèce de base', () => {
    expect(getSpriteCandidateSlugs('Swampert', true, 'Mega Swampert')).toEqual([
      'swampert-mega',
      'swampert',
    ]);
  });

  it('gère les variantes X/Y de Mega (ex: Charizard)', () => {
    expect(getSpriteCandidateSlugs('Charizard', true, 'Mega Charizard X')).toEqual([
      'charizard-mega-x',
      'charizard',
    ]);
  });

  it('applique les overrides pour les noms avec apostrophe/point', () => {
    expect(getSpriteCandidateSlugs("Farfetch'd", false, null)).toEqual(['farfetchd']);
    expect(getSpriteCandidateSlugs('Mr. Mime', false, null)).toEqual(['mr-mime']);
  });

  it('applique l’override Urshifu-Rapid-Strike (suffixe -style requis par PokeAPI)', () => {
    expect(getSpriteCandidateSlugs('Urshifu-Rapid-Strike', false, null)).toEqual([
      'urshifu-rapid-strike-style',
    ]);
  });

  it('normalise génériquement les noms à tirets déjà showdown-compatibles', () => {
    expect(getSpriteCandidateSlugs('Floette-Eternal', false, null)).toEqual(['floette-eternal']);
  });
});

describe('resolveSpriteUrl', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  it('retourne l’URL official-artwork quand PokeAPI répond', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sprites: { other: { 'official-artwork': { front_default: 'https://example.com/incineroar.png' } } },
        }),
      }),
    );
    const { resolveSpriteUrl } = await import('../pokeSprites');
    const url = await resolveSpriteUrl('Incineroar', false, null);
    expect(url).toBe('https://example.com/incineroar.png');
  });

  it('retombe sur l’espèce de base quand la forme Mega renvoie 404 (Mega fictive de Champions)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('floette-mega') || url.includes('floette-eternal-mega')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ sprites: { other: { 'official-artwork': { front_default: 'https://example.com/floette.png' } } } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveSpriteUrl } = await import('../pokeSprites');
    const url = await resolveSpriteUrl('Floette-Eternal', true, 'Mega Floette');
    expect(url).toBe('https://example.com/floette.png');
  });

  it('retourne null quand rien n’est trouvé (espèce et mega introuvables)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { resolveSpriteUrl } = await import('../pokeSprites');
    const url = await resolveSpriteUrl('Definitely Not A Pokemon', false, null);
    expect(url).toBeNull();
  });
});
