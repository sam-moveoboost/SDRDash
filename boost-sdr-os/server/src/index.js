// Server-side code for the SDR dashboard, hosted on monday code.
//
// First release: a health check and a stub briefing endpoint. The stub only
// proves the ANTHROPIC_API_KEY secret is readable. It does not call Claude yet.
// Secrets are never returned or logged.

const express = require('express');
const { EnvironmentVariablesManager } = require('@mondaycom/apps-sdk');

const app = express();
app.use(express.json());

// Not yet confirmed against a live deploy: monday code is expected to expose
// secrets as environment variables. If this reports false after deploy, the
// lookup below is the one place to change.
const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });

function getSecret(name) {
  if (process.env[name]) return process.env[name];
  try {
    return envManager.get(name) || undefined;
  } catch (_err) {
    return undefined;
  }
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'sdr-os-server' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Reports whether the secret exists, nothing more.
app.get('/briefing/status', (_req, res) => {
  const key = getSecret('ANTHROPIC_API_KEY');
  res.json({ ok: true, anthropicKeyConfigured: Boolean(key) });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`sdr-os-server listening on ${port}`));
