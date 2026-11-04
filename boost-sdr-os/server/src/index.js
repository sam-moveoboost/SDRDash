// Server-side code for the SDR dashboard, hosted on monday code.
//
// /health and /briefing/status are open. Everything under /coaching requires a
// valid monday session token and is filtered per person on the server.

const express = require('express');
const { getSecret } = require('./lib/secrets');
const { createRouter } = require('./routes/coaching');

const app = express();

// The dashboard runs inside monday, so allow monday's own origins only.
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*monday\.(app|com)$/i;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/', (_req, res) => res.json({ ok: true, service: 'sdr-os-server' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Reports which secrets are set, never their values.
app.get('/briefing/status', (_req, res) => {
  res.json({
    ok: true,
    anthropicKeyConfigured: Boolean(getSecret('ANTHROPIC_API_KEY')),
    mondayTokenConfigured: Boolean(getSecret('MONDAY_API_TOKEN')),
    mondayClientSecretConfigured: Boolean(getSecret('MONDAY_CLIENT_SECRET')),
  });
});

app.use('/coaching', createRouter());

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`sdr-os-server listening on ${port}`));
