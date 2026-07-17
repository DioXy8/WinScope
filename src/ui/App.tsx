import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { fetchReplay, ReplayFetchError } from '../replay/fetcher';
import { parsePokemonIdent, parseReplayLog } from '../replay/logParser';
import type { ParsedReplayLog } from '../replay/types';
import { replayToStates } from '../engine/reducer';
import type { BattleState, PokemonState } from '../engine/state';
import { estimateWinProbability } from '../search/evaluator';
import { calculateDamage, DexLookupError } from '../damagecalc/damageCalc';
import type { DamageCalcResult } from '../damagecalc/damageCalc';
import { isOffensiveMove, isSpreadMove, getSetConfidence, getKnownMoves, resolveDexName } from '../damagecalc/adapter';
import { resolveBattleSprites, resolveSpriteCandidates } from './pokeSprites';
import { resolveMegaForme } from '../engine/megaStones';
import { getDeepBestWinExpectancyForSide, FAST_TREND_SEARCH_OPTIONS } from '../search/minimax';
import { runMonteCarloChunked } from '../search/monteCarlo';
import type { MonteCarloResult } from '../search/monteCarlo';
import { generateActionsForPosition } from '../search/actionGenerator';
import type { PlayerAction } from '../search/actionTypes';
import type { PokemonPosition } from '../replay/types';
import { parsePokePaste } from '../sets/pokepasteParser';
import { applyUserPokePasteToStates } from '../sets/applyUserSets';
import type { SavedTeam } from '../sets/teamStorage';
import {
  createTeam,
  deleteTeam,
  loadActiveTeamId,
  loadTeams,
  setActiveTeamId as persistActiveTeamId,
  updateTeam,
} from '../sets/teamStorage';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      states: BattleState[];
      parsedReplay: ParsedReplayLog;
      p1Name: string;
      p2Name: string;
      /** Côté identifié comme celui de l'utilisateur d'après son PokéPaste, si trouvé. */
      userSide: 'p1' | 'p2' | null;
      /** Id du replay Showdown (ex: "gen9vgc2026regmb-1234567890"), pour l'iframe du replay officiel. */
      replayId: string;
    };

/** Écran affiché : liste des équipes, formulaire d'ajout/édition, ou analyse de replay. */
type Screen = { name: 'teams' } | { name: 'team-editor'; editingTeamId: string | null } | { name: 'analyze' };

export default function App() {
  const [teams, setTeams] = useState<SavedTeam[]>(() => loadTeams());
  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => loadActiveTeamId());
  const [screen, setScreen] = useState<Screen>(() => {
    const savedActiveId = loadActiveTeamId();
    const hasActiveTeam = savedActiveId !== null && loadTeams().some((t) => t.id === savedActiveId);
    return hasActiveTeam ? { name: 'analyze' } : { name: 'teams' };
  });

  const [url, setUrl] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [turnIndex, setTurnIndex] = useState(0);

  const activeTeam = useMemo(() => teams.find((t) => t.id === activeTeamId) ?? null, [teams, activeTeamId]);
  const parsedActiveTeam = useMemo(
    () => (activeTeam ? parsePokePaste(activeTeam.pokepasteText) : []),
    [activeTeam],
  );

  function refreshTeams() {
    setTeams(loadTeams());
  }

  function handleSelectTeam(id: string) {
    persistActiveTeamId(id);
    setActiveTeamId(id);
    setScreen({ name: 'analyze' });
  }

  function handleCreateTeamClick() {
    setScreen({ name: 'team-editor', editingTeamId: null });
  }

  function handleEditTeamClick(id: string) {
    setScreen({ name: 'team-editor', editingTeamId: id });
  }

  function handleDeleteTeamClick(id: string) {
    deleteTeam(id);
    refreshTeams();
    if (activeTeamId === id) {
      setActiveTeamId(null);
    }
  }

  function handleSaveTeam(name: string, pokepasteText: string, editingTeamId: string | null) {
    let savedId: string;
    if (editingTeamId) {
      updateTeam(editingTeamId, name, pokepasteText);
      savedId = editingTeamId;
    } else {
      savedId = createTeam(name, pokepasteText).id;
    }
    refreshTeams();
    persistActiveTeamId(savedId);
    setActiveTeamId(savedId);
    setScreen({ name: 'analyze' });
  }

  async function handleAnalyze() {
    if (!activeTeam || parsedActiveTeam.length === 0) {
      setState({
        status: 'error',
        message: 'Sélectionne une équipe valide avant d’analyser un replay.',
      });
      return;
    }
    if (!url.trim()) {
      setState({ status: 'error', message: 'Colle une URL de replay Showdown avant de lancer l’analyse.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const raw = await fetchReplay(url);
      const parsed = parseReplayLog(raw.log);
      const rawStates = replayToStates(parsed);
      const { states, match } = applyUserPokePasteToStates(rawStates, parsedActiveTeam);
      const p1Name = parsed.players.find((p) => p.side === 'p1')?.username ?? 'Joueur 1';
      const p2Name = parsed.players.find((p) => p.side === 'p2')?.username ?? 'Joueur 2';
      setState({
        status: 'success',
        states,
        parsedReplay: parsed,
        p1Name,
        p2Name,
        userSide: match.side,
        replayId: raw.id,
      });
      setTurnIndex(0);
    } catch (err) {
      const message =
        err instanceof ReplayFetchError
          ? err.message
          : `Erreur inattendue : ${(err as Error).message}`;
      setState({ status: 'error', message });
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>WinScope</h1>
        <p className="subtitle">Analyseur de replays Pokémon VGC / Champions</p>
      </header>

      {screen.name === 'teams' && (
        <TeamsScreen
          teams={teams}
          onSelectTeam={handleSelectTeam}
          onCreateTeam={handleCreateTeamClick}
          onEditTeam={handleEditTeamClick}
          onDeleteTeam={handleDeleteTeamClick}
        />
      )}

      {screen.name === 'team-editor' && (
        <TeamEditorScreen
          editingTeam={screen.editingTeamId ? teams.find((t) => t.id === screen.editingTeamId) ?? null : null}
          onSave={(name, pokepasteText) => handleSaveTeam(name, pokepasteText, screen.editingTeamId)}
          onCancel={() => setScreen({ name: 'teams' })}
        />
      )}

      {screen.name === 'analyze' && activeTeam && (
        <>
          <ActiveTeamBadge team={activeTeam} pokemonCount={parsedActiveTeam.length} onChangeTeam={() => setScreen({ name: 'teams' })} />

          <section className="input-section">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Colle l'URL d'un replay Showdown..."
              className="url-input"
            />
            <button
              onClick={handleAnalyze}
              disabled={state.status === 'loading'}
              className="analyze-button"
            >
              {state.status === 'loading' ? 'Chargement...' : 'Analyser'}
            </button>
          </section>

          {state.status === 'error' && (
            <div className="error-box">
              <strong>Erreur :</strong> {state.message}
            </div>
          )}

          {state.status === 'success' && state.userSide === null && (
            <div className="warning-box">
              Ton équipe "{activeTeam.name}" ne correspond à aucun des deux camps de ce replay (pas
              assez d'espèces en commun) — les calculs de dégâts utiliseront des stats par défaut
              plutôt que ton set exact.
            </div>
          )}

          {state.status === 'success' && (
            <BattleExplorer
              states={state.states}
              parsedReplay={state.parsedReplay}
              p1Name={state.p1Name}
              p2Name={state.p2Name}
              userSide={state.userSide}
              turnIndex={turnIndex}
              onTurnChange={setTurnIndex}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Écran d'accueil façon Alakastats : liste des équipes enregistrées sous
 * forme de cartes, avec leurs Pokémon détectés. Aucune équipe active tant
 * qu'on n'en a pas choisi une ici — c'est le point d'entrée obligatoire.
 */
function TeamsScreen({
  teams,
  onSelectTeam,
  onCreateTeam,
  onEditTeam,
  onDeleteTeam,
}: {
  teams: SavedTeam[];
  onSelectTeam: (id: string) => void;
  onCreateTeam: () => void;
  onEditTeam: (id: string) => void;
  onDeleteTeam: (id: string) => void;
}) {
  return (
    <section className="teams-screen">
      <div className="teams-screen-header">
        <h2 className="teams-screen-title">Mes équipes</h2>
        <button className="analyze-button" onClick={onCreateTeam}>
          + Nouvelle équipe
        </button>
      </div>

      {teams.length === 0 ? (
        <p className="teams-empty-hint">
          Aucune équipe enregistrée pour l'instant. Ajoute ton PokéPaste pour commencer — il sera
          réutilisé pour toutes tes analyses futures, sans avoir à le recoller.
        </p>
      ) : (
        <div className="teams-grid">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onSelect={() => onSelectTeam(team.id)}
              onEdit={() => onEditTeam(team.id)}
              onDelete={() => onDeleteTeam(team.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamCard({
  team,
  onSelect,
  onEdit,
  onDelete,
}: {
  team: SavedTeam;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const parsedSets = useMemo(() => parsePokePaste(team.pokepasteText), [team.pokepasteText]);

  function handleDeleteClick(e: MouseEvent) {
    e.stopPropagation();
    if (window.confirm(`Supprimer l'équipe "${team.name}" ?`)) {
      onDelete();
    }
  }

  function handleEditClick(e: MouseEvent) {
    e.stopPropagation();
    onEdit();
  }

  return (
    <div className="team-card" onClick={onSelect} role="button" tabIndex={0}>
      <div className="team-card-header">
        <h3 className="team-card-name">{team.name}</h3>
        <div className="team-card-actions">
          <button className="team-card-icon-btn" onClick={handleEditClick} title="Modifier">
            ✎
          </button>
          <button className="team-card-icon-btn" onClick={handleDeleteClick} title="Supprimer">
            ✕
          </button>
        </div>
      </div>
      {parsedSets.length > 0 ? (
        <ul className="team-card-species-list">
          {parsedSets.map((p, i) => (
            <li key={i} className="team-card-species-item">
              <PokemonSprite
                species={p.species}
                isMegaEvolved={p.isMegaInPaste}
                megaForme={p.isMegaInPaste && p.item ? resolveMegaForme(p.item) : null}
                size={22}
              />
              {p.species}
            </li>
          ))}
        </ul>
      ) : (
        <p className="team-card-empty">PokéPaste vide ou non reconnu</p>
      )}
    </div>
  );
}

/** Formulaire de création/édition d'une équipe : nom + PokéPaste. */
function TeamEditorScreen({
  editingTeam,
  onSave,
  onCancel,
}: {
  editingTeam: SavedTeam | null;
  onSave: (name: string, pokepasteText: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editingTeam?.name ?? '');
  const [pokepasteText, setPokepasteText] = useState(editingTeam?.pokepasteText ?? '');

  const parsedCount = useMemo(() => parsePokePaste(pokepasteText).length, [pokepasteText]);
  const isEmpty = pokepasteText.trim().length === 0;
  const canSave = name.trim().length > 0 && parsedCount > 0;

  return (
    <section className="pokepaste-section">
      <div className="pokepaste-header">
        <h2 className="pokepaste-title">{editingTeam ? 'Modifier l’équipe' : 'Nouvelle équipe'}</h2>
        {!isEmpty && (
          <span className={parsedCount > 0 ? 'pokepaste-status-ok' : 'pokepaste-status-error'}>
            {parsedCount > 0
              ? `${parsedCount} Pokémon détecté${parsedCount > 1 ? 's' : ''}`
              : 'Format non reconnu'}
          </span>
        )}
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom de l'équipe (ex: Champions Reg M-B)"
        className="url-input team-name-input"
      />

      <p className="pokepaste-hint">
        Colle ici le PokéPaste complet de ton équipe (export Showdown standard). Les calculs de
        dégâts sur cette équipe utiliseront tes vraies EVs/IVs/nature/objet/talent au lieu
        d'estimations.
      </p>
      <textarea
        className="pokepaste-textarea"
        value={pokepasteText}
        onChange={(e) => setPokepasteText(e.target.value)}
        placeholder={'Delphox-Mega @ Delphoxite\nAbility: Levitate\nLevel: 50\nEVs: 11 HP / 5 Def / 18 SpA / 32 Spe\nTimid Nature\n- Heat Wave\n...'}
        rows={12}
        spellCheck={false}
      />

      <div className="team-editor-actions">
        <button className="analyze-button" disabled={!canSave} onClick={() => onSave(name.trim(), pokepasteText)}>
          Enregistrer
        </button>
        <button className="team-editor-cancel-btn" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </section>
  );
}

/** Bandeau compact affiché sur l'écran d'analyse, rappelant l'équipe active. */
function ActiveTeamBadge({
  team,
  pokemonCount,
  onChangeTeam,
}: {
  team: SavedTeam;
  pokemonCount: number;
  onChangeTeam: () => void;
}) {
  return (
    <div className="active-team-badge">
      <span className="active-team-label">
        Équipe active : <strong>{team.name}</strong> ({pokemonCount} Pokémon)
      </span>
      <button className="active-team-change-btn" onClick={onChangeTeam}>
        Changer d'équipe
      </button>
    </div>
  );
}

/**
 * Intègre le vrai replay animé Showdown via iframe (option choisie :
 * simplicité et fidélité au vrai client plutôt qu'une synchronisation avec
 * notre scrubber — les deux lecteurs restent indépendants). Repliable pour
 * ceux qui préfèrent se concentrer sur l'analyse seule.
 */
/**
 * Scène de combat "maison", construite à partir de nos propres données
 * (BattleState + sprites PokeAPI) plutôt qu'un iframe externe — donc
 * automatiquement synchronisée avec le scrubber de tours, contrairement à
 * un lecteur de replay Showdown embarqué séparément. Pas d'animations de
 * moves façon vrai client (pas de son, pas d'effets de coup), mais un vrai
 * rendu du terrain qui bouge avec la navigation existante.
 */
function BattleStage({
  battle,
  p1Name,
  p2Name,
}: {
  battle: BattleState;
  p1Name: string;
  p2Name: string;
}) {
  const p1Active = getActivePokemon(battle, 'p1');
  const p2Active = getActivePokemon(battle, 'p2');

  const { field } = battle;
  const weatherClass = field.weather ? `battle-stage-weather-${field.weather}` : '';

  return (
    <div className={`battle-stage ${weatherClass}`}>
      {field.weather && <div className="battle-stage-weather-banner">{weatherLabel(field.weather)}</div>}
      <div className="battle-stage-half battle-stage-half-top">
        <div className="battle-stage-side-label">{p1Name}</div>
        <div className="battle-stage-row">
          {p1Active.map((p) => (
            <BattleStageSlot key={p.species} pokemon={p} facing="front" />
          ))}
        </div>
      </div>
      <div className="battle-stage-half battle-stage-half-bottom">
        <div className="battle-stage-row">
          {p2Active.map((p) => (
            <BattleStageSlot key={p.species} pokemon={p} facing="back" />
          ))}
        </div>
        <div className="battle-stage-side-label">{p2Name}</div>
      </div>
    </div>
  );
}

function BattleStageSlot({ pokemon, facing }: { pokemon: PokemonState; facing: 'front' | 'back' }) {
  const [sprites, setSprites] = useState<{ front: string | null; back: string | null }>({
    front: null,
    back: null,
  });
  const [preferredFailed, setPreferredFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const assumedDexName = resolveDexName(pokemon);
  const isMega = assumedDexName !== pokemon.species;

  useEffect(() => {
    let cancelled = false;
    setPreferredFailed(false);
    setFallbackFailed(false);
    resolveBattleSprites(pokemon.species, isMega, isMega ? assumedDexName : null).then((resolved) => {
      if (!cancelled) setSprites(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [pokemon.species, isMega, assumedDexName]);

  const preferredUrl = facing === 'back' ? sprites.back : sprites.front;
  const fallbackUrl = facing === 'back' ? sprites.front : sprites.back;
  // Si le sprite de la face demandée échoue au chargement (ex: manquant
  // pour cette espèce), on retombe sur l'autre face plutôt que de laisser
  // un cadre vide — les deux valent mieux qu'aucun sprite du tout.
  const spriteUrl = !preferredFailed ? preferredUrl : !fallbackFailed ? fallbackUrl : null;
  const maxHp = pokemon.maxHp ?? 100;
  const hpPercent = pokemon.fainted ? 0 : Math.max(0, Math.min(100, (pokemon.currentHp / maxHp) * 100));
  const hpColorClass = hpPercent > 50 ? 'hp-high' : hpPercent > 20 ? 'hp-mid' : 'hp-low';
  const label = pokemon.nickname || pokemon.species;
  const boostEntries = (Object.entries(pokemon.boosts) as [string, number][]).filter(([, v]) => v !== 0);

  return (
    <div className={`battle-stage-slot ${pokemon.fainted ? 'battle-stage-slot-fainted' : ''}`}>
      <div className="battle-stage-info-box">
        <div className="battle-stage-name-row">
          <span className="battle-stage-name">{label}</span>
          {pokemon.status && <span className={`status-badge status-${pokemon.status}`}>{pokemon.status}</span>}
        </div>
        <div className="hp-bar-track battle-stage-hp-track">
          <div className={`hp-bar-fill ${hpColorClass}`} style={{ width: `${hpPercent}%` }} />
        </div>
        <div className="battle-stage-hp-text">
          {pokemon.fainted
            ? 'KO'
            : pokemon.hpIsPercentage
              ? `${Math.round(hpPercent)}%`
              : `${pokemon.currentHp}/${maxHp}`}
        </div>
        {boostEntries.length > 0 && (
          <div className="battle-stage-boosts">
            {boostEntries.map(([stat, value]) => (
              <span key={stat} className={`boost-chip ${value > 0 ? 'boost-up' : 'boost-down'}`}>
                {stat.toUpperCase()} {value > 0 ? `+${value}` : value}
              </span>
            ))}
          </div>
        )}
      </div>
      {spriteUrl ? (
        <img
          className={`battle-stage-sprite ${facing === 'back' ? 'battle-stage-sprite-back' : ''}`}
          src={spriteUrl}
          alt={label}
          loading="lazy"
          onError={() => (!preferredFailed ? setPreferredFailed(true) : setFallbackFailed(true))}
        />
      ) : (
        <div className="battle-stage-sprite-placeholder" />
      )}
    </div>
  );
}

function BattleExplorer({
  states,
  parsedReplay,
  p1Name,
  p2Name,
  userSide,
  turnIndex,
  onTurnChange,
}: {
  states: BattleState[];
  parsedReplay: ParsedReplayLog;
  p1Name: string;
  p2Name: string;
  userSide: 'p1' | 'p2' | null;
  turnIndex: number;
  onTurnChange: (index: number) => void;
}) {
  const current = states[turnIndex];

  const fallbackProbabilities = useMemo(() => states.map((s) => estimateWinProbability(s)), [states]);
  const [computedProbabilities, setComputedProbabilities] = useState<(number | null)[]>(() =>
    states.map(() => null),
  );
  const [computeProgress, setComputeProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setComputedProbabilities(states.map(() => null));
    setComputeProgress(0);

    async function computeAll() {
      for (let i = 0; i < states.length; i++) {
        if (cancelled) return;
        // requestAnimationFrame entre chaque tour pour laisser React re-render
        // la progression plutôt que de bloquer le thread pendant tout le calcul.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (cancelled) return;
        // Config volontairement légère (1 tour, peu de candidats) car ce
        // calcul tourne pour CHAQUE tour du replay : la simulation Monte Carlo
        // complète (des milliers de parties par coup) est réservée à
        // l'analyse à la demande (bouton "Analyser" ci-dessous).
        const best = getDeepBestWinExpectancyForSide(states[i], 'p1', FAST_TREND_SEARCH_OPTIONS);
        const value = best ?? fallbackProbabilities[i];
        setComputedProbabilities((prev) => {
          const next = [...prev];
          next[i] = value;
          return next;
        });
        setComputeProgress(i + 1);
      }
    }

    computeAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states]);

  const winProbabilities = useMemo(
    () => computedProbabilities.map((v, i) => v ?? fallbackProbabilities[i]),
    [computedProbabilities, fallbackProbabilities],
  );
  const currentWinP1 = winProbabilities[turnIndex];
  const isStillComputing = computeProgress < states.length;

  const p1Active = useMemo(() => getActivePokemon(current, 'p1'), [current]);
  const p2Active = useMemo(() => getActivePokemon(current, 'p2'), [current]);
  const p1Bench = useMemo(() => getBenchPokemon(current, 'p1'), [current]);
  const p2Bench = useMemo(() => getBenchPokemon(current, 'p2'), [current]);

  return (
    <div className="explorer-layout">
      <VerticalWinBar p1Name={p1Name} p2Name={p2Name} p1Percent={currentWinP1} />
      <section className="explorer">
        <BattleStage battle={current} p1Name={p1Name} p2Name={p2Name} />
        <div className="scrubber">
        <button
          className="scrubber-btn"
          onClick={() => onTurnChange(Math.max(0, turnIndex - 1))}
          disabled={turnIndex === 0}
        >
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={states.length - 1}
          value={turnIndex}
          onChange={(e) => onTurnChange(Number(e.target.value))}
          className="scrubber-slider"
        />
        <button
          className="scrubber-btn"
          onClick={() => onTurnChange(Math.min(states.length - 1, turnIndex + 1))}
          disabled={turnIndex === states.length - 1}
        >
          ▶
        </button>
        <span className="scrubber-label">
          {turnIndex === 0 ? 'Avant le tour 1' : `Tour ${current.turnNumber}`} / {states.length - 1}
        </span>
      </div>

      <TurnActionsLog parsedReplay={parsedReplay} turnNumber={current.turnNumber} battle={current} />

      {isStillComputing && (
        <p className="win-compute-progress">
          Calcul de l'analyse en cours… ({computeProgress}/{states.length} tours)
        </p>
      )}

      <FieldSummary battle={current} />

      <MatchupsPanel battle={current} p1Name={p1Name} p2Name={p2Name} />

      <TurnAnalysisPanel battle={current} p1Name={p1Name} p2Name={p2Name} />

      <div className="sides-grid">
        <SideColumn label={p1Name} active={p1Active} bench={p1Bench} sideState={current.sides.p1} />
        <SideColumn label={p2Name} active={p2Active} bench={p2Bench} sideState={current.sides.p2} />
      </div>
      </section>
    </div>
  );
}

function getActivePokemon(battle: BattleState, side: 'p1' | 'p2'): PokemonState[] {
  const keys = Object.entries(battle.activeByPosition)
    .filter(([pos]) => pos.startsWith(side))
    .map(([, key]) => key);
  return keys.map((key) => battle.pokemonByKey[key]).filter((p): p is PokemonState => Boolean(p));
}

/**
 * Banc RÉEL : Pokémon déjà entrés sur le terrain au moins une fois
 * (`hasBeenSentOut`) dans ce combat, vivants, et pas actuellement actifs.
 * Sans le filtre `hasBeenSentOut`, les Pokémon seulement annoncés en Team
 * Preview mais jamais amenés (Reg M-B "bring 6, pick 4") apparaîtraient à
 * tort comme membres du banc pour toujours.
 */
function getBenchPokemon(battle: BattleState, side: 'p1' | 'p2'): PokemonState[] {
  const activeKeys = new Set(Object.values(battle.activeByPosition));
  return Object.entries(battle.pokemonByKey)
    .filter(([key, p]) => p.side === side && p.hasBeenSentOut && !p.fainted && !activeKeys.has(key))
    .map(([, p]) => p);
}

/**
 * Jauge verticale façon thermomètre : bleu (p1) en haut, rouge (p2) en bas,
 * la frontière monte/descend selon le % de victoire. Remplace l'ancienne
 * barre horizontale, jugée moins lisible qu'un indicateur permanent sur le
 * côté de l'écran pendant qu'on parcourt le combat.
 */
function VerticalWinBar({
  p1Name,
  p2Name,
  p1Percent,
}: {
  p1Name: string;
  p2Name: string;
  p1Percent: number;
}) {
  // Arrondi une seule fois ici : p1Percent peut arriver avec une décimale
  // (issu de l'analyse de tour, ex: 67.6) — sans cet arrondi, `100 - 67.6`
  // produit un artefact de virgule flottante classique en JS
  // (32.400000000000006 au lieu de 32.4). Dériver p2 du p1 déjà arrondi
  // garantit un affichage propre des deux côtés.
  const roundedP1 = Math.round(p1Percent);
  const p2Percent = 100 - roundedP1;
  return (
    <div
      className="vertical-winbar"
      title="Estimation rapide recalculée à chaque tour (modélisation adverse simplifiée, pour rester fluide sur tout le replay) — combine les 2 Pokémon actifs. Moins fiable que l'analyse détaillée ci-dessous : utilise « Analyser » sur un Pokémon précis pour un calcul plus poussé sur ce tour."
    >
      <div className="vertical-winbar-label">
        <span className="vertical-winbar-percent vertical-winbar-percent-p1">{roundedP1}%</span>
        <span className="vertical-winbar-name">{p1Name}</span>
      </div>
      <div className="vertical-winbar-track">
        <div className="vertical-winbar-fill-p1" style={{ flexGrow: roundedP1 }} />
        <div className="vertical-winbar-fill-p2" style={{ flexGrow: p2Percent }} />
      </div>
      <div className="vertical-winbar-label">
        <span className="vertical-winbar-name">{p2Name}</span>
        <span className="vertical-winbar-percent vertical-winbar-percent-p2">{p2Percent}%</span>
      </div>
    </div>
  );
}

function FieldSummary({ battle }: { battle: BattleState }) {
  const { field, sides } = battle;
  const badges: string[] = [];

  if (field.weather) badges.push(`Météo : ${weatherLabel(field.weather)}`);
  if (field.terrain) badges.push(`Terrain : ${terrainLabel(field.terrain)}`);
  if (field.isTrickRoom) badges.push('Trick Room actif');
  if (field.isGravity) badges.push('Gravity actif');
  if (sides.p1.isTailwind) badges.push('Tailwind (P1)');
  if (sides.p2.isTailwind) badges.push('Tailwind (P2)');
  if (sides.p1.isReflect) badges.push('Reflect (P1)');
  if (sides.p2.isReflect) badges.push('Reflect (P2)');
  if (sides.p1.isLightScreen) badges.push('Light Screen (P1)');
  if (sides.p2.isLightScreen) badges.push('Light Screen (P2)');
  if (sides.p1.spikes > 0) badges.push(`Spikes x${sides.p1.spikes} (P1)`);
  if (sides.p2.spikes > 0) badges.push(`Spikes x${sides.p2.spikes} (P2)`);
  if (sides.p1.stealthRock) badges.push('Stealth Rock (P1)');
  if (sides.p2.stealthRock) badges.push('Stealth Rock (P2)');

  if (badges.length === 0) {
    return <div className="field-summary field-summary-empty">Terrain neutre, aucun effet actif.</div>;
  }

  return (
    <div className="field-summary">
      {badges.map((b) => (
        <span key={b} className="field-badge">
          {b}
        </span>
      ))}
    </div>
  );
}

function weatherLabel(w: NonNullable<BattleState['field']['weather']>): string {
  const map: Record<string, string> = {
    sun: 'Soleil',
    rain: 'Pluie',
    sand: 'Tempête de sable',
    snow: 'Neige',
    harshsun: 'Soleil extrême',
    heavyrain: 'Pluie diluvienne',
  };
  return map[w] ?? w;
}

function terrainLabel(t: NonNullable<BattleState['field']['terrain']>): string {
  const map: Record<string, string> = {
    electric: 'Électrique',
    grassy: 'Herbu',
    misty: 'Brumeux',
    psychic: 'Psychique',
  };
  return map[t] ?? t;
}

function SideColumn({
  label,
  active,
  bench,
  sideState,
}: {
  label: string;
  active: PokemonState[];
  bench: PokemonState[];
  sideState: BattleState['sides']['p1'];
}) {
  return (
    <div className="side-column">
      <h3>{label}</h3>
      <div className="active-row">
        {active.length === 0 && <p className="no-active">Aucun Pokémon actif</p>}
        {active.map((p) => (
          <PokemonCard key={p.species} pokemon={p} />
        ))}
      </div>
      {bench.length > 0 && (
        <details className="bench-details">
          <summary>Banc ({bench.length})</summary>
          <div className="bench-row">
            {bench.map((p) => (
              <PokemonCard key={p.species} pokemon={p} compact />
            ))}
          </div>
        </details>
      )}
      {sideState.hasUsedTerastallize && <p className="tera-used-note">Tera déjà utilisé</p>}
    </div>
  );
}

/**
 * Sprite PokeAPI d'un Pokémon, avec repli sur l'espèce de base si la forme
 * Mega demandée n'existe pas dans PokeAPI (fréquent : la plupart des Mega
 * Evolutions de Champions sont fictives, cf. ui/pokeSprites.ts). N'affiche
 * rien (juste un espace réservé discret) si PokeAPI n'a vraiment aucune
 * image pour cette espèce, plutôt qu'une icône d'image cassée.
 */
function PokemonSprite({
  species,
  isMegaEvolved,
  megaForme,
  size = 40,
}: {
  species: string;
  isMegaEvolved: boolean;
  megaForme: string | null;
  size?: number;
}) {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [attemptIndex, setAttemptIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCandidates([]);
    setAttemptIndex(0);
    resolveSpriteCandidates(species, isMegaEvolved, megaForme).then((resolved) => {
      if (!cancelled) setCandidates(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [species, isMegaEvolved, megaForme]);

  const currentUrl = candidates[attemptIndex];

  if (!currentUrl) {
    return <div className="pokemon-sprite-placeholder" style={{ width: size, height: size }} />;
  }

  return (
    <img
      className="pokemon-sprite"
      src={currentUrl}
      alt={species}
      width={size}
      height={size}
      loading="lazy"
      // Si cette URL échoue au chargement (ex: illustration officielle
      // manquante pour cette espèce), on passe à la suivante de la liste
      // (sprite in-game classique) plutôt que d'abandonner directement —
      // filet de sécurité pour le chemin rapide statique, qui construit ses
      // URLs sans vérification réseau préalable.
      onError={() => setAttemptIndex((i) => i + 1)}
    />
  );
}

function PokemonCard({ pokemon, compact }: { pokemon: PokemonState; compact?: boolean }) {
  const maxHp = pokemon.maxHp ?? 100;
  const hpPercent = pokemon.fainted ? 0 : Math.max(0, Math.min(100, (pokemon.currentHp / maxHp) * 100));
  const hpColorClass = hpPercent > 50 ? 'hp-high' : hpPercent > 20 ? 'hp-mid' : 'hp-low';

  const boostEntries = (Object.entries(pokemon.boosts) as [string, number][]).filter(([, v]) => v !== 0);
  const setConfidence = useMemo(() => getSetConfidence(pokemon), [pokemon]);

  let formeLabel = pokemon.nickname || pokemon.species;
  const assumedDexName = resolveDexName(pokemon);
  if (assumedDexName !== pokemon.species) formeLabel = assumedDexName;
  if (pokemon.isTerastallized) formeLabel += ` (Tera ${pokemon.teraType ?? '?'})`;

  return (
    <div
      className={`pokemon-card ${pokemon.fainted ? 'fainted' : ''} ${compact ? 'compact' : ''} ${
        pokemon.switchedInThisTurn ? 'just-switched-in' : ''
      }`}
    >
      <div className="pokemon-card-header">
        <PokemonSprite
          species={pokemon.species}
          isMegaEvolved={assumedDexName !== pokemon.species}
          megaForme={assumedDexName !== pokemon.species ? assumedDexName : null}
          size={compact ? 28 : 40}
        />
        <span className="pokemon-name">{formeLabel}</span>
        <div className="header-badges">
          {pokemon.switchedInThisTurn && <span className="switch-badge">↩ entrée</span>}
          {pokemon.status && <span className={`status-badge status-${pokemon.status}`}>{pokemon.status}</span>}
        </div>
      </div>
      <SetConfidenceBadge confidence={setConfidence} compact={compact} />
      <div className="hp-bar-track">
        <div className={`hp-bar-fill ${hpColorClass}`} style={{ width: `${hpPercent}%` }} />
      </div>
      <div className="hp-text">
        {pokemon.fainted
          ? 'KO'
          : pokemon.hpIsPercentage
            ? `${Math.round(hpPercent)}%`
            : `${pokemon.currentHp}/${maxHp}`}
      </div>
      {!compact && boostEntries.length > 0 && (
        <div className="boosts-row">
          {boostEntries.map(([stat, value]) => (
            <span key={stat} className={`boost-chip ${value > 0 ? 'boost-up' : 'boost-down'}`}>
              {stat.toUpperCase()} {value > 0 ? `+${value}` : value}
            </span>
          ))}
        </div>
      )}
      {!compact && pokemon.revealedItem && (
        <div className="item-row">
          🎒 {pokemon.revealedItem}
          {pokemon.itemConsumed ? ' (consommé)' : ''}
        </div>
      )}
      {!compact && pokemon.revealedAbility && <div className="ability-row">✨ {pokemon.revealedAbility}</div>}
    </div>
  );
}

/**
 * Petit badge indiquant la fiabilité du set utilisé pour les calculs de
 * dégâts de ce Pokémon : set exact (PokéPaste), estimé (set de référence
 * NCP), ou par défaut (stats neutres, aucune estimation possible). Objectif
 * : que l'utilisateur ne prenne jamais un % de dégâts basé sur une
 * estimation pour une certitude.
 */
function SetConfidenceBadge({
  confidence,
  compact,
}: {
  confidence: ReturnType<typeof getSetConfidence>;
  compact?: boolean;
}) {
  if (confidence.kind === 'exact') {
    return (
      <span className="set-confidence-badge set-confidence-exact" title="Set exact (ton PokéPaste)">
        ✓ Set exact
      </span>
    );
  }
  if (confidence.kind === 'estimated') {
    return (
      <span
        className="set-confidence-badge set-confidence-estimated"
        title={`Set deviné (référence NCP : "${confidence.setName}") — peut différer du set réellement joué`}
      >
        🔍 {compact ? 'Estimé' : `Estimé : ${confidence.setName}`}
      </span>
    );
  }
  return (
    <span
      className="set-confidence-badge set-confidence-default"
      title="Aucun set connu ni de référence pour cette espèce — stats neutres (0 Stat Points), calculs peu fiables"
    >
      ? Stats par défaut
    </span>
  );
}

/** Un Pokémon adverse potentiellement ciblable, avec son statut réel dans CE combat. */
interface KnownTarget {
  key: string;
  pokemon: PokemonState;
  /** 'active' = sur le terrain, 'bench' = déjà vu ce combat mais pas actif, 'unseen' = annoncé en Team Preview mais jamais envoyé (Reg M-B bring 6, pick 4). */
  status: 'active' | 'bench' | 'unseen';
}

const TARGET_STATUS_ORDER: Record<KnownTarget['status'], number> = { active: 0, bench: 1, unseen: 2 };

/**
 * Tous les Pokémon vivants connus d'un côté, utilisables comme cible pour
 * un calcul de dégâts — y compris ceux annoncés en Team Preview mais
 * jamais encore envoyés sur le terrain (utile pour anticiper : "si Untel
 * arrive, qu'est-ce que je lui fais ?"), avec un statut explicite pour ne
 * jamais confondre un Pokémon réellement sur le terrain avec une simple
 * possibilité de Team Preview.
 */
/** Format Reg M-B : 6 Pokémon annoncés en Team Preview, mais seulement 4 réellement amenés en combat par côté. */
const MAX_TEAM_SIZE = 4;

/**
 * Tous les Pokémon vivants connus d'un côté, utilisables comme cible pour
 * un calcul de dégâts — y compris ceux annoncés en Team Preview mais
 * jamais encore envoyés sur le terrain (utile pour anticiper : "si Untel
 * arrive, qu'est-ce que je lui fais ?"), avec un statut explicite pour ne
 * jamais confondre un Pokémon réellement sur le terrain avec une simple
 * possibilité de Team Preview.
 *
 * Une fois que 4 Pokémon RÉELLEMENT envoyés (hasBeenSentOut) ont été vus
 * pour ce côté, l'équipe réelle est complète (Reg M-B n'en amène jamais
 * plus) : les entrées "jamais envoyées" restantes sont alors des fantômes
 * de Team Preview garantis ne jamais apparaître, et sont exclues plutôt
 * que de rester indéfiniment proposées comme "pas encore vu".
 */
function getKnownTargets(battle: BattleState, side: 'p1' | 'p2'): KnownTarget[] {
  const activeKeys = new Set(Object.values(battle.activeByPosition));
  const sidePokemon = Object.entries(battle.pokemonByKey).filter(([, p]) => p.side === side && !p.fainted);
  const sentOutCount = sidePokemon.filter(([, p]) => p.hasBeenSentOut).length;
  const rosterFull = sentOutCount >= MAX_TEAM_SIZE;

  return sidePokemon
    .filter(([, p]) => p.hasBeenSentOut || !rosterFull)
    .map(([key, p]) => ({
      key,
      pokemon: p,
      status: (activeKeys.has(key) ? 'active' : p.hasBeenSentOut ? 'bench' : 'unseen') as KnownTarget['status'],
    }))
    .sort((a, b) => TARGET_STATUS_ORDER[a.status] - TARGET_STATUS_ORDER[b.status]);
}

function MatchupsPanel({ battle, p1Name, p2Name }: { battle: BattleState; p1Name: string; p2Name: string }) {
  const p1Active = useMemo(() => getActivePokemon(battle, 'p1'), [battle]);
  const p2Active = useMemo(() => getActivePokemon(battle, 'p2'), [battle]);
  const p1Targets = useMemo(() => getKnownTargets(battle, 'p1'), [battle]);
  const p2Targets = useMemo(() => getKnownTargets(battle, 'p2'), [battle]);

  if (p1Active.length === 0 && p2Active.length === 0) {
    return (
      <div className="matchups-panel matchups-empty">Aucun Pokémon actif à ce stade du combat.</div>
    );
  }

  return (
    <div className="matchups-panel">
      <h3>Dégâts possibles ce tour</h3>
      <div className="matchups-columns">
        <div className="matchups-column">
          <h4 className="matchups-column-title matchups-column-p1">{p1Name} attaque</h4>
          <div className="attacker-move-cards">
            {p1Active.map((attacker) => (
              <AttackerMoveCard
                key={attacker.species}
                attacker={attacker}
                attackerSide="p1"
                battle={battle}
                targets={p2Targets}
              />
            ))}
          </div>
        </div>
        <div className="matchups-column">
          <h4 className="matchups-column-title matchups-column-p2">{p2Name} attaque</h4>
          <div className="attacker-move-cards">
            {p2Active.map((attacker) => (
              <AttackerMoveCard
                key={attacker.species}
                attacker={attacker}
                attackerSide="p2"
                battle={battle}
                targets={p1Targets}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Une carte par Pokémon actif attaquant : ses moves connus, et un sélecteur pour choisir la cible parmi les Pokémon adverses connus. */
type BoostKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe';
const BOOST_STAT_LABELS: [BoostKey, string][] = [
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
];

/** Rangée de +/- pour les 5 stats boostables, réutilisée pour l'attaquant et la cible. */
function BoostOverrideStepper({
  boosts,
  onAdjust,
}: {
  boosts: Record<BoostKey, number>;
  onAdjust: (key: BoostKey, delta: number) => void;
}) {
  return (
    <div className="boost-override-panel">
      {BOOST_STAT_LABELS.map(([key, label]) => (
        <div key={key} className="boost-override-stat">
          <span className="boost-override-label">{label}</span>
          <button
            className="boost-override-btn"
            onClick={() => onAdjust(key, -1)}
            disabled={boosts[key] <= -6}
          >
            −
          </button>
          <span className="boost-override-value">{boosts[key] > 0 ? `+${boosts[key]}` : boosts[key]}</span>
          <button
            className="boost-override-btn"
            onClick={() => onAdjust(key, 1)}
            disabled={boosts[key] >= 6}
          >
            +
          </button>
        </div>
      ))}
    </div>
  );
}

const ZERO_BOOSTS: Record<BoostKey, number> = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function AttackerMoveCard({
  attacker,
  attackerSide,
  battle,
  targets,
}: {
  attacker: PokemonState;
  attackerSide: 'p1' | 'p2';
  battle: BattleState;
  targets: KnownTarget[];
}) {
  const defaultTargetKey = targets.find((t) => t.status === 'active')?.key ?? targets[0]?.key ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultTargetKey);
  const [attackerBoostOverrides, setAttackerBoostOverrides] = useState<Record<BoostKey, number>>(attacker.boosts);
  const [defenderBoostOverrides, setDefenderBoostOverrides] = useState<Record<BoostKey, number>>(ZERO_BOOSTS);
  const [showAttackerBoosts, setShowAttackerBoosts] = useState(false);
  const [showDefenderBoosts, setShowDefenderBoosts] = useState(false);

  // Si la cible sélectionnée n'est plus valide (KO entretemps, tour changé...), retombe sur le défaut.
  useEffect(() => {
    if (selectedKey && targets.some((t) => t.key === selectedKey)) return;
    setSelectedKey(defaultTargetKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, defaultTargetKey]);

  // Réinitialise les stats hypothétiques de l'attaquant aux vraies stats à chaque changement de tour/Pokémon.
  useEffect(() => {
    setAttackerBoostOverrides(attacker.boosts);
  }, [attacker]);

  const selectedTarget = targets.find((t) => t.key === selectedKey) ?? null;

  // Réinitialise les stats hypothétiques de la cible aux vraies stats à chaque changement de cible sélectionnée.
  useEffect(() => {
    setDefenderBoostOverrides(selectedTarget?.pokemon.boosts ?? ZERO_BOOSTS);
  }, [selectedTarget?.key]);

  const confidence = useMemo(() => getSetConfidence(attacker), [attacker]);
  const moves = useMemo(() => getKnownMoves(attacker).filter((m) => isOffensiveMove(m.name)), [attacker]);
  const attackerLabel = attacker.nickname || attacker.species;

  const isAttackerBoostOverridden = BOOST_STAT_LABELS.some(
    ([key]) => attackerBoostOverrides[key] !== attacker.boosts[key],
  );
  const effectiveAttacker = useMemo(
    () => (isAttackerBoostOverridden ? { ...attacker, boosts: attackerBoostOverrides } : attacker),
    [attacker, attackerBoostOverrides, isAttackerBoostOverridden],
  );

  const realDefenderBoosts = selectedTarget?.pokemon.boosts ?? ZERO_BOOSTS;
  const isDefenderBoostOverridden = BOOST_STAT_LABELS.some(
    ([key]) => defenderBoostOverrides[key] !== realDefenderBoosts[key],
  );
  const effectiveDefender = useMemo(
    () =>
      selectedTarget && isDefenderBoostOverridden
        ? { ...selectedTarget.pokemon, boosts: defenderBoostOverrides }
        : selectedTarget?.pokemon,
    [selectedTarget, defenderBoostOverrides, isDefenderBoostOverridden],
  );

  function adjustAttackerBoost(key: BoostKey, delta: number) {
    setAttackerBoostOverrides((prev) => ({ ...prev, [key]: Math.max(-6, Math.min(6, prev[key] + delta)) }));
  }

  function adjustDefenderBoost(key: BoostKey, delta: number) {
    setDefenderBoostOverrides((prev) => ({ ...prev, [key]: Math.max(-6, Math.min(6, prev[key] + delta)) }));
  }

  return (
    <div className="attacker-move-card">
      <div className="attacker-move-card-header">
        <span className="attacker-move-card-name">{attackerLabel}</span>
        <SetConfidenceBadge confidence={confidence} compact />
      </div>

      {targets.length > 0 ? (
        <select
          className="target-select"
          value={selectedKey ?? ''}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>
              {(t.pokemon.nickname || t.pokemon.species) +
                (t.status === 'bench' ? ' (banc)' : t.status === 'unseen' ? ' (pas encore vu)' : '')}
            </option>
          ))}
        </select>
      ) : (
        <p className="attacker-move-card-empty">Aucune cible adverse connue.</p>
      )}

      <button className="boost-override-toggle" onClick={() => setShowAttackerBoosts((v) => !v)}>
        {showAttackerBoosts ? '▾' : '▸'} Boosts ({attackerLabel})
        {isAttackerBoostOverridden && (
          <span className="boost-override-active-dot" title="Stats modifiées par rapport au vrai combat" />
        )}
      </button>
      {showAttackerBoosts && (
        <>
          <BoostOverrideStepper boosts={attackerBoostOverrides} onAdjust={adjustAttackerBoost} />
          {isAttackerBoostOverridden && (
            <button
              className="boost-override-reset"
              onClick={() => setAttackerBoostOverrides(attacker.boosts)}
            >
              Réinitialiser
            </button>
          )}
        </>
      )}

      {selectedTarget && (
        <>
          <button className="boost-override-toggle" onClick={() => setShowDefenderBoosts((v) => !v)}>
            {showDefenderBoosts ? '▾' : '▸'} Boosts (cible)
            {isDefenderBoostOverridden && (
              <span className="boost-override-active-dot" title="Stats modifiées par rapport au vrai combat" />
            )}
          </button>
          {showDefenderBoosts && (
            <>
              <BoostOverrideStepper boosts={defenderBoostOverrides} onAdjust={adjustDefenderBoost} />
              {isDefenderBoostOverridden && (
                <button
                  className="boost-override-reset"
                  onClick={() => setDefenderBoostOverrides(realDefenderBoosts)}
                >
                  Réinitialiser
                </button>
              )}
            </>
          )}
        </>
      )}

      {moves.length === 0 && <p className="attacker-move-card-empty">Aucun move offensif connu pour l'instant.</p>}

      {selectedTarget && effectiveDefender && moves.length > 0 && (
        <div className="attacker-move-list">
          {moves.map((m) => (
            <MoveDamageRow
              key={m.name}
              moveName={m.name}
              attacker={effectiveAttacker}
              defender={effectiveDefender}
              attackerSide={attackerSide}
              battle={battle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Une ligne "NomDuMove — X% – Y%" au sein d'une AttackerMoveCard. */
function MoveDamageRow({
  moveName,
  attacker,
  defender,
  attackerSide,
  battle,
}: {
  moveName: string;
  attacker: PokemonState;
  defender: PokemonState;
  attackerSide: 'p1' | 'p2';
  battle: BattleState;
}) {
  const outcome = useMemo((): { status: 'ok'; result: DamageCalcResult } | { status: 'unsupported'; message: string } => {
    try {
      return { status: 'ok', result: calculateDamage(attacker, defender, moveName, battle, attackerSide) };
    } catch (err) {
      const message =
        err instanceof DexLookupError ? `"${err.entityName}" hors dex Champions` : `Erreur de calcul`;
      return { status: 'unsupported', message };
    }
  }, [attacker, defender, moveName, battle, attackerSide]);

  return (
    <div className="move-damage-row">
      <span className="move-damage-row-name">{moveName}</span>
      {outcome.status === 'ok' ? (
        <>
          <span className="move-damage-row-bar-track">
            <span
              className="move-damage-row-bar-fill"
              style={{ width: `${Math.min(100, outcome.result.maxPercent)}%` }}
            />
          </span>
          <span className="move-damage-row-percent">
            {outcome.result.minPercent}% – {outcome.result.maxPercent}%
          </span>
        </>
      ) : (
        <span className="move-damage-row-unsupported">{outcome.message}</span>
      )}
    </div>
  );
}

/** Nombre de parties jouées par candidat lors de l'analyse (bouton "Analyser") — quelques secondes par coup à ce volume. */
const MONTE_CARLO_GAMES = 3000;

interface MonteCarloActionResult {
  action: PlayerAction;
  result: MonteCarloResult;
}

type AnalysisState =
  | { status: 'idle' }
  | {
      status: 'running';
      /** Tous les coups à analyser, dans l'ordre où ils sont traités. */
      candidates: PlayerAction[];
      currentIndex: number;
      gamesPlayed: number;
      totalGames: number;
      winRateSoFar: number;
      /** Résultats déjà obtenus pour les coups précédents (affichés au fur et à mesure). */
      completed: MonteCarloActionResult[];
    }
  | { status: 'error'; message: string }
  | { status: 'done'; results: MonteCarloActionResult[] };

function describeActionShort(action: PlayerAction, battle: BattleState): string {
  if (action.kind === 'switch') {
    return `Switch (${action.incomingKey.split(':')[1] ?? action.incomingKey})`;
  }
  if (action.targetPositions.length === 0 || isSpreadMove(action.moveName)) {
    // Les moves de zone (Earthquake, Dazzling Gleam...) touchent toujours
    // automatiquement toutes les cibles valides — lister ces cibles
    // n'apporte rien, contrairement à un move single-target où le choix
    // de cible est une vraie décision à afficher.
    return action.moveName;
  }
  const targetLabels = action.targetPositions.map((pos) => {
    const key = battle.activeByPosition[pos];
    const pokemon = key ? battle.pokemonByKey[key] : null;
    return pokemon ? pokemon.nickname || pokemon.species : pos;
  });
  return `${action.moveName} → ${targetLabels.join(', ')}`;
}

function TurnAnalysisPanel({
  battle,
  p1Name,
  p2Name,
}: {
  battle: BattleState;
  p1Name: string;
  p2Name: string;
}) {
  const activePositions = Object.keys(battle.activeByPosition) as PokemonPosition[];

  if (activePositions.length === 0) {
    return null;
  }

  const p1Positions = activePositions.filter((p) => p.startsWith('p1'));
  const p2Positions = activePositions.filter((p) => p.startsWith('p2'));

  return (
    <div className="turn-analysis-panel">
      <h3>Analyse du tour — espérance de victoire par action</h3>
      <p className="turn-analysis-note">
        Pour chaque Pokémon actif, joue {MONTE_CARLO_GAMES} parties complètes jusqu'à la vraie fin du
        combat pour CHAQUE action possible ce tour, et affiche le % de victoires observées. Calcul à
        la demande (peut prendre plusieurs secondes, un coup après l'autre).
      </p>
      <p className="turn-analysis-note turn-analysis-note-warning">
        ⚠ Chaque partie simulée joue une ligne plausible mais pas forcément parfaite des deux côtés
        (ni un adversaire aléatoire, ni un adversaire optimal) — sur des milliers de parties la
        moyenne reste informative, mais quelques parties peuvent rester « non conclues » (tour
        limite de sécurité atteint) : elles sont indiquées et exclues du %.
      </p>
      <div className="turn-analysis-columns">
        <div className="turn-analysis-column">
          <h4 className="matchups-column-title matchups-column-p1">{p1Name}</h4>
          <div className="turn-analysis-grid">
            {p1Positions.map((position) => (
              <PositionAnalysisCard key={position} battle={battle} position={position} />
            ))}
          </div>
        </div>
        <div className="turn-analysis-column">
          <h4 className="matchups-column-title matchups-column-p2">{p2Name}</h4>
          <div className="turn-analysis-grid">
            {p2Positions.map((position) => (
              <PositionAnalysisCard key={position} battle={battle} position={position} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionAnalysisCard({
  battle,
  position,
}: {
  battle: BattleState;
  position: PokemonPosition;
}) {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });
  const [showAll, setShowAll] = useState(false);

  const pokemonKey = battle.activeByPosition[position];
  const pokemon = pokemonKey ? battle.pokemonByKey[pokemonKey] : null;

  async function handleAnalyze() {
    if (!pokemon) return;
    setShowAll(false);

    let candidates: PlayerAction[];
    try {
      candidates = generateActionsForPosition(battle, position);
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
      return;
    }

    if (candidates.length === 0) {
      setState({ status: 'done', results: [] });
      return;
    }

    setState({
      status: 'running',
      candidates,
      currentIndex: 0,
      gamesPlayed: 0,
      totalGames: MONTE_CARLO_GAMES,
      winRateSoFar: 50,
      completed: [],
    });

    const completed: MonteCarloActionResult[] = [];
    for (let idx = 0; idx < candidates.length; idx++) {
      const action = candidates[idx];
      try {
        const result = await runMonteCarloChunked(
          battle,
          position,
          action,
          null,
          { numGames: MONTE_CARLO_GAMES },
          (gamesPlayed, totalGames, winRateSoFar) => {
            setState({
              status: 'running',
              candidates,
              currentIndex: idx,
              gamesPlayed,
              totalGames,
              winRateSoFar,
              completed: [...completed],
            });
          },
        );
        completed.push({ action, result });
      } catch (err) {
        setState({ status: 'error', message: (err as Error).message });
        return;
      }
    }

    const sorted = [...completed].sort((a, b) => b.result.winRate - a.result.winRate);
    setState({ status: 'done', results: sorted });
  }

  if (!pokemon || pokemon.fainted) {
    return null;
  }

  const label = pokemon.nickname || pokemon.species;
  const best = state.status === 'done' ? state.results[0] : null;
  const isRunning = state.status === 'running';

  return (
    <div className="position-analysis-card">
      <div className="position-analysis-header">
        <span className="position-analysis-label">
          {label} ({position})
        </span>
        <button className="position-analysis-btn" onClick={handleAnalyze} disabled={isRunning}>
          {isRunning ? 'Simulation...' : state.status === 'done' ? 'Recalculer' : 'Analyser'}
        </button>
      </div>

      {state.status === 'error' && <p className="position-analysis-error">{state.message}</p>}

      {isRunning && (
        <p className="position-analysis-progress">
          Coup {state.currentIndex + 1}/{state.candidates.length} —{' '}
          {describeActionShort(state.candidates[state.currentIndex], battle)} : {state.gamesPlayed}/
          {state.totalGames} parties ({state.winRateSoFar}% pour l'instant)
        </p>
      )}

      {state.status === 'done' && state.results.length === 0 && (
        <p className="position-analysis-empty">
          Aucune action calculable : aucun move connu (révélé, PokéPaste, ou set deviné) pour ce
          Pokémon à ce tour.
        </p>
      )}

      {(isRunning ? state.completed : state.status === 'done' ? state.results : []).length > 0 && (
        <div className="action-ranking">
          {(showAll
            ? isRunning
              ? state.completed
              : state.status === 'done'
                ? state.results
                : []
            : (isRunning ? state.completed : state.status === 'done' ? state.results : []).slice(0, 3)
          ).map((entry, i) => (
            <div key={i}>
              <div
                className={`action-ranking-row ${best && entry === best ? 'action-ranking-best' : ''}`}
              >
                <span className="action-ranking-name">{describeActionShort(entry.action, battle)}</span>
                <div className="action-ranking-bar-track">
                  <div
                    className="action-ranking-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, entry.result.winRate))}%` }}
                  />
                </div>
                <span className="action-ranking-percent">{entry.result.winRate}%</span>
              </div>
            </div>
          ))}
          {best && (
            <p className="action-ranking-pv">
              {best.result.gamesWon + best.result.gamesLost + best.result.gamesDrawn} parties jouées
              jusqu'au bout
              {best.result.gamesInconclusive > 0 ? ` (${best.result.gamesInconclusive} non conclues, exclues)` : ''}
              {' '}— {best.result.averageTurnsToConclude} tours en moyenne.
            </p>
          )}
          {(state.status === 'done' ? state.results.length : 0) > 3 && (
            <button className="action-ranking-toggle" onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? 'Voir moins'
                : `Voir les ${(state.status === 'done' ? state.results.length : 0) - 3} autres options`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Extrait, dans l'ordre chronologique, les actions clés d'un tour (moves
 * joués, switches, K.O., météo, statuts, boosts) directement depuis les
 * lignes brutes du replay — c'est la trace RÉELLE de ce qui s'est passé,
 * pas une simulation.
 */
/** Icône par type d'action, pour un survol rapide du déroulé du tour. */
type ObservedActionKind = 'move' | 'switch' | 'faint' | 'weather' | 'status';

interface ObservedAction {
  side: 'p1' | 'p2';
  pokemonLabel: string;
  text: string;
  kind: ObservedActionKind;
}

const ACTION_ICONS: Record<ObservedActionKind, string> = {
  move: '⚔️',
  switch: '↩️',
  faint: '💀',
  weather: '🌦️',
  status: '⚠️',
};

const RAW_WEATHER_LABELS: Record<string, string> = {
  SunnyDay: 'Soleil',
  RainDance: 'Pluie',
  Sandstorm: 'Tempête de sable',
  Snowscape: 'Neige',
  Hail: 'Grêle',
  DesolateLand: 'Soleil extrême',
  PrimordialSea: 'Pluie diluvienne',
  none: 'Météo normale',
};

const STATUS_LABELS: Record<string, string> = {
  brn: 'brûlure',
  par: 'paralysie',
  psn: 'poison',
  tox: 'poison grave',
  slp: 'sommeil',
  frz: 'gel',
};

function extractObservedActions(parsedReplay: ParsedReplayLog, turnNumber: number): ObservedAction[] {
  const turnLines = parsedReplay.turns[turnNumber] ?? [];
  const actions: ObservedAction[] = [];

  for (const line of turnLines) {
    if (line.type === 'move') {
      const [identRaw, moveName, targetRaw] = line.args;
      const ident = parsePokemonIdent(identRaw);
      const side = ident.side as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') continue;
      const targetIdent = targetRaw ? parsePokemonIdent(targetRaw) : null;
      actions.push({
        side,
        pokemonLabel: ident.name,
        text: targetIdent && targetIdent.name !== ident.name ? `${moveName} → ${targetIdent.name}` : moveName,
        kind: 'move',
      });
    } else if (line.type === 'switch' || line.type === 'drag') {
      const [identRaw] = line.args;
      const ident = parsePokemonIdent(identRaw);
      const side = ident.side as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') continue;
      actions.push({ side, pokemonLabel: ident.name, text: 'entre sur le terrain', kind: 'switch' });
    } else if (line.type === 'faint') {
      const [identRaw] = line.args;
      const ident = parsePokemonIdent(identRaw);
      const side = ident.side as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') continue;
      actions.push({ side, pokemonLabel: ident.name, text: 'K.O.', kind: 'faint' });
    } else if (line.type === '-weather') {
      // [upkeep] = la météo continue simplement, pas un vrai changement à signaler.
      if (line.tags?.upkeep) continue;
      const [weatherRaw] = line.args;
      const label = RAW_WEATHER_LABELS[weatherRaw] ?? weatherRaw;
      actions.push({ side: 'p1', pokemonLabel: '', text: label, kind: 'weather' });
    } else if (line.type === '-status') {
      const [identRaw, statusRaw] = line.args;
      const ident = parsePokemonIdent(identRaw);
      const side = ident.side as 'p1' | 'p2';
      if (side !== 'p1' && side !== 'p2') continue;
      const label = STATUS_LABELS[statusRaw] ?? statusRaw;
      actions.push({ side, pokemonLabel: ident.name, text: `${label}`, kind: 'status' });
    }
  }

  return actions;
}

function TurnActionsLog({
  parsedReplay,
  turnNumber,
  battle,
}: {
  parsedReplay: ParsedReplayLog;
  turnNumber: number;
  battle: BattleState;
}) {
  const actions = useMemo(
    () => extractObservedActions(parsedReplay, turnNumber),
    [parsedReplay, turnNumber],
  );

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="turn-actions-log">
      <h3>Déroulé du tour (ordre réel)</h3>
      <ol className="turn-actions-list">
        {actions.map((a, i) => (
          <li key={i} className={`turn-action-item turn-action-${a.side} turn-action-kind-${a.kind}`}>
            <span className="turn-action-icon">{ACTION_ICONS[a.kind]}</span>
            {a.kind !== 'weather' && (
              <span className="turn-action-side-tag">{a.side === 'p1' ? 'P1' : 'P2'}</span>
            )}
            {a.pokemonLabel && <span className="turn-action-pokemon">{a.pokemonLabel}</span>}
            <span className="turn-action-text">{a.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
