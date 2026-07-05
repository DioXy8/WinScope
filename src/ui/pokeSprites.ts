/**
 * ui/pokeSprites.ts
 *
 * Résout l'URL de sprite PokeAPI pour un Pokémon, avec repli propre pour
 * les Mega Evolutions FICTIVES propres à Pokémon Champions (ex: Mega
 * Floette, Mega Garchomp, Mega Scovillain — aucune de ces formes n'existe
 * dans les jeux principaux ni donc dans PokeAPI). Dans ce cas, on retombe
 * simplement sur le sprite de l'espèce de base plutôt que de ne rien
 * afficher.
 *
 * PokeAPI n'a pas besoin d'un numéro de Pokédex : `/api/v2/pokemon/{slug}`
 * accepte directement un nom (cf. docs officielles). On appelle cette API
 * plutôt que de maintenir notre propre table espèce → sprite, et on met en
 * cache agressivement (mémoire + localStorage) comme demandé par PokeAPI
 * elle-même ("cache aggressively, the data is static").
 */

const SPRITE_CACHE_STORAGE_KEY = 'winscope_sprite_cache_v1';

interface SpriteSet {
  officialArtwork: string | null;
  front: string | null;
  back: string | null;
}

function loadPersistedCache(): Record<string, SpriteSet> {
  try {
    const raw = localStorage.getItem(SPRITE_CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistCacheEntry(slug: string, spriteSet: SpriteSet): void {
  try {
    const cache = loadPersistedCache();
    cache[slug] = spriteSet;
    localStorage.setItem(SPRITE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persistance, le cache mémoire de la session suffit.
  }
}

const memoryCache = new Map<string, SpriteSet>();
const inFlightRequests = new Map<string, Promise<SpriteSet>>();

/**
 * Table d'exceptions pour les espèces dont le nom Showdown/notre dex ne
 * correspond pas directement au slug PokeAPI (formes régionales composées,
 * apostrophes, points, fusions Calyrex...). Pas besoin d'y lister les
 * Mega Evolutions (gérées séparément par megaFormeToSlug) ni les cas déjà
 * couverts par la normalisation générique (minuscules, espaces → tirets).
 */
const SLUG_OVERRIDES: Record<string, string> = {
  'Urshifu-Rapid-Strike': 'urshifu-rapid-strike-style',
  'Urshifu-Single-Strike': 'urshifu-single-strike-style',
  Urshifu: 'urshifu-single-strike-style',
  'Calyrex-Shadow': 'calyrex-shadow-rider',
  'Calyrex-Ice': 'calyrex-ice-rider',
  'Necrozma-Dawn-Wings': 'necrozma-dawn',
  'Necrozma-Dusk-Mane': 'necrozma-dusk',
  "Farfetch'd": 'farfetchd',
  "Sirfetch'd": 'sirfetchd',
  'Mr. Mime': 'mr-mime',
  'Mr. Rime': 'mr-rime',
  'Mime Jr.': 'mime-jr',
  'Type: Null': 'type-null',
  'Nidoran-M': 'nidoran-m',
  'Nidoran-F': 'nidoran-f',
};

/** Normalisation générique d'un nom d'espèce Showdown en slug PokeAPI plausible. */
function normalizeToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/:/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function speciesToSlug(species: string): string {
  return SLUG_OVERRIDES[species] ?? normalizeToSlug(species);
}

/**
 * Convertit un nom de forme Mega ("Mega Swampert", "Mega Charizard X") au
 * slug PokeAPI ("swampert-mega", "charizard-mega-x"). Beaucoup de ces
 * formes n'existent que dans Champions (fictives) et ne résoudront jamais
 * — c'est normal, l'appelant retombe alors sur le sprite de base.
 */
function megaFormeToSlug(megaForme: string): string {
  const match = megaForme.match(/^Mega\s+(.+?)(?:\s+([XY]))?$/);
  if (!match) return normalizeToSlug(megaForme);
  const [, base, variant] = match;
  const baseSlug = speciesToSlug(base);
  return variant ? `${baseSlug}-mega-${variant.toLowerCase()}` : `${baseSlug}-mega`;
}

/** Slugs à essayer dans l'ordre : forme Mega d'abord (si applicable), puis espèce de base. */
export function getSpriteCandidateSlugs(
  species: string,
  isMegaEvolved: boolean,
  megaForme: string | null,
): string[] {
  const candidates: string[] = [];
  if (isMegaEvolved && megaForme) {
    candidates.push(megaFormeToSlug(megaForme));
  }
  candidates.push(speciesToSlug(species));
  return candidates;
}

const EMPTY_SPRITE_SET: SpriteSet = { officialArtwork: null, front: null, back: null };

async function fetchSpriteSetForSlug(slug: string): Promise<SpriteSet> {
  if (memoryCache.has(slug)) return memoryCache.get(slug) ?? EMPTY_SPRITE_SET;

  const persisted = loadPersistedCache();
  if (slug in persisted) {
    memoryCache.set(slug, persisted[slug]);
    return persisted[slug];
  }

  const existing = inFlightRequests.get(slug);
  if (existing) return existing;

  const request = (async (): Promise<SpriteSet> => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
      if (!res.ok) throw new Error(`PokeAPI ${res.status} pour "${slug}"`);
      const data = await res.json();
      const spriteSet: SpriteSet = {
        officialArtwork: data?.sprites?.other?.['official-artwork']?.front_default ?? null,
        front: data?.sprites?.front_default ?? null,
        back: data?.sprites?.back_default ?? null,
      };
      memoryCache.set(slug, spriteSet);
      persistCacheEntry(slug, spriteSet);
      return spriteSet;
    } catch {
      memoryCache.set(slug, EMPTY_SPRITE_SET);
      persistCacheEntry(slug, EMPTY_SPRITE_SET);
      return EMPTY_SPRITE_SET;
    } finally {
      inFlightRequests.delete(slug);
    }
  })();

  inFlightRequests.set(slug, request);
  return request;
}

/**
 * Résout la meilleure URL de sprite disponible pour ce Pokémon (illustration
 * officielle en priorité, sprite in-game en repli), en essayant d'abord sa
 * forme Mega si applicable, puis son espèce de base. Retourne null si rien
 * n'a été trouvé (espèce hors PokeAPI, hors-ligne...). Utilisé pour les
 * icônes/cartes (PokemonCard, TeamCard).
 */
export async function resolveSpriteUrl(
  species: string,
  isMegaEvolved: boolean,
  megaForme: string | null,
): Promise<string | null> {
  for (const slug of getSpriteCandidateSlugs(species, isMegaEvolved, megaForme)) {
    const spriteSet = await fetchSpriteSetForSlug(slug);
    const url = spriteSet.officialArtwork ?? spriteSet.front;
    if (url) return url;
  }
  return null;
}

/**
 * Résout la paire de sprites in-game (face/dos) pour la scène de combat
 * (ui/App.tsx::BattleStage) : le camp de l'utilisateur est vu de dos, le
 * camp adverse de face, comme dans le jeu réel. On utilise volontairement
 * les petits sprites in-game (pas l'illustration officielle, qui n'a pas de
 * version "dos") pour que face et dos restent visuellement cohérents entre
 * eux. Retourne { front: null, back: null } si rien n'a été trouvé.
 */
export async function resolveBattleSprites(
  species: string,
  isMegaEvolved: boolean,
  megaForme: string | null,
): Promise<{ front: string | null; back: string | null }> {
  for (const slug of getSpriteCandidateSlugs(species, isMegaEvolved, megaForme)) {
    const spriteSet = await fetchSpriteSetForSlug(slug);
    if (spriteSet.front || spriteSet.back) {
      return { front: spriteSet.front, back: spriteSet.back };
    }
  }
  return { front: null, back: null };
}
