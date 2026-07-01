import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock minimal de l'API localStorage (non disponible dans l'environnement
 * de test 'node' de vitest, cf. vite.config.ts). Suffisant pour tester la
 * logique de sets/teamStorage.ts sans dépendre d'un vrai navigateur.
 */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', mock);
  return mock;
}

describe('teamStorage', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.resetModules();
  });

  it('loadTeams retourne un tableau vide au départ', async () => {
    const { loadTeams } = await import('../teamStorage');
    expect(loadTeams()).toEqual([]);
  });

  it('createTeam sauvegarde puis loadTeams la retrouve', async () => {
    const { createTeam, loadTeams } = await import('../teamStorage');
    const team = createTeam('Team Delphox', 'Delphox-Mega @ Delphoxite');
    expect(team.name).toBe('Team Delphox');
    expect(team.id).toBeTruthy();

    const teams = loadTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(team.id);
    expect(teams[0].pokepasteText).toBe('Delphox-Mega @ Delphoxite');
  });

  it('trie les équipes de la plus récente à la plus ancienne', async () => {
    const { createTeam, loadTeams } = await import('../teamStorage');
    const first = createTeam('Ancienne équipe', 'A');
    // On force un updatedAt strictement supérieur pour simuler un ordre temporel réel.
    await new Promise((r) => setTimeout(r, 2));
    const second = createTeam('Équipe récente', 'B');

    const teams = loadTeams();
    expect(teams[0].id).toBe(second.id);
    expect(teams[1].id).toBe(first.id);
  });

  it('updateTeam modifie le nom et le contenu sans changer l’id', async () => {
    const { createTeam, updateTeam, loadTeams } = await import('../teamStorage');
    const team = createTeam('Brouillon', 'Kingambit');
    updateTeam(team.id, 'Équipe finale', 'Kingambit @ Black Glasses');

    const [updated] = loadTeams();
    expect(updated.id).toBe(team.id);
    expect(updated.name).toBe('Équipe finale');
    expect(updated.pokepasteText).toBe('Kingambit @ Black Glasses');
  });

  it('deleteTeam retire l’équipe de la liste', async () => {
    const { createTeam, deleteTeam, loadTeams } = await import('../teamStorage');
    const team = createTeam('À supprimer', 'X');
    expect(loadTeams()).toHaveLength(1);

    deleteTeam(team.id);
    expect(loadTeams()).toHaveLength(0);
  });

  it('deleteTeam désactive l’équipe active si c’était elle', async () => {
    const { createTeam, deleteTeam, setActiveTeamId, loadActiveTeamId } = await import(
      '../teamStorage'
    );
    const team = createTeam('Active', 'X');
    setActiveTeamId(team.id);
    expect(loadActiveTeamId()).toBe(team.id);

    deleteTeam(team.id);
    expect(loadActiveTeamId()).toBeNull();
  });

  it('setActiveTeamId / loadActiveTeamId / clearActiveTeamId fonctionnent', async () => {
    const { setActiveTeamId, loadActiveTeamId, clearActiveTeamId } = await import(
      '../teamStorage'
    );
    expect(loadActiveTeamId()).toBeNull();
    setActiveTeamId('abc123');
    expect(loadActiveTeamId()).toBe('abc123');
    clearActiveTeamId();
    expect(loadActiveTeamId()).toBeNull();
  });
});
