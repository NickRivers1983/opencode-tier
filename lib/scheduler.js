/**
 * opencode-tier — Cross-platform scheduler
 * ──────────────────────────────────────────
 * Provides three scheduling mechanisms:
 *   1. In-process polling (setInterval) — works on ALL platforms, zero setup
 *   2. System service install — systemd (Linux), launchd (macOS), cron (fallback)
 *   3. OpenCode slash commands — installs /tier commands into OpenCode TUI
 *
 * The in-process polling is the primary mechanism. System services
 * are optional enhancements for users who want persistence across reboots.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, spawn } = require('node:child_process');

// ---------------------------------------------------------------------------
//  In-process polling daemon
// ---------------------------------------------------------------------------

let _intervalHandle = null;

/**
 * Start in-process polling.
 * Runs `checkFn` every `intervalMinutes` minutes.
 * Works on all platforms with zero external setup.
 *
 * @param {number}      intervalMinutes
 * @param {Function}    checkFn  - Async function to call on each tick
 * @returns {Object} { stop, isRunning }
 */
function startPolling(intervalMinutes, checkFn) {
  stopPolling(); // Ensure no duplicate timers

  const ms = Math.max(60000, intervalMinutes * 60 * 1000);

  // Run immediately, then on interval
  const run = async () => {
    try {
      await checkFn();
    } catch (err) {
      console.error('  [!] Watch check failed:', err.message);
    }
  };

  run();
  _intervalHandle = setInterval(run, ms);
  _intervalHandle.unref(); // Don't keep process alive just for timer

  return {
    stop: stopPolling,
    isRunning: () => _intervalHandle !== null,
  };
}

/**
 * Stop the in-process polling daemon.
 */
function stopPolling() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

// ---------------------------------------------------------------------------
//  Service installation (platform-specific)
// ---------------------------------------------------------------------------

/**
 * Install a persistent service/timer for the auto-switcher.
 * Auto-detects the platform:
 *   - Linux: systemd user timer
 *   - macOS: launchd user agent
 *   - Other: cron job
 *
 * @param {string} scriptPath - Absolute path to opencode-tier.js
 * @returns {Object} { method, success, message }
 */
function installService(scriptPath) {
  const platform = process.platform;

  if (platform === 'linux') {
    return installSystemd(scriptPath);
  }
  if (platform === 'darwin') {
    return installLaunchd(scriptPath);
  }
  // Fallback: cron (works on Linux, macOS, WSL)
  return installCron(scriptPath);
}

/**
 * Uninstall the service/timer.
 *
 * @returns {Object} { success, message }
 */
function uninstallService() {
  const platform = process.platform;

  if (platform === 'linux') {
    return uninstallSystemd();
  }
  if (platform === 'darwin') {
    return uninstallLaunchd();
  }
  return uninstallCron();
}

// ─── Linux: systemd user timer ────────────────────────────────────────────

function systemdDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function installSystemd(scriptPath) {
  const dir = systemdDir();
  fs.mkdirSync(dir, { recursive: true });

  // Service unit — use process.execPath for the exact Node binary
  const nodeBin = process.execPath;
  const userPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  const serviceContent = [
    '[Unit]',
    'Description=Opencode Tier Auto-Switcher',
    'Documentation=https://github.com/NickRivers1983/opencode-tier',
    'After=network.target',
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${nodeBin} ${scriptPath} auto --yes`,
    `Environment=HOME=${os.homedir()}`,
    `Environment=PATH=${userPath}`,
    'EnvironmentFile=%h/.config/opencode/.env',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'opencode-tier.service'), serviceContent);

    // Timer unit (runs every 5 minutes — rapid budget protection)
    const timerContent = [
      '[Unit]',
      'Description=Run opencode-tier every 5 minutes',
      '',
      '[Timer]',
      'OnBootSec=2min',
      'OnUnitActiveSec=5min',
      'Persistent=true',
      '',
      '[Install]',
      'WantedBy=timers.target',
    ].join('\n');

  fs.writeFileSync(path.join(dir, 'opencode-tier.timer'), timerContent);

  try {
    execSync('systemctl --user daemon-reload', { timeout: 10000 });
    execSync('systemctl --user enable --now opencode-tier.timer', { timeout: 10000 });
    return {
      method: 'systemd',
      success: true,
      message: 'systemd user timer installed (checks every 5 min)',
    };
  } catch (err) {
    return {
      method: 'systemd',
      success: false,
      message: `systemd units written but enable failed: ${err.message}`,
    };
  }
}

function uninstallSystemd() {
  const dir = systemdDir();
  try {
    execSync('systemctl --user stop opencode-tier.timer 2>/dev/null || true', { timeout: 5000 });
    execSync('systemctl --user disable opencode-tier.timer 2>/dev/null || true', { timeout: 5000 });
  } catch { /* ignore */ }

  try {
    fs.unlinkSync(path.join(dir, 'opencode-tier.service'));
    fs.unlinkSync(path.join(dir, 'opencode-tier.timer'));
  } catch { /* ignore */ }

  try {
    execSync('systemctl --user daemon-reload', { timeout: 5000 });
  } catch { /* ignore */ }

  return { success: true, message: 'systemd timer removed' };
}

// ─── macOS: launchd user agent ────────────────────────────────────────────

function launchdDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function installLaunchd(scriptPath) {
  const dir = launchdDir();
  fs.mkdirSync(dir, { recursive: true });

  const nodeBin = process.execPath;
  const plistPath = path.join(dir, 'com.opencode-tier.plist');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opencode-tier</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${scriptPath}</string>
    <string>auto</string>
    <string>--yes</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
  </dict>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/Library/Logs/opencode-tier.log</string>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/Library/Logs/opencode-tier.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plist);

  try {
    execSync(`launchctl load ${plistPath}`, { timeout: 10000 });
    return {
      method: 'launchd',
      success: true,
      message: 'launchd agent installed (checks every 5 min)',
    };
  } catch (err) {
    return {
      method: 'launchd',
      success: false,
      message: `plist written but load failed: ${err.message}`,
    };
  }
}

function uninstallLaunchd() {
  const plistPath = path.join(launchdDir(), 'com.opencode-tier.plist');
  try {
    execSync(`launchctl unload ${plistPath} 2>/dev/null || true`, { timeout: 5000 });
  } catch { /* ignore */ }
  try { fs.unlinkSync(plistPath); } catch { /* ignore */ }
  return { success: true, message: 'launchd agent removed' };
}

// ─── Cron fallback (works everywhere) ──────────────────────────────────────

function installCron(scriptPath) {
  const nodeBin = process.execPath;
  const cronLine = `*/5 * * * * ${nodeBin} ${scriptPath} auto --yes >/dev/null 2>&1`;

  try {
    // Try to add to crontab
    const existing = execSync('crontab -l 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (existing.includes('opencode-tier')) {
      return {
        method: 'cron',
        success: true,
        message: 'cron job already exists',
      };
    }

    // Write via temp file — more robust than echo-pipe
    const tmpFile = path.join(os.tmpdir(), `opencode-tier-cron-${Date.now()}`);
    const newCron = existing.trim() + '\n' + cronLine + '\n';
    fs.writeFileSync(tmpFile, newCron, 'utf-8');
    execSync(`crontab ${tmpFile}`, { timeout: 5000 });
    fs.unlinkSync(tmpFile);

    return {
      method: 'cron',
      success: true,
      message: 'cron job installed (runs every 5 min)',
    };
  } catch (err) {
    return {
      method: 'cron',
      success: false,
      message: `cron install failed: ${err.message}`,
    };
  }
}

function uninstallCron() {
  try {
    const existing = execSync('crontab -l 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const filtered = existing
      .split('\n')
      .filter(line => !line.includes('opencode-tier'))
      .join('\n')
      .trim();
    const tmpFile = path.join(os.tmpdir(), `opencode-tier-cron-${Date.now()}`);
    fs.writeFileSync(tmpFile, filtered + '\n', 'utf-8');
    execSync(`crontab ${tmpFile}`, { timeout: 5000 });
    fs.unlinkSync(tmpFile);
    return { success: true, message: 'cron job removed' };
  } catch (err) {
    return { success: false, message: `cron uninstall failed: ${err.message}` };
  }
}

// ─── Service status ────────────────────────────────────────────────────────

/**
 * Check if a persistent service is currently installed.
 *
 * @returns {Object} { installed: boolean, method: string|null, details: string }
 */
function checkServiceStatus() {
  const platform = process.platform;

  if (platform === 'linux') {
    try {
      const out = execSync('systemctl --user --no-pager list-units 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      if (out.includes('opencode-tier')) {
        const active = out.includes('opencode-tier.timer') && out.includes('active');
        return {
          installed: true,
          method: 'systemd',
          details: active ? 'active (checking every 5 min)' : 'installed but inactive',
        };
      }
    } catch { /* ignore */ }
  }

  if (platform === 'darwin') {
    const plistPath = path.join(launchdDir(), 'com.opencode-tier.plist');
    if (fs.existsSync(plistPath)) {
      try {
        const out = execSync(`launchctl list com.opencode-tier 2>/dev/null || echo "not running"`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return {
          installed: true,
          method: 'launchd',
          details: out.includes('not running') ? 'loaded' : 'running',
        };
      } catch {
        return { installed: true, method: 'launchd', details: 'plist exists' };
      }
    }
  }

  // Check cron
  try {
    const out = execSync('crontab -l 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (out.includes('opencode-tier')) {
      return {
        installed: true,
        method: 'cron',
        details: 'cron job active',
      };
    }
  } catch { /* ignore */ }

  return { installed: false, method: null, details: 'no persistent service' };
}

// ---------------------------------------------------------------------------
//  OpenCode slash-command integration
// ---------------------------------------------------------------------------

/**
 * Install /tier slash commands into OpenCode.
 * Creates command files in ~/.config/opencode/commands/
 *
 * @param {string} scriptPath - Absolute path to opencode-tier.js
 */
function installCommands(scriptPath) {
  const cmdDir = path.join(os.homedir(), '.config', 'opencode', 'commands');
  fs.mkdirSync(cmdDir, { recursive: true });

  const commands = {
    'tier-status.md': `# /tier-status

Show current tier configuration, active models, and budget status.

\`\`\`
${scriptPath} status
\`\`\``,
    'tier-auto.md': `# /tier-auto

Automatically detect and apply the best tier based on current budget usage.

\`\`\`
${scriptPath} auto
\`\`\``,
    'tier.md': `# /tier

Switch to a specific model tier.

Usage: \`/tier <name>\`

Tiers:
- \`ultimate\` — Professional free models (GitHub + Google + Zen)
- \`green\`    — Full paid power (deepseek-v4-pro)
- \`yellow\`   — Balanced mid-range
- \`orange\`   — Economy (cheap + free mix)
- \`red\`      — Free Zen only (big-pickle)

Examples:
\`\`\`
/tier green
/tier red
/tier ultimate
\`\`\``,
    'tier-watch.md': `# /tier-watch

Start continuous budget monitoring. Auto-adjusts tiers every 30 minutes.

\`\`\`
${scriptPath} watch
\`\`\``,
    'tier-providers.md': `# /tier-providers

Show connected AI providers and their status.

\`\`\`
${scriptPath} providers
\`\`\``,
  };

  for (const [filename, content] of Object.entries(commands)) {
    fs.writeFileSync(path.join(cmdDir, filename), content.trim() + '\n');
  }

  return Object.keys(commands);
}

module.exports = {
  startPolling,
  stopPolling,
  installService,
  uninstallService,
  installCommands,
  checkServiceStatus,
};
