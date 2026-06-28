import { useMemo, useState } from 'react';
import { fetchReplay, ReplayFetchError } from '../replay/fetcher';
import { parseReplayLog } from '../replay/logParser';
import { replayToStates } from '../engine/reducer';
import type { BattleState, PokemonState } from '../engine/state';
import { estimateWinProbability } from '../search/evaluator';
import { calculateDamage, DexLookupError } from '../damagecalc/damageCalc';
import type { DamageCalcResult } from '../damagecalc/damageCalc';
import { analyzeActionsForPosition } from '../search/turnAnalyzer';
import type { ActionScore } from '../search/turnAnalyzer';
import type { PlayerAction } from '../search/actionTypes';
import type { PokemonPosition } from '../replay/types';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; states: BattleState[]; p1Name: string; p2Name: string };

export default function App() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [turnIndex, setTurnIndex] = useState(0);

  async function handleAnalyze() {
    if (!url.trim()) {
      setState({ status: 'error', message: 'Colle une URL de replay Showdown avant de lancer l’analyse.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const raw = await fetchReplay(url);
      const parsed = parseReplayLog(raw.log);
      const states = replayToStates(parsed);
      const p1Name = parsed.players.find((p) => p.side === 'p1')?.username ?? 'Joueur 1';
      const p2Name = parsed.players.find((p) => p.side === 'p2')?.username ?? 'Joueur 2';
      setState({ status: 'success', states, p1Name, p2Name });
      setTurnIndex(states.length - 1);
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

      {state.status === 'success' && (
        <BattleExplorer
          states={state.states}
          p1Name={state.p1Name}
          p2Name={state.p2Name}
          turnIndex={turnIndex}
          onTurnChange={setTurnIndex}
        />
      )}
    </div>
  );
}

function BattleExplorer({
  states,
  p1Name,
  p2Name,
  turnIndex,
  onTurnChange,
}: {
  states: BattleState[];
  p1Name: string;
  p2Name: string;
  turnIndex: number;
  onTurnChange: (index: number) => void;
}) {
  const current = states[turnIndex];

  const winProbabilities = useMemo(() => states.map((s) => estimateWinProbability(s)), [states]);
  const currentWinP1 = winProbabilities[turnIndex];

  const p1Active = useMemo(() => getActivePokemon(current, 'p1'), [current]);
  const p2Active = useMemo(() => getActivePokemon(current, 'p2'), [current]);
  const p1Bench = useMemo(() => getBenchPokemon(current, 'p1'), [current]);
  const p2Bench = useMemo(() => getBenchPokemon(current, 'p2'), [current]);

  return (
    <section className="explorer">
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

      <WinBar p1Name={p1Name} p2Name={p2Name} p1Percent={currentWinP1} />

      <WinHistory probabilities={winProbabilities} currentIndex={turnIndex} onSelect={onTurnChange} />

      <FieldSummary battle={current} />

      <MatchupsPanel battle={current} />

      <TurnAnalysisPanel battle={current} />

      <div className="sides-grid">
        <SideColumn label={p1Name} active={p1Active} bench={p1Bench} sideState={current.sides.p1} />
        <SideColumn label={p2Name} active={p2Active} bench={p2Bench} sideState={current.sides.p2} />
      </div>
    </section>
  );
}

function getActivePokemon(battle: BattleState, side: 'p1' | 'p2'): PokemonState[] {
  const keys = Object.entries(battle.activeByPosition)
    .filter(([pos]) => pos.startsWith(side))
    .map(([, key]) => key);
  return keys.map((key) => battle.pokemonByKey[key]).filter((p): p is PokemonState => Boolean(p));
}

function getBenchPokemon(battle: BattleState, side: 'p1' | 'p2'): PokemonState[] {
  const activeKeys = new Set(Object.values(battle.activeByPosition));
  return Object.entries(battle.pokemonByKey)
    .filter(([key, p]) => p.side === side && !activeKeys.has(key))
    .map(([, p]) => p);
}

function WinBar({
  p1Name,
  p2Name,
  p1Percent,
}: {
  p1Name: string;
  p2Name: string;
  p1Percent: number;
}) {
  return (
    <div className="winbar-container">
      <div className="winbar-labels">
        <span>
          {p1Name} — {p1Percent}%
        </span>
        <span>
          {p2Name} — {100 - p1Percent}%
        </span>
      </div>
      <div className="winbar-track">
        <div className="winbar-fill-p1" style={{ width: `${p1Percent}%` }} />
        <div className="winbar-fill-p2" style={{ width: `${100 - p1Percent}%` }} />
      </div>
    </div>
  );
}

function WinHistory({
  probabilities,
  currentIndex,
  onSelect,
}: {
  probabilities: number[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const width = 600;
  const height = 80;
  const padding = 8;
  const stepX = probabilities.length > 1 ? (width - padding * 2) / (probabilities.length - 1) : 0;

  const points = probabilities
    .map((p, i) => {
      const x = padding + i * stepX;
      const y = padding + (height - padding * 2) * (1 - p / 100);
      return `${x},${y}`;
    })
    .join(' ');

  const currentX = padding + currentIndex * stepX;
  const currentY = padding + (height - padding * 2) * (1 - probabilities[currentIndex] / 100);

  return (
    <div className="win-history">
      <svg viewBox={`0 0 ${width} ${height}`} className="win-history-svg">
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} className="win-history-midline" />
        <polyline points={points} className="win-history-line" fill="none" />
        <circle cx={currentX} cy={currentY} r={4} className="win-history-dot" />
      </svg>
      <input
        type="range"
        min={0}
        max={probabilities.length - 1}
        value={currentIndex}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="win-history-range"
      />
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

function PokemonCard({ pokemon, compact }: { pokemon: PokemonState; compact?: boolean }) {
  const maxHp = pokemon.maxHp ?? 100;
  const hpPercent = pokemon.fainted ? 0 : Math.max(0, Math.min(100, (pokemon.currentHp / maxHp) * 100));
  const hpColorClass = hpPercent > 50 ? 'hp-high' : hpPercent > 20 ? 'hp-mid' : 'hp-low';

  const boostEntries = (Object.entries(pokemon.boosts) as [string, number][]).filter(([, v]) => v !== 0);

  let formeLabel = pokemon.nickname || pokemon.species;
  if (pokemon.isMegaEvolved) formeLabel = pokemon.megaForme ?? `${formeLabel} (Mega)`;
  if (pokemon.isTerastallized) formeLabel += ` (Tera ${pokemon.teraType ?? '?'})`;

  return (
    <div
      className={`pokemon-card ${pokemon.fainted ? 'fainted' : ''} ${compact ? 'compact' : ''} ${
        pokemon.switchedInThisTurn ? 'just-switched-in' : ''
      }`}
    >
      <div className="pokemon-card-header">
        <span className="pokemon-name">{formeLabel}</span>
        <div className="header-badges">
          {pokemon.switchedInThisTurn && <span className="switch-badge">↩ entrée</span>}
          {pokemon.status && <span className={`status-badge status-${pokemon.status}`}>{pokemon.status}</span>}
        </div>
      </div>
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

type MatchupEntry =
  | {
      status: 'ok';
      attackerLabel: string;
      defenderLabel: string;
      moveName: string;
      result: DamageCalcResult;
    }
  | {
      status: 'unsupported';
      attackerLabel: string;
      defenderLabel: string;
      moveName: string;
      message: string;
    };

function computeMatchups(battle: BattleState): MatchupEntry[] {
  const p1Active = getActivePokemon(battle, 'p1');
  const p2Active = getActivePokemon(battle, 'p2');
  const entries: MatchupEntry[] = [];

  const pairs: [PokemonState[], PokemonState[], 'p1' | 'p2'][] = [
    [p1Active, p2Active, 'p1'],
    [p2Active, p1Active, 'p2'],
  ];

  for (const [attackers, defenders, attackerSide] of pairs) {
    for (const attacker of attackers) {
      if (attacker.fainted || attacker.revealedMoves.length === 0) continue;
      for (const defender of defenders) {
        if (defender.fainted) continue;
        for (const moveName of attacker.revealedMoves) {
          const attackerLabel = attacker.nickname || attacker.species;
          const defenderLabel = defender.nickname || defender.species;
          try {
            const result = calculateDamage(attacker, defender, moveName, battle, attackerSide);
            entries.push({ status: 'ok', attackerLabel, defenderLabel, moveName, result });
          } catch (err) {
            const message =
              err instanceof DexLookupError
                ? `"${err.name}" hors dex Champions`
                : `Erreur de calcul (${(err as Error).message})`;
            entries.push({ status: 'unsupported', attackerLabel, defenderLabel, moveName, message });
          }
        }
      }
    }
  }

  return entries;
}

function MatchupsPanel({ battle }: { battle: BattleState }) {
  const matchups = useMemo(() => computeMatchups(battle), [battle]);

  const okMatchups = matchups.filter((m): m is MatchupEntry & { status: 'ok' } => m.status === 'ok');
  const unsupported = matchups.filter(
    (m): m is MatchupEntry & { status: 'unsupported' } => m.status === 'unsupported',
  );
  const uniqueUnsupportedNames = Array.from(
    new Set(unsupported.map((m) => m.message)),
  );

  if (matchups.length === 0) {
    return (
      <div className="matchups-panel matchups-empty">
        Aucun move révélé encore utilisable pour calculer des dégâts à ce stade du combat.
      </div>
    );
  }

  return (
    <div className="matchups-panel">
      <h3>Dégâts possibles ce tour</h3>
      <div className="matchups-grid">
        {okMatchups.map((m, i) => (
          <div key={i} className="matchup-card">
            <div className="matchup-header">
              <span className="matchup-attacker">{m.attackerLabel}</span>
              <span className="matchup-move">{m.moveName}</span>
              <span className="matchup-arrow">→</span>
              <span className="matchup-defender">{m.defenderLabel}</span>
            </div>
            <div className="matchup-bar-track">
              <div
                className="matchup-bar-fill"
                style={{ width: `${Math.min(100, m.result.maxPercent)}%` }}
              />
            </div>
            <div className="matchup-percent">
              {m.result.minPercent}% – {m.result.maxPercent}%
              {m.result.maxPercent >= 100 && <span className="matchup-ko-tag"> KO possible</span>}
            </div>
          </div>
        ))}
      </div>
      {uniqueUnsupportedNames.length > 0 && (
        <p className="matchups-unsupported-note">
          Non calculable (hors dex Champions actuelle) : {uniqueUnsupportedNames.join(' · ')}
        </p>
      )}
    </div>
  );
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; scores: ActionScore[] };

function describeActionShort(action: PlayerAction): string {
  if (action.kind === 'switch') {
    return `Switch (${action.incomingKey.split(':')[1] ?? action.incomingKey})`;
  }
  if (action.targetPositions.length === 0) {
    return action.moveName;
  }
  return `${action.moveName} → ${action.targetPositions.join(', ')}`;
}

function TurnAnalysisPanel({ battle }: { battle: BattleState }) {
  const activePositions = Object.keys(battle.activeByPosition) as PokemonPosition[];

  if (activePositions.length === 0) {
    return null;
  }

  return (
    <div className="turn-analysis-panel">
      <h3>Analyse du tour — espérance de victoire par action</h3>
      <p className="turn-analysis-note">
        Pour chaque Pokémon actif, compare ses actions possibles ce tour en simulant les réponses
        adverses plausibles. Calcul à la demande (peut prendre quelques instants).
      </p>
      <div className="turn-analysis-grid">
        {activePositions.map((position) => (
          <PositionAnalysisCard key={position} battle={battle} position={position} />
        ))}
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

  const pokemonKey = battle.activeByPosition[position];
  const pokemon = pokemonKey ? battle.pokemonByKey[pokemonKey] : null;

  function handleAnalyze() {
    if (!pokemon) return;
    setState({ status: 'loading' });
    requestAnimationFrame(() => {
      try {
        const scores = analyzeActionsForPosition(battle, position, null);
        setState({ status: 'done', scores });
      } catch (err) {
        setState({ status: 'error', message: (err as Error).message });
      }
    });
  }

  if (!pokemon || pokemon.fainted) {
    return null;
  }

  const label = pokemon.nickname || pokemon.species;
  const best = state.status === 'done' ? state.scores[0] : null;

  return (
    <div className="position-analysis-card">
      <div className="position-analysis-header">
        <span className="position-analysis-label">
          {label} ({position})
        </span>
        <button
          className="position-analysis-btn"
          onClick={handleAnalyze}
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Calcul...' : state.status === 'done' ? 'Recalculer' : 'Analyser'}
        </button>
      </div>

      {state.status === 'error' && <p className="position-analysis-error">{state.message}</p>}

      {state.status === 'done' && (
        <div className="action-ranking">
          {state.scores.map((score, i) => (
            <div
              key={i}
              className={`action-ranking-row ${best && score === best ? 'action-ranking-best' : ''}`}
            >
              <span className="action-ranking-name">{describeActionShort(score.action)}</span>
              <div className="action-ranking-bar-track">
                <div
                  className="action-ranking-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, score.winExpectancy))}%` }}
                />
              </div>
              <span className="action-ranking-percent">{score.winExpectancy}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
