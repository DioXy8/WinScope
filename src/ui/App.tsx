import { useState } from 'react';
import { fetchReplay, ReplayFetchError } from '../replay/fetcher';
import { parseReplayLog } from '../replay/logParser';
import type { ParsedReplayLog } from '../replay/types';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; parsed: ParsedReplayLog; rawLogLength: number };

export default function App() {
  const [url, setUrl] = useState(
    'https://replay.pokemonshowdown.com/gen9vgc2025reghbo3-2415622799',
  );
  const [state, setState] = useState<LoadState>({ status: 'idle' });

  async function handleAnalyze() {
    setState({ status: 'loading' });
    try {
      const raw = await fetchReplay(url);
      const parsed = parseReplayLog(raw.log);
      setState({ status: 'success', parsed, rawLogLength: raw.log.length });
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
        <p className="subtitle">Analyseur de replays Pokémon VGC — étape 1 : fetch &amp; parse</p>
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

      {state.status === 'success' && <ReplaySummary parsed={state.parsed} rawLogLength={state.rawLogLength} />}
    </div>
  );
}

function ReplaySummary({
  parsed,
  rawLogLength,
}: {
  parsed: ParsedReplayLog;
  rawLogLength: number;
}) {
  return (
    <section className="summary">
      <h2>✅ Replay récupéré et parsé avec succès</h2>

      <div className="summary-grid">
        <div>
          <strong>Format :</strong> {parsed.tier || parsed.format}
        </div>
        <div>
          <strong>Type de combat :</strong> {parsed.gametype}
        </div>
        <div>
          <strong>Génération :</strong> {parsed.genNum}
        </div>
        <div>
          <strong>Taille du log brut :</strong> {rawLogLength} caractères
        </div>
        <div>
          <strong>Nombre de tours :</strong> {Math.max(0, parsed.turns.length - 1)}
        </div>
        <div>
          <strong>Vainqueur :</strong> {parsed.winner ?? (parsed.isTie ? 'Égalité' : '—')}
        </div>
      </div>

      <h3>Joueurs</h3>
      <ul>
        {parsed.players.map((p) => (
          <li key={p.side}>
            {p.side} — {p.username} {p.rating ? `(${p.rating} ELO)` : ''}
          </li>
        ))}
      </ul>

      <h3>Team Preview</h3>
      {(['p1', 'p2'] as const).map((side) => (
        <div key={side} className="team-block">
          <strong>{side}</strong>
          <ul>
            {parsed.teamPreview
              .filter((p) => p.side === side)
              .map((p, i) => (
                <li key={i}>
                  {p.details.species}
                  {p.details.formeUnknown ? ' (forme inconnue)' : ''}
                  {p.hasItem ? ' — objet présent' : ' — pas d’objet'}
                </li>
              ))}
          </ul>
        </div>
      ))}

      <h3>Aperçu des tours (lignes brutes)</h3>
      <div className="turns-preview">
        {parsed.turns.slice(0, 4).map((turnLines, turnIndex) => (
          <details key={turnIndex} open={turnIndex < 2}>
            <summary>Tour {turnIndex} ({turnLines.length} lignes)</summary>
            <pre>{turnLines.map((l) => l.raw).join('\n')}</pre>
          </details>
        ))}
        {parsed.turns.length > 4 && <p>… et {parsed.turns.length - 4} tours de plus.</p>}
      </div>
    </section>
  );
}
