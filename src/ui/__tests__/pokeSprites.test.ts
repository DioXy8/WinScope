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

describe('chemin rapide statique (espèces de base connues, sans appel réseau)', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  it('résout une espèce de base directement en URL statique GitHub, SANS appeler fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { resolveSpriteUrl } = await import('../pokeSprites');

    const url = await resolveSpriteUrl('Incineroar', false, null);
    expect(url).toBe(
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/727.png',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('résout aussi la paire face/dos statique pour la scène de combat, sans appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { resolveBattleSprites } = await import('../pokeSprites');

    const sprites = await resolveBattleSprites('Incineroar', false, null);
    expect(sprites).toEqual({
      front: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/727.png',
      back: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/727.png',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('n’utilise PAS le chemin statique pour une Mega (même si l’espèce de base a un ID connu) : passe par l’API REST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sprites: { other: { 'official-artwork': { front_default: 'https://example.com/mega-incineroar.png' } } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveSpriteUrl } = await import('../pokeSprites');

    const url = await resolveSpriteUrl('Incineroar', true, 'Mega Incineroar');
    expect(url).toBe('https://example.com/mega-incineroar.png');
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('resolveSpriteCandidates (liste de secours en cascade)', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  it('retourne [officialArtwork, front] pour une espèce de base (chemin statique)', async () => {
    const { resolveSpriteCandidates } = await import('../pokeSprites');
    const candidates = await resolveSpriteCandidates('Incineroar', false, null);
    expect(candidates).toEqual([
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/727.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/727.png',
    ]);
  });

  it('resolveSpriteUrl reste rétro-compatible : retourne juste le premier candidat', async () => {
    const { resolveSpriteUrl } = await import('../pokeSprites');
    const url = await resolveSpriteUrl('Incineroar', false, null);
    expect(url).toBe(
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/727.png',
    );
  });

  it('retourne une liste avec seulement l’URL disponible si l’API REST ne renvoie qu’une des deux (cas Mega)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sprites: { front_default: 'https://example.com/mega-front.png', other: {} },
        }),
      }),
    );
    const { resolveSpriteCandidates } = await import('../pokeSprites');
    const candidates = await resolveSpriteCandidates('Swampert', true, 'Mega Swampert');
    expect(candidates).toEqual(['https://example.com/mega-front.png']);
  });

  it('retourne un tableau vide si rien n’est trouvé du tout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { resolveSpriteCandidates } = await import('../pokeSprites');
    const candidates = await resolveSpriteCandidates('Definitely Not A Pokemon', false, null);
    expect(candidates).toEqual([]);
  });
});

describe('resolveSpriteUrl (repli API REST — Mega ou formes absentes de la table statique)', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  it('retourne l’URL official-artwork quand PokeAPI répond (cas Mega)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sprites: { other: { 'official-artwork': { front_default: 'https://example.com/mega-swampert.png' } } },
        }),
      }),
    );
    const { resolveSpriteUrl } = await import('../pokeSprites');
    const url = await resolveSpriteUrl('Swampert', true, 'Mega Swampert');
    expect(url).toBe('https://example.com/mega-swampert.png');
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

  it('ne met PAS en cache un échec transitoire (rate limit 429) : un appel suivant retente au lieu de rester bloqué', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      // Les 2 premiers appels (slug Mega puis slug de base, dans la même
      // résolution) échouent tous les deux façon rate-limit ; à partir du
      // 3e appel (deuxième résolution complète), ça réussit.
      if (callCount <= 2) {
        return Promise.resolve({ ok: false, status: 429 });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          sprites: { other: { 'official-artwork': { front_default: 'https://example.com/mega-swampert.png' } } },
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveSpriteUrl } = await import('../pokeSprites');

    const firstAttempt = await resolveSpriteUrl('Swampert', true, 'Mega Swampert');
    expect(firstAttempt).toBeNull(); // rate-limité sur les 2 slugs essayés

    const secondAttempt = await resolveSpriteUrl('Swampert', true, 'Mega Swampert');
    expect(secondAttempt).toBe('https://example.com/mega-swampert.png'); // retente avec succès, pas bloqué par un faux cache
  });

  it('met en cache durablement un 404 confirmé (contrairement à un échec transitoire)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveSpriteUrl } = await import('../pokeSprites');

    await resolveSpriteUrl('Definitely Not A Pokemon', false, null);
    await resolveSpriteUrl('Definitely Not A Pokemon', false, null);
    // Un vrai 404 est mis en cache : un seul appel réseau pour les deux résolutions.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBattleSprites (repli API REST — Mega ou formes absentes de la table statique)', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  it('retourne les sprites in-game face ET dos (pas l’illustration officielle, qui n’a pas de dos) — cas Mega', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sprites: {
            front_default: 'https://example.com/mega-swampert-front.png',
            back_default: 'https://example.com/mega-swampert-back.png',
            other: { 'official-artwork': { front_default: 'https://example.com/mega-swampert-art.png' } },
          },
        }),
      }),
    );
    const { resolveBattleSprites } = await import('../pokeSprites');
    const sprites = await resolveBattleSprites('Swampert', true, 'Mega Swampert');
    expect(sprites).toEqual({
      front: 'https://example.com/mega-swampert-front.png',
      back: 'https://example.com/mega-swampert-back.png',
    });
  });

  it('retombe sur l’espèce de base si la forme Mega n’a pas de sprites (Mega fictive de Champions)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('floette-mega') || url.includes('floette-eternal-mega')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          sprites: { front_default: 'https://example.com/floette-front.png', back_default: 'https://example.com/floette-back.png' },
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveBattleSprites } = await import('../pokeSprites');
    const sprites = await resolveBattleSprites('Floette-Eternal', true, 'Mega Floette');
    expect(sprites.front).toBe('https://example.com/floette-front.png');
  });

  it('retourne { front: null, back: null } si rien n’est trouvé', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { resolveBattleSprites } = await import('../pokeSprites');
    const sprites = await resolveBattleSprites('Definitely Not A Pokemon', false, null);
    expect(sprites).toEqual({ front: null, back: null });
  });
});
