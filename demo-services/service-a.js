// Demo Service A - entrypoint service
// Simulates a request fan-out across Service B and C with a slow DB span.

const express = require('express');
const http = require('http');
const { traceMiddleware } = require('../sdk/traceMiddleware');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(
  traceMiddleware('service-a', {
    backendUrl: process.env.TRACELITE_BACKEND_URL || 'http://localhost:4000',
    apiKey: process.env.TRACELITE_API_KEY,
  })
);

app.get('/demo', (req, res) => {
  const client = req.traceHttpClient;

  // Call Service B
  client.httpRequest(
    {
      hostname: 'localhost',
      port: 5002,
      path: '/work',
      method: 'GET',
    },
    (bRes) => {
      bRes.on('data', () => {});
      bRes.on('end', () => {
        // Call Service C which has a slow span
        client.httpRequest(
          {
            hostname: 'localhost',
            port: 5003,
            path: '/slow-db',
            method: 'GET',
          },
          (cRes) => {
            cRes.on('data', () => {});
            cRes.on('end', () => {
              res.json({
                message: 'Demo request completed across services A -> B -> C',
                traceId: req.traceId,
              });
            });
          }
        ).end();
      });
    }
  ).end();
});

app.listen(PORT, () => {
  console.log(`Demo Service A listening on port ${PORT}`);
});

