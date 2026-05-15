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
  if (!config.provider) config.provider = {};

  const agents = tierConfig.agents || tierConfig;

  // Collect which providers this tier needs
  const neededProviders = new Set();
  for (const modelId of Object.values(agents)) {
    const provider = modelId.split('/')[0];
    if (provider) neededProviders.add(provider);
  }

  // Also check smallModel
  if (tierConfig.smallModel) {
    const smProvider = tierConfig.smallModel.split('/')[0];
    if (smProvider) neededProviders.add(smProvider);
  }

  // Ensure all required providers exist in config
  for (const provider of neededProviders) {
    if (!config.provider[provider]) {
      config.provider[provider] = {};
    }
  }

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

// ─── Cooldown & Manual Override ─────────────────────────────────────────

/** Minimum time (ms) between auto-switches to prevent oscillation. */
const AUTO_SWITCH_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

/** How long (ms) to respect a manual tier override before auto-switch can resume. */
const MANUAL_OVERRIDE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Urgency threshold above which auto-switch ignores manual override. */
const EMERGENCY_URGENCY = 90;

/**
 * Record that an auto-switch happened now.
 * @param {string} tierKey - Tier that was applied
 */
function recordAutoSwitch(tierKey) {
  state.set('lastAutoSwitch', {
    tier: tierKey,
    timestamp: Date.now(),
  });
}

/**
 * Record that the user manually set a tier.
 * This prevents the auto-switcher from overwriting it for a grace period.
 *
 * @param {string} tierKey - Tier the user manually selected
 */
function recordManualOverride(tierKey) {
  state.set('manualOverride', {
    tier: tierKey,
    timestamp: Date.now(),
  });
}

/**
 * Check if a manual override is active and should be respected.
 *
 * @returns {boolean} True if manual override is in effect
 */
function hasActiveManualOverride() {
  const override = state.get('manualOverride', null);
  if (!override) return false;

  const elapsed = Date.now() - override.timestamp;
  return elapsed < MANUAL_OVERRIDE_GRACE_MS;
}

/**
 * Check if auto-switch cooldown is active.
 *
 * @returns {boolean} True if we should wait before another auto-switch
 */
function isAutoSwitchOnCooldown() {
  const last = state.get('lastAutoSwitch', null);
  if (!last) return false;

  const elapsed = Date.now() - last.timestamp;
  return elapsed < AUTO_SWITCH_COOLDOWN_MS;
}

/**
 * Determine if the auto-switcher should proceed with a tier change.
 *
 * Logic:
 *   1. If urgency >= EMERGENCY_URGENCY → always switch (emergency mode)
 *   2. If cooldown active → skip (prevents oscillation)
 *   3. If manual override active → skip (respects user choice)
 *   4. Otherwise → allow
 *
 * @param {number} urgency - Current budget urgency (0-100)
 * @param {string} targetTierKey - The tier being proposed
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function shouldAutoSwitch(urgency, targetTierKey) {
  // Emergency: always allow regardless of override/cooldown
  if (urgency >= EMERGENCY_URGENCY) {
    return { allowed: true, reason: null };
  }

  // Cooldown check
  if (isAutoSwitchOnCooldown()) {
    const last = state.get('lastAutoSwitch');
    const remaining = Math.ceil((AUTO_SWITCH_COOLDOWN_MS - (Date.now() - last.timestamp)) / 60000);
    return {
      allowed: false,
      reason: `Cooldown active (${remaining} min remaining). Last auto-switch: ${new Date(last.timestamp).toISOString().slice(0, 16)}`,
    };
  }

  // Manual override check
  if (hasActiveManualOverride()) {
    const override = state.get('manualOverride');
    const remaining = Math.ceil((MANUAL_OVERRIDE_GRACE_MS - (Date.now() - override.timestamp)) / 60000);
    return {
      allowed: false,
      reason: `Manual override active (${remaining} min remaining). User set ${override.tier.toUpperCase()} manually.`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Check if a config already matches a tier definition.
 * Returns false if write is needed, true if config already correct.
 *
 * @param {Object} config - Parsed opencode.json
 * @param {Object} tierConfig - Tier definition from tiers.js
 * @returns {boolean} True = no change needed (skip write)
 */
function configAlreadyMatchesTier(config, tierConfig) {
  if (!config.agent) return false;

  const agents = tierConfig.agents || tierConfig;

  // Check agent models
  for (const [agentName, modelId] of Object.entries(agents)) {
    const current = config.agent[agentName] && config.agent[agentName].model;
    if (current !== modelId) return false;

    // Also verify the required provider is configured
    const provider = modelId.split('/')[0];
    if (provider && !config.provider?.[provider]) return false;
  }

  // Check small_model
  if (tierConfig.smallModel && config.small_model !== tierConfig.smallModel) {
    return false;
  }

  // Check small_model provider
  if (tierConfig.smallModel) {
    const smProvider = tierConfig.smallModel.split('/')[0];
    if (smProvider && !config.provider?.[smProvider]) return false;
  }

  return true;
}

/**
 * Clear manual override (called when auto-switch takes over in emergency).
 */
function clearManualOverride() {
  state.set('manualOverride', null);
}

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
  // Cooldown + override
  AUTO_SWITCH_COOLDOWN_MS,
  MANUAL_OVERRIDE_GRACE_MS,
  EMERGENCY_URGENCY,
  recordAutoSwitch,
  recordManualOverride,
  hasActiveManualOverride,
  isAutoSwitchOnCooldown,
  shouldAutoSwitch,
  configAlreadyMatchesTier,
  clearManualOverride,
};
