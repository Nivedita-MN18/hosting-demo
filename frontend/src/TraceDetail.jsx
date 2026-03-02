import React, { useEffect, useMemo, useState } from 'react';

function buildTimeline(spans) {
  if (!spans || spans.length === 0) return { spans: [], totalDuration: 0 };

  const minTs = Math.min(...spans.map((s) => s.timestamp));
  const items = spans.map((s) => {
    const offsetMs = (s.timestamp - minTs) * 1000;
    return {
      ...s,
      offsetMs,
    };
  });

  const maxEnd = Math.max(
    ...items.map((s) => s.offsetMs + s.durationMs)
  );

  return { spans: items, totalDuration: maxEnd };
}

export function TraceDetail({ apiBase, traceId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${apiBase}/api/v1/traces/${traceId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Failed to load trace');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, traceId]);

  const timeline = useMemo(
    () => buildTimeline(data?.spans || []),
    [data]
  );

  const perService = useMemo(() => {
    const map = new Map();
    for (const s of data?.spans || []) {
      const list = map.get(s.service) || [];
      list.push(s);
      map.set(s.service, list);
    }
    return Array.from(map.entries()).map(([service, spans]) => {
      const total = spans.reduce((acc, cur) => acc + cur.durationMs, 0);
      const max = Math.max(...spans.map((s) => s.durationMs));
      return { service, total, max };
    });
  }, [data]);

  const bottleneck = useMemo(() => {
    if (!perService.length) return null;
    return perService.reduce((a, b) => (a.total > b.total ? a : b));
  }, [perService]);

  if (loading) return <p>Loading trace…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data || !data.spans || data.spans.length === 0) {
    return <p className="empty-state-small">No spans for this trace yet.</p>;
  }

  return (
    <div className="trace-detail">
      <div className="summary">
        <div>
          <div className="label">Trace ID</div>
          <div className="value code">{data.traceId}</div>
        </div>
        <div>
          <div className="label">Total Duration</div>
          <div className="value">
            {timeline.totalDuration.toFixed(1)} ms
          </div>
        </div>
        <div>
          <div className="label">Services</div>
          <div className="value">
            {perService.map((s) => s.service).join(', ')}
          </div>
        </div>
        {bottleneck && (
          <div className="bottleneck">
            <div className="label">Bottleneck</div>
            <div className="value">
              {bottleneck.service} –{' '}
              {bottleneck.total.toFixed(1)} ms total
            </div>
          </div>
        )}
      </div>

      <div className="timeline">
        <div className="timeline-header">
          <span>Service / Span</span>
          <span>Duration</span>
        </div>
        <div className="timeline-body">
          {timeline.spans.map((span) => {
            const widthPct =
              timeline.totalDuration > 0
                ? (span.durationMs / timeline.totalDuration) * 100
                : 0;
            const offsetPct =
              timeline.totalDuration > 0
                ? (span.offsetMs / timeline.totalDuration) * 100
                : 0;
            const isSlow = span.status === 'SLOW' || span.status === 'ERROR';

            return (
              <div key={`${span.service}-${span.span}-${span.timestamp}`} className="timeline-row">
                <div className="timeline-label">
                  <div className="service">{span.service}</div>
                  <div className="span-name">{span.span}</div>
                </div>
                <div className="timeline-bar-cell">
                  <div className="timeline-bar-track">
                    <div
                      className={`timeline-bar ${isSlow ? 'slow' : ''}`}
                      style={{
                        left: `${offsetPct}%`,
                        width: `${Math.max(widthPct, 1)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="timeline-duration">
                  {span.durationMs} ms · {span.status}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

