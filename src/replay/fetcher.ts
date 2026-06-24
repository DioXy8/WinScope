/**
 * replay/fetcher.ts
 *
 * Récupère le payload JSON officiel d'un replay Showdown depuis
 * n'importe quelle forme d'URL que l'utilisateur pourrait copier-coller.
 *
 * Référence: https://github.com/smogon/pokemon-showdown-client/blob/master/WEB-API.md
 *   "Most PS APIs ... available by adding .json to the URL.
 *    They all have Access-Control-Allow-Origin: *"
 *
 * Donc un simple fetch() depuis le navigateur fonctionne, pas besoin de proxy/backend.
 */

export interface RawReplayData {
  id: string;
  format: string;
  players: string[];
  log: string;
  uploadtime: number;
  views?: number;
  inputlog?: string | null;
  rating?: number | null;
  private?: number;
  password?: string | null;
}

export class ReplayFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid-url' | 'not-found' | 'network' | 'parse',
  ) {
    super(message);
    this.name = 'ReplayFetchError';
  }
}

/**
 * Normalise n'importe quelle forme d'URL/d'identifiant de replay Showdown
 * vers son URL JSON canonique.
 */
export function toReplayJsonUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ReplayFetchError('URL de replay vide.', 'invalid-url');
  }

  let working = trimmed;

  if (!/^https?:\/\//i.test(working)) {
    if (!/^replay\.pokemonshowdown\.com/i.test(working)) {
      working = `https://replay.pokemonshowdown.com/${working.replace(/^\/+/, '')}`;
    } else {
      working = `https://${working}`;
    }
  }

  let url: URL;
  try {
    url = new URL(working);
  } catch {
    throw new ReplayFetchError(`URL de replay invalide : "${input}"`, 'invalid-url');
  }

  if (!/^replay\.pokemonshowdown\.com$/i.test(url.hostname)) {
    throw new ReplayFetchError(
      `Cette URL ne pointe pas vers replay.pokemonshowdown.com : "${input}"`,
      'invalid-url',
    );
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\.(json|log|inputlog)$/i, '');

  if (pathname === '' || pathname === '/') {
    throw new ReplayFetchError(
      `Aucun identifiant de replay trouvé dans l'URL : "${input}"`,
      'invalid-url',
    );
  }

  return `https://replay.pokemonshowdown.com${pathname}.json`;
}

/**
 * Récupère et valide le JSON d'un replay Showdown.
 */
export async function fetchReplay(input: string): Promise<RawReplayData> {
  const jsonUrl = toReplayJsonUrl(input);

  let response: Response;
  try {
    response = await fetch(jsonUrl, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ReplayFetchError(
      `Impossible de contacter Pokémon Showdown (réseau). Détail : ${(err as Error).message}`,
      'network',
    );
  }

  if (response.status === 404) {
    throw new ReplayFetchError(
      "Ce replay n'existe pas ou a été supprimé (404). Vérifie le lien.",
      'not-found',
    );
  }
  if (!response.ok) {
    throw new ReplayFetchError(
      `Le serveur Showdown a répondu avec une erreur (${response.status}).`,
      'network',
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new ReplayFetchError(
      `Réponse de Showdown illisible (pas du JSON valide). Détail : ${(err as Error).message}`,
      'parse',
    );
  }

  if (!isRawReplayData(data)) {
    throw new ReplayFetchError(
      'Le JSON reçu ne correspond pas au format attendu pour un replay Showdown.',
      'parse',
    );
  }

  return data;
}

function isRawReplayData(value: unknown): value is RawReplayData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.format === 'string' &&
    typeof v.log === 'string' &&
    Array.isArray(v.players)
  );
}
