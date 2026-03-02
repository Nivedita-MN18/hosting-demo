import React, { useEffect, useState } from 'react';

export function TraceSearch({ apiBase, onSelectTrace }) {
  const [traceIdInput, setTraceIdInput] = useState('');
  const [service, setService] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchByFilters() {
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (service) params.set('service', service);
    if (status) params.set('status', status);

    const url = `${apiBase}/api/v1/traces?${params.toString()}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Group by traceId, then show most recent per trace
      const byTrace = new Map();
      for (const span of data.spans || []) {
        const list = byTrace.get(span.traceId) || [];
        list.push(span);
        byTrace.set(span.traceId, list);
      }

      const grouped = Array.from(byTrace.entries()).map(
        ([traceId, spans]) => {
          const start = Math.min(...spans.map((s) => s.timestamp));
          const end = Math.max(
            ...spans.map((s) => s.timestamp + s.durationMs / 1000)
          );
          const totalDuration = (end - start) * 1000;
          return {
            traceId,
            spanCount: spans.length,
            services: Array.from(new Set(spans.map((s) => s.service))),
            totalDuration,
          };
        }
      );

      grouped.sort((a, b) => b.totalDuration - a.totalDuration);
      setResults(grouped);
    } catch (err) {
      console.error(err);
      setError('Failed to load traces');
    } finally {
      setLoading(false);
    }
  }

  async function fetchByTraceId() {
    if (!traceIdInput) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${apiBase}/api/v1/traces/${traceIdInput}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.traceId) throw new Error('No trace returned');
      onSelectTrace(data.traceId);
    } catch (err) {
      console.error(err);
      setError('Trace not found');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchByFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="trace-search">
      <div className="search-row">
        <label className="field">
          <span>Trace ID</span>
          <input
            type="text"
            value={traceIdInput}
            onChange={(e) => setTraceIdInput(e.target.value)}
            placeholder="Paste a traceId from your service logs"
          />
        </label>
        <button onClick={fetchByTraceId} disabled={loading || !traceIdInput}>
          Go
        </button>
      </div>

      <div className="filters">
        <label className="field">
          <span>Service</span>
          <input
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="service-a"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Any</option>
            <option value="OK">OK</option>
            <option value="SLOW">SLOW</option>
            <option value="ERROR">ERROR</option>
          </select>
        </label>
        <button onClick={fetchByFilters} disabled={loading}>
          Search
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="results">
        {loading && <p>Loading traces…</p>}
        {!loading && results.length === 0 && (
          <p className="empty-state-small">No traces yet – run the demo flow.</p>
        )}
        {results.map((row) => (
          <button
            key={row.traceId}
            className="trace-row"
            onClick={() => onSelectTrace(row.traceId)}
          >
            <div>
              <div className="trace-id">{row.traceId}</div>
              <div className="meta">
                {row.spanCount} spans ·{' '}
                {row.services.length} services
              </div>
            </div>
            <div className="duration">
              {row.totalDuration.toFixed(1)} ms
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

