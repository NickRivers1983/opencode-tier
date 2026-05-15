/**
 * opencode-tier — Config manager
 * ────────────────────────────────
 * Reads, manipulates, and writes OpenCode's opencode.json
 * with atomic file operations and automatic timestamped backups.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Default path for OpenCode config (auto-detected). */
function defaultConfigPath() {
  // Respect OPENCODE_CONFIG env var if set
  if (process.env.OPENCODE_CONFIG) {
    return path.resolve(process.env.OPENCODE_CONFIG);
  }
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

/** Data directory for tier state, logs, and backups. */
function dataDir() {
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const dir = path.join(xdg, 'opencode-tier');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Log file path. */
function logPath() {
  return path.join(dataDir(), 'tier.log');
}

/** State file path. */
function statePath() {
  return path.join(dataDir(), 'state.json');
}

/**
 * Read and parse opencode.json.
 *
 * @param {string} [configPath] - Path to config file (auto-detected if omitted)
 * @returns {Object} Parsed config object
 * @throws {Error} If file doesn't exist or is invalid JSON
 */
function readConfig(configPath) {
  const filePath = configPath || defaultConfigPath();
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Atomically write config to disk.
 * Creates a timestamped backup before overwriting.
 *
 * @param {Object} config - The config object to write
 * @param {string} [configPath] - Path to config file
 * @returns {string} Backup file path
 */
function writeConfig(config, configPath) {
  const filePath = configPath || defaultConfigPath();
  const backupPath = createBackup(configPath);
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return backupPath;
}

/**
 * Create a timestamped backup of the current config.
 *
 * @param {string} [configPath]
 * @returns {string} Backup file path
 */
function createBackup(configPath) {
  const filePath = configPath || defaultConfigPath();
  const dir = dataDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `opencode.json.${ts}.bak`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

/**
 * Apply a tier's agent model overrides to a config object.
 * Does NOT write to disk — use writeConfig() after this.
 *
 * @param {Object} config       - Parsed opencode.json
 * @param {Object} tierConfig   - Tier config object from tiers.js
 *   Has shape: { agents: Object<string, string>, smallModel?: string }
 * @returns {Object} Modified config (same reference)
 */
function applyTierToConfig(config, tierConfig) {
  if (!config.agent) config.agent = {};

  const agents = tierConfig.agents || tierConfig;

  for (const [agentName, modelId] of Object.entries(agents)) {
    if (!config.agent[agentName]) {
      config.agent[agentName] = {};
    }
    config.agent[agentName].model = modelId;
    // Set small_model per agent if tier provides it
    if (tierConfig.smallModel) {
      config.agent[agentName].small_model = tierConfig.smallModel;
    }
  }

  // Set top-level small_model for lightweight tasks
  if (tierConfig.smallModel) {
    config.small_model = tierConfig.smallModel;
  }

  return config;
}

/**
 * Log a tier switch event.
 *
 * @param {string} tierLabel - e.g. "GREEN"
 * @param {string} [message] - Optional extra message
 */
function logSwitch(tierLabel, message) {
  const log = logPath();
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] TIER ${tierLabel}${message ? ' — ' + message : ''}`;
  fs.appendFileSync(log, line + '\n', 'utf-8');
}

/**
 * Read the last N log lines.
 *
 * @param {number} [n=10]
 * @returns {string[]}
 */
function tailLog(n = 10) {
  try {
    const content = fs.readFileSync(logPath(), 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}

/**
 * Read/write persistent state (JSON).
 */
const state = {
  read() {
    try {
      const raw = fs.readFileSync(statePath(), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  },
  write(data) {
    fs.writeFileSync(statePath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
  },
  get(key, fallback) {
    const s = this.read();
    return s[key] !== undefined ? s[key] : fallback;
  },
  set(key, value) {
    const s = this.read();
    s[key] = value;
    this.write(s);
  },
};

module.exports = {
  defaultConfigPath,
  dataDir,
  logPath,
  readConfig,
  writeConfig,
  createBackup,
  applyTierToConfig,
  logSwitch,
  tailLog,
  state,
};
