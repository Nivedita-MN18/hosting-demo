import React, { useState } from 'react';
import { TraceSearch } from './TraceSearch';
import { TraceDetail } from './TraceDetail';

export function App() {
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [apiBase, setApiBase] = useState(
    import.meta.env.VITE_API_BASE || 'http://localhost:4000'
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>TraceLite</h1>
          <p className="subtitle">
            Lightweight distributed tracing – follow a request across services.
          </p>
        </div>
        <div className="header-controls">
          <label className="field">
            <span>API Base URL</span>
            <input
              type="text"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:4000"
            />
          </label>
        </div>
      </header>

      <main className="layout">
        <section className="panel left">
          <h2>Trace Search</h2>
          <TraceSearch apiBase={apiBase} onSelectTrace={setSelectedTraceId} />
        </section>
        <section className="panel right">
          <h2>Trace Detail</h2>
          {selectedTraceId ? (
            <TraceDetail apiBase={apiBase} traceId={selectedTraceId} />
          ) : (
            <p className="empty-state">
              Select a trace from the left or paste a traceId to see the full
              request timeline.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

