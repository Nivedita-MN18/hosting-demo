// TraceLite Node.js middleware SDK
// Express-compatible middleware that:
// - Ensures every request has a traceId
// - Reads/writes the X-Trace-Id header
// - Attaches traceId to req.context
// - Propagates traceId to downstream HTTP calls
// - Emits spans to TraceLite backend

const crypto = require('crypto');
const http = require('http');
const https = require('https');

function generateTraceId() {
  return crypto.randomUUID();
}

/**
 * Wrap http/https request to automatically propagate X-Trace-Id header
 * for outgoing calls. This is intentionally minimal and opt-in.
 */
function createHttpClient(traceId) {
  function wrapRequest(origRequest) {
    return (options, callback) => {
      const opts =
        typeof options === 'string'
          ? new URL(options)
          : { ...(options || {}) };

      opts.headers = opts.headers || {};
      opts.headers['X-Trace-Id'] = traceId;

      return origRequest(opts, callback);
    };
  }

  return {
    httpRequest: wrapRequest(http.request),
    httpsRequest: wrapRequest(https.request),
  };
}

/**
 * Create TraceLite middleware.
 *
 * @param {string} serviceName - Logical name of the service, e.g. "order-service"
 * @param {object} options
 * @param {string} options.backendUrl - Base URL of TraceLite backend (e.g. http://localhost:4000)
 * @param {string} [options.apiKey] - API key for TraceLite backend
 */
function traceMiddleware(serviceName, options) {
  if (!serviceName) throw new Error('traceMiddleware requires a serviceName');
  const backendUrl =
    (options && options.backendUrl) || process.env.TRACELITE_BACKEND_URL;
  const apiKey = (options && options.apiKey) || process.env.TRACELITE_API_KEY;

  if (!backendUrl) {
    // Fail fast in development; in production this should be configured
    console.warn(
      '[TraceLite] backendUrl is not configured; spans will not be sent'
    );
  }

  return function traceliteMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const incomingTraceId =
      req.header('x-trace-id') || req.header('X-Trace-Id');
    const traceId = incomingTraceId || generateTraceId();

    // Expose traceId and helper for downstream code
    req.traceId = traceId;
    req.context = req.context || {};
    req.context.traceId = traceId;

    // Attach simple http client helpers for downstream propagation
    req.traceHttpClient = createHttpClient(traceId);

    // Ensure traceId is visible to downstream handlers and responses
    res.setHeader('X-Trace-Id', traceId);

    function emitSpan(status) {
      if (!backendUrl) return;

      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;

      const spanPayload = {
        traceId,
        service: serviceName,
        span: `${req.method} ${req.path}`,
        durationMs: Math.round(durationMs),
        status,
        timestamp: Math.floor(Date.now() / 1000),
      };

      try {
        const url = new URL('/api/v1/traces', backendUrl);
        const payloadStr = JSON.stringify(spanPayload);

        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadStr),
          },
        };

        if (apiKey) {
          requestOptions.headers['x-api-key'] = apiKey;
        }

        const spanReq = client.request(requestOptions, (spanRes) => {
          // Fire-and-forget; drain data to avoid socket hangups
          spanRes.on('data', () => {});
        });

        spanReq.on('error', (err) => {
          // Never break the user request; log and continue
          console.warn('[TraceLite] failed to emit span', err.message);
        });

        spanReq.write(payloadStr);
        spanReq.end();
      } catch (err) {
        console.warn('[TraceLite] error constructing span request', err.message);
      }
    }

    // Hook into response lifecycle
    res.on('finish', () => {
      let status = 'OK';
      if (res.statusCode >= 500) status = 'ERROR';
      else if (res.statusCode >= 400) status = 'SLOW'; // treat client issues as degraded

      emitSpan(status);
    });

    next();
  };
}

module.exports = {
  traceMiddleware,
};

