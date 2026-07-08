/**
 * ui/pokeSprites.ts
 *
 * Résout les sprites d'un Pokémon en deux temps :
 *  1. Chemin RAPIDE ET FIABLE : pour une espèce de base (pas de Mega), on
 *     connaît son numéro de Pokédex national (table générée depuis le
 *     paquet npm "pokemon") et on construit directement les URLs des
 *     fichiers statiques du dépôt GitHub PokeAPI/sprites — aucun appel
 *     réseau à faire nous-mêmes pour vérifier, le <img onError> du composant
 *     gère un éventuel échec. Ça évite complètement le rate-limit de l'API
 *     REST pour l'immense majorité des cas.
 *  2. Repli via l'API REST `/api/v2/pokemon/{slug}` (qui accepte un nom)
 *     UNIQUEMENT pour les Mega Evolutions et les formes spéciales absentes
 *     de la table statique (Floette-Eternal, Urshifu-Rapid-Strike...) —
 *     avec mise en cache agressive et gestion des échecs transitoires
 *     (rate limit) sans les considérer comme permanents.
 *
 * Repli propre pour les Mega Evolutions FICTIVES propres à Pokémon
 * Champions (ex: Mega Floette, Mega Garchomp, Mega Scovillain — aucune de
 * ces formes n'existe dans les jeux principaux) : dans ce cas, on retombe
 * simplement sur le sprite de l'espèce de base plutôt que de ne rien
 * afficher.
 */

import speciesToDexId from './data/speciesToDexId.json';

const SPECIES_TO_DEX_ID: Record<string, number> = speciesToDexId;

/** Construit les URLs de sprites statiques GitHub pour une espèce de base connue — pas d'appel réseau nécessaire. */
function getStaticSpriteSet(dexId: number): SpriteSet {
  const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  return {
    officialArtwork: `${base}/other/official-artwork/${dexId}.png`,
    front: `${base}/${dexId}.png`,
    back: `${base}/back/${dexId}.png`,
  };
}

// v2 : la v1 pouvait mettre en cache pour toujours un échec transitoire
// (rate limit PokeAPI) comme si le sprite n'existait pas — changement de
// clé pour repartir d'un cache propre plutôt que de migrer les entrées
// potentiellement corrompues des utilisateurs déjà passés par la v1.
const SPRITE_CACHE_STORAGE_KEY = 'winscope_sprite_cache_v2';

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
 * Limite le nombre de requêtes PokeAPI simultanées : au chargement d'une
 * page (équipe de 6 + Pokémon actifs/banc des deux côtés + scène de
 * combat), on peut demander 15-20 sprites différents d'un coup — sans
 * limite, cette rafale déclenche facilement le rate-limit de PokeAPI, dont
 * les échecs étaient (avant ce correctif) mis en cache pour toujours par
 * erreur (cf. plus bas). Une file d'attente simple suffit à éviter la
 * rafale sans vraiment ralentir le chargement perçu.
 */
const MAX_CONCURRENT_REQUESTS = 4;
let activeRequestCount = 0;
const requestQueue: (() => void)[] = [];

async function acquireRequestSlot(): Promise<void> {
  if (activeRequestCount < MAX_CONCURRENT_REQUESTS) {
    activeRequestCount++;
    return;
  }
  return new Promise((resolve) => {
    requestQueue.push(() => {
      activeRequestCount++;
      resolve();
    });
  });
}

function releaseRequestSlot(): void {
  activeRequestCount--;
  const next = requestQueue.shift();
  if (next) next();
}

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
    await acquireRequestSlot();
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
      if (res.status === 404) {
        // Confirmé : cette espèce/forme n'existe vraiment pas dans PokeAPI
        // (ex: une Mega fictive de Champions) — sûr de mettre en cache
        // durablement, ce cas ne changera jamais.
        memoryCache.set(slug, EMPTY_SPRITE_SET);
        persistCacheEntry(slug, EMPTY_SPRITE_SET);
        return EMPTY_SPRITE_SET;
      }
      if (!res.ok) {
        // Échec probablement TRANSITOIRE (rate limit 429, 5xx, etc.) : on ne
        // met PAS en cache, pour que le prochain appel retente au lieu de
        // rester bloqué sur "pas de sprite" indéfiniment (y compris après
        // un rechargement de page, puisque le cache est persisté).
        throw new Error(`PokeAPI ${res.status} pour "${slug}"`);
      }
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
      // Erreur réseau ou échec transitoire : ne PAS mettre en cache (cf.
      // commentaire ci-dessus), juste retourner vide pour cette tentative.
      return EMPTY_SPRITE_SET;
    } finally {
      releaseRequestSlot();
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
  if (!isMegaEvolved) {
    const dexId = SPECIES_TO_DEX_ID[species];
    if (dexId) return getStaticSpriteSet(dexId).officialArtwork;
  }
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
  if (!isMegaEvolved) {
    const dexId = SPECIES_TO_DEX_ID[species];
    if (dexId) {
      const staticSet = getStaticSpriteSet(dexId);
      return { front: staticSet.front, back: staticSet.back };
    }
  }
  for (const slug of getSpriteCandidateSlugs(species, isMegaEvolved, megaForme)) {
    const spriteSet = await fetchSpriteSetForSlug(slug);
    if (spriteSet.front || spriteSet.back) {
      return { front: spriteSet.front, back: spriteSet.back };
    }
  }
  return { front: null, back: null };
}
