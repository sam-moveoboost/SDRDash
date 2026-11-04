// Reads secrets saved in the monday code Secrets tab. Values are never logged or returned.

const { SecretsManager, EnvironmentVariablesManager } = require('@mondaycom/apps-sdk');

const normalise = (k) => String(k).replace(/[^a-z0-9]/gi, '').toLowerCase();

let managers;
function getManagers() {
  if (!managers) managers = [new SecretsManager(), new EnvironmentVariablesManager({ updateProcessEnv: true })];
  return managers;
}

function listKeys(manager) {
  try {
    return manager.getKeys() || [];
  } catch (_err) {
    return [];
  }
}

// Secrets tab first, then Environment variables, then process.env.
function getSecret(name) {
  if (process.env[name]) return process.env[name];
  for (const manager of getManagers()) {
    try {
      const exact = manager.get(name);
      if (exact) return exact;
      const match = listKeys(manager).find((k) => normalise(k) === normalise(name));
      if (match) {
        const value = manager.get(match);
        if (value) return value;
      }
    } catch (_err) {
      // try the next source
    }
  }
  return undefined;
}

module.exports = { getSecret, listKeys, getManagers };
