import { useMemo, useState } from 'react';
import { fetchReplay, ReplayFetchError } from '../replay/fetcher';
import { parseReplayLog } from '../replay/logParser';
import { replayToStates } from '../engine/reducer';
import type { BattleState, PokemonState } from '../engine/state';
import { estimateWinProbability } from '../search/evaluator';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; states: BattleState[]; p1Name: string; p2Name: string };

export default function App() {
  //const [url, setUrl] = useState('https://replay.pokemonshowdown.com/gen9vgc2025reghbo3-2415622799',);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [turnIndex, setTurnIndex] = useState(0);

  async function handleAnalyze() {
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
    <div className={`pokemon-card ${pokemon.fainted ? 'fainted' : ''} ${compact ? 'compact' : ''}`}>
      <div className="pokemon-card-header">
        <span className="pokemon-name">{formeLabel}</span>
        {pokemon.status && <span className={`status-badge status-${pokemon.status}`}>{pokemon.status}</span>}
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
