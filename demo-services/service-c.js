// Demo Service C - slow DB-like operation to show bottleneck

const express = require('express');
const { traceMiddleware } = require('../sdk/traceMiddleware');

const app = express();
const PORT = process.env.PORT || 5003;

app.use(
  traceMiddleware('service-c', {
    backendUrl: process.env.TRACELITE_BACKEND_URL || 'http://localhost:4000',
    apiKey: process.env.TRACELITE_API_KEY,
  })
);

app.get('/slow-db', async (req, res) => {
  // Simulate slow database call ~800ms
  await new Promise((resolve) => setTimeout(resolve, 800));
  res.json({ service: 'c', status: 'ok', traceId: req.traceId });
});

app.listen(PORT, () => {
  console.log(`Demo Service C listening on port ${PORT}`);
});

