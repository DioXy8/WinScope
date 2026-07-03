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

function loadPersistedCache(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(SPRITE_CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistCacheEntry(slug: string, url: string | null): void {
  try {
    const cache = loadPersistedCache();
    cache[slug] = url;
    localStorage.setItem(SPRITE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persistance, le cache mémoire de la session suffit.
  }
}

const memoryCache = new Map<string, string | null>();
const inFlightRequests = new Map<string, Promise<string | null>>();

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

async function fetchSpriteForSlug(slug: string): Promise<string | null> {
  if (memoryCache.has(slug)) return memoryCache.get(slug) ?? null;

  const persisted = loadPersistedCache();
  if (slug in persisted) {
    memoryCache.set(slug, persisted[slug]);
    return persisted[slug];
  }

  const existing = inFlightRequests.get(slug);
  if (existing) return existing;

  const request = (async (): Promise<string | null> => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
      if (!res.ok) throw new Error(`PokeAPI ${res.status} pour "${slug}"`);
      const data = await res.json();
      const url: string | null =
        data?.sprites?.other?.['official-artwork']?.front_default ?? data?.sprites?.front_default ?? null;
      memoryCache.set(slug, url);
      persistCacheEntry(slug, url);
      return url;
    } catch {
      memoryCache.set(slug, null);
      persistCacheEntry(slug, null);
      return null;
    } finally {
      inFlightRequests.delete(slug);
    }
  })();

  inFlightRequests.set(slug, request);
  return request;
}

/**
 * Résout la meilleure URL de sprite disponible pour ce Pokémon, en
 * essayant d'abord sa forme Mega si applicable, puis son espèce de base.
 * Retourne null si rien n'a été trouvé (espèce hors PokeAPI, hors-ligne...).
 */
export async function resolveSpriteUrl(
  species: string,
  isMegaEvolved: boolean,
  megaForme: string | null,
): Promise<string | null> {
  for (const slug of getSpriteCandidateSlugs(species, isMegaEvolved, megaForme)) {
    const url = await fetchSpriteForSlug(slug);
    if (url) return url;
  }
  return null;
}
