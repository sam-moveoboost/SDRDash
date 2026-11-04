// Server-side code for the SDR dashboard, hosted on monday code.
//
// First release: a health check and a stub briefing endpoint. The stub only
// proves the ANTHROPIC_API_KEY secret is readable. It does not call Claude yet.
// Secrets are never returned or logged.

const fs = require('fs');
const express = require('express');
const { EnvironmentVariablesManager } = require('@mondaycom/apps-sdk');

const app = express();
app.use(express.json());

// Not yet confirmed against a live deploy: monday code is expected to expose
// secrets as environment variables. If this reports false after deploy, the
// lookup below is the one place to change.
const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });

const normalise = (k) => String(k).replace(/[^a-z0-9]/gi, '').toLowerCase();

function listKeys() {
  try {
    return envManager.getKeys() || [];
  } catch (_err) {
    return [];
  }
}

// Exact match first, then a looser match on the name in case monday stores it
// in a different case or format.
function getSecret(name) {
  if (process.env[name]) return process.env[name];
  try {
    const exact = envManager.get(name);
    if (exact) return exact;
    const match = listKeys().find((k) => normalise(k) === normalise(name));
    return match ? envManager.get(match) || undefined : undefined;
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

// Temporary diagnostics: setting NAMES only, never values. Remove once the key
// is confirmed working.
app.get('/briefing/diagnostics', (_req, res) => {
  const looksRelevant = /anthropic|secret|api|key|claude/i;
  res.json({
    ok: true,
    secretFileNameSet: Boolean(process.env.SECRET_NAME),
    secretFileExists: Boolean(process.env.SECRET_NAME) && fs.existsSync(`/secrets/${process.env.SECRET_NAME}`),
    managerKeyNames: listKeys(),
    processEnvNamesMatching: Object.keys(process.env).filter((k) => looksRelevant.test(k)),
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`sdr-os-server listening on ${port}`));
