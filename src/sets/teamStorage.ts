/**
 * sets/teamStorage.ts
 *
 * Gestion des équipes PokéPaste sauvegardées de l'utilisateur, persistées
 * en localStorage. Inspiré du parcours "mes équipes" d'Alakastats
 * (https://tambapps.github.io/alakastats/) : l'utilisateur enregistre une
 * ou plusieurs équipes une fois, puis choisit celle à utiliser avant chaque
 * analyse de replay — plutôt qu'un unique PokéPaste global à recoller à
 * chaque changement d'équipe.
 */

export interface SavedTeam {
  id: string;
  name: string;
  pokepasteText: string;
  /** Timestamp (Date.now()) de dernière modification, pour trier les équipes récentes en premier. */
  updatedAt: number;
}

const TEAMS_STORAGE_KEY = 'winscope_teams';
const ACTIVE_TEAM_STORAGE_KEY = 'winscope_active_team_id';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback pour les environnements sans crypto.randomUUID (anciens navigateurs).
  return `team_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Charge toutes les équipes sauvegardées, triées de la plus récemment modifiée à la plus ancienne. */
export function loadTeams(): SavedTeam[] {
  try {
    const raw = localStorage.getItem(TEAMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedTeam[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // localStorage indisponible ou JSON corrompu : on repart d'une liste vide
    // plutôt que de planter l'app.
    return [];
  }
}

function persistTeams(teams: SavedTeam[]): void {
  try {
    localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(teams));
  } catch {
    // Idem : navigation privée ou quota dépassé, on continue sans persister.
  }
}

/** Crée une nouvelle équipe et la sauvegarde. Retourne l'équipe créée (avec son id généré). */
export function createTeam(name: string, pokepasteText: string): SavedTeam {
  const team: SavedTeam = { id: generateId(), name, pokepasteText, updatedAt: Date.now() };
  const teams = loadTeams();
  persistTeams([...teams, team]);
  return team;
}

/** Met à jour une équipe existante (nom et/ou PokéPaste). */
export function updateTeam(id: string, name: string, pokepasteText: string): void {
  const teams = loadTeams();
  const next = teams.map((t) => (t.id === id ? { ...t, name, pokepasteText, updatedAt: Date.now() } : t));
  persistTeams(next);
}

/** Supprime une équipe. Si c'était l'équipe active, désactive aussi la sélection active. */
export function deleteTeam(id: string): void {
  const teams = loadTeams().filter((t) => t.id !== id);
  persistTeams(teams);
  if (loadActiveTeamId() === id) {
    clearActiveTeamId();
  }
}

/** Id de l'équipe actuellement sélectionnée pour l'analyse, ou null si aucune. */
export function loadActiveTeamId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TEAM_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveTeamId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_TEAM_STORAGE_KEY, id);
  } catch {
    // no-op si indisponible.
  }
}

export function clearActiveTeamId(): void {
  try {
    localStorage.removeItem(ACTIVE_TEAM_STORAGE_KEY);
  } catch {
    // no-op si indisponible.
  }
}
