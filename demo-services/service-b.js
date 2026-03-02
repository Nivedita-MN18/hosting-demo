// Demo Service B - simple worker service

const express = require('express');
const { traceMiddleware } = require('../sdk/traceMiddleware');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(
  traceMiddleware('service-b', {
    backendUrl: process.env.TRACELITE_BACKEND_URL || 'http://localhost:4000',
    apiKey: process.env.TRACELITE_API_KEY,
  })
);

app.get('/work', (req, res) => {
  // Simulate some CPU work
  const start = Date.now();
  while (Date.now() - start < 50) {
    // busy loop for ~50ms
  }
  res.json({ service: 'b', status: 'ok', traceId: req.traceId });
});

app.listen(PORT, () => {
  console.log(`Demo Service B listening on port ${PORT}`);
});

