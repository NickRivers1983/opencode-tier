#!/usr/bin/env node
/**
 * opencode-tier v2.0.0
 * ─────────────────────
 * Smart autonomous model tier switcher for OpenCode.
 *
 * Proactively monitors your Go credit consumption and automatically
 * switches between premium/free model tiers based on real-time budget
 * analysis. No user intervention needed — set it and forget it.
 *
 * Cross-platform: Linux, macOS, Windows.
 * Zero npm dependencies: pure Node.js built-ins.
 *
 * Usage:
 *   opencode-tier <command>
 *
 * Commands:
 *   ultimate    🟣 Professional free models (GitHub + Google + Zen)
 *   green       🟢 Full paid power (deepseek-v4-pro)
 *   yellow      🟡 Balanced mid-range (deepseek-v4-flash)
 *   orange      🟠 Economy (cheap paid + free mix)
 *   red         🔴 Survival (free Zen only — big-pickle)
 *   auto        🤖 Auto-detect and apply best tier based on budget
 *   watch [N]   👁  Continuous monitoring (checks every N min, default: 30)
 *   status      📊 Show current configuration and budget
 *   providers   🔌 Show connected AI providers
 *   setup       🛠  Interactive setup wizard
 *   install     📦 Install auto-switching service + commands
 *   uninstall   🗑️  Remove service and commands
 *   help        ℹ️  Show this message
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ─── ANSI Colors (zero deps) ──────────────────────────────────────────────
const isTTY = process.stdout.isTTY && !process.env.CI;
const C = {
  reset:    isTTY ? '\x1b[0m' : '',
  bold:     isTTY ? '\x1b[1m' : '',
  dim:      isTTY ? '\x1b[2m' : '',
  green:    isTTY ? '\x1b[32m' : '',
  yellow:   isTTY ? '\x1b[33m' : '',
  red:      isTTY ? '\x1b[31m' : '',
  blue:     isTTY ? '\x1b[34m' : '',
  magenta:  isTTY ? '\x1b[35m' : '',
  cyan:     isTTY ? '\x1b[36m' : '',
  white:    isTTY ? '\x1b[37m' : '',
};

const icons = {
  check:  '\u2713',
  cross:  '\u2717',
  arrow:  '\u2192',
  star:   '\u2605',
  bullet: '\u25CF',
};

// ─── Imports ───────────────────────────────────────────────────────────────
const tiers = require('./lib/tiers');
const config = require('./lib/config');
const budget = require('./lib/budget');
const providers = require('./lib/providers');
const scheduler = require('./lib/scheduler');

// ─── Helpers ───────────────────────────────────────────────────────────────

function clr(text, code) {
  return code ? `${code}${text}${C.reset}` : text;
}

function header(text, subtext) {
  console.log('');
  console.log(`  ${C.bold}╭────────────────────────────────────────────╮${C.reset}`);
  console.log(`  ${C.bold}│${C.reset}  ${clr(icons.star, C.yellow)}  ${clr(text, C.bold)}${' '.repeat(Math.max(1, 39 - text.length))}${C.bold}│${C.reset}`);
  if (subtext) {
    console.log(`  ${C.bold}│${C.reset}     ${clr(subtext, C.dim)}${' '.repeat(Math.max(1, 35 - subtext.length))}${C.bold}│${C.reset}`);
  }
  console.log(`  ${C.bold}╰────────────────────────────────────────────╯${C.reset}`);
  console.log('');
}

function box(items) {
  // items: array of { label, value, color? }
  const maxLabel = Math.max(...items.map(i => i.label.length));
  for (const item of items) {
    const pad = ' '.repeat(maxLabel - item.label.length);
    const val = item.color ? clr(item.value, item.color) : item.value;
    console.log(`    ${clr(item.label + ':', C.dim)} ${pad}${val}`);
  }
}

function success(msg) {
  console.log(`  ${clr(icons.check, C.green)}  ${msg}`);
}

function warn(msg) {
  console.log(`  ${clr('!', C.yellow)}  ${msg}`);
}

function error(msg) {
  console.log(`  ${clr(icons.cross, C.red)}  ${msg}`);
}

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * Apply a tier by name.
 */
function cmdApplyTier(tierKey, { silent } = {}) {
  const tierDef = tiers.TIERS[tierKey];
  if (!tierDef) {
    error(`Unknown tier: ${tierKey}`);
    process.exit(1);
  }

  try {
    const cfg = config.readConfig();
    config.applyTierToConfig(cfg, tierDef);
    const backup = config.writeConfig(cfg);
    config.logSwitch(tierDef.label);

    if (!silent) {
      console.log('');
      console.log(`  ${tierDef.icon}  ${clr('TIER ' + tierDef.label, C.bold)}`);
      console.log(`     ${clr(tierDef.description, C.dim)}`);
      console.log(`     ${clr(tierDef.costRange, C.dim)}`);
      console.log('');
      console.log(`  ${clr('Agent models:', C.dim)}`);
      for (const [agent, model] of Object.entries(tierDef.agents)) {
        console.log(`    ${clr(agent.padEnd(14), C.cyan)} ${model}`);
      }
      console.log('');
      success(`Backup saved: ${pathRelative(backup)}`);
      console.log(`  ${clr(icons.arrow, C.blue)}  Changes take effect on ${clr('next OpenCode session', C.bold)}.`);
      console.log(`     Running sessions keep their current model.`);
      console.log('');
    }
  } catch (err) {
    error(`Failed to apply tier: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Auto-detect best tier based on budget analysis.
 */
function cmdAuto({ yes } = {}) {
  header('TIER AUTO', 'Budget-based tier selection');

  // Step 1: Detect providers
  const prov = providers.detectProviders();
  box([
    { label: 'OpenCode Go',  value: prov.opencodeGo ? 'connected' : 'not connected', color: prov.opencodeGo ? C.green : C.dim },
    { label: 'GitHub Copilot', value: prov.github ? 'connected' : 'not connected',   color: prov.github ? C.green : C.dim },
    { label: 'Google Gemini', value: prov.google ? prov.googleKeyHint : 'not found', color: prov.google ? C.green : C.yellow },
  ]);
  console.log('');

  // Step 2: Check if we can use Ultimate (all free providers)
  if (prov.github && prov.google) {
    success('All free providers available!');
    console.log(`  ${clr('Ultimate tier gives you professional models at $0/day.', C.dim)}`);
    console.log('');
    if (!yes) {
      console.log(`  ${clr(icons.arrow, C.blue)}  Run ${clr('opencode-tier ultimate', C.bold)} to use free pro models.`);
      console.log('');
    }
  }

  // Step 3: Analyze budget
  console.log(`  ${clr('Analyzing budget...', C.dim)}`);
  let analysis;
  try {
    analysis = budget.analyze();
  } catch (err) {
    error(`Budget analysis failed: ${err.message}`);
    console.log(`  ${clr('Falling back to provider-based recommendation.', C.dim)}`);
    console.log('');

    const recTier = providers.bestTierForProviders(prov);
    console.log(`  ${clr(icons.arrow, C.blue)}  Recommended: ${clr(recTier.toUpperCase(), C.bold)}`);
    console.log('');
    return cmdApplyTier(recTier, { silent: yes });
  }

  if (analysis.error) {
    warn(analysis.error);
    console.log(`  ${clr('Using provider-based recommendation instead.', C.dim)}`);
    const recTier = providers.bestTierForProviders(prov);
    console.log(`  ${clr(icons.arrow, C.blue)}  Recommended: ${clr(recTier.toUpperCase(), C.bold)}`);
    console.log('');
    if (!yes) {
      if (!process.stdin.isTTY) {
        // Non-TTY: skip confirmation (same as --yes)
        return cmdApplyTier(recTier, { silent: true });
      }
      // Interactive confirm
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`  Apply tier ${clr(recTier.toUpperCase(), C.bold)}? [Y/n] `, (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'n') {
          console.log(`  ${clr('Cancelled.', C.dim)}`);
          return;
        }
        cmdApplyTier(recTier);
      });
      return;
    }
    return cmdApplyTier(recTier, { silent: yes });
  }

  // Step 4: Show budget breakdown
  const { urgency, dailyCost, totalCost, breakdown } = analysis;
  console.log('');

  box([
    { label: 'Daily spend', value: `$${dailyCost.toFixed(2)}` },
    { label: 'Total spend', value: `$${totalCost.toFixed(2)}` },
    { label: '', value: '' },
    { label: '5h limit', value: `${breakdown.score5h}%`, color: breakdown.score5h >= 80 ? C.red : breakdown.score5h >= 50 ? C.yellow : C.green },
    { label: 'Weekly limit', value: `${breakdown.scoreWeekly}%`, color: breakdown.scoreWeekly >= 80 ? C.red : breakdown.scoreWeekly >= 50 ? C.yellow : C.green },
    { label: 'Monthly limit', value: `${breakdown.scoreMonthly}%`, color: breakdown.scoreMonthly >= 80 ? C.red : breakdown.scoreMonthly >= 50 ? C.yellow : C.green },
  ]);
  console.log('');

  // Step 5: Select and apply tier
  const { key: suggestedKey, tier: suggestedTier } = tiers.selectTierForUrgency(urgency, { hasGo: prov.opencodeGo });

  const urgencyColor = urgency >= 60 ? C.red : urgency >= 30 ? C.yellow : C.green;
  console.log(`  Urgency:  ${clr(`${urgency}%`, urgencyColor)}`);
  console.log(`  Tier:     ${suggestedTier.icon}  ${clr(suggestedKey.toUpperCase(), C.bold)}  ${clr(suggestedTier.description, C.dim)}`);
  console.log('');

  if (yes) {
    success(`Auto-selected ${suggestedKey.toUpperCase()} (${clr(`--yes`, C.dim)})`);
    console.log('');
    return cmdApplyTier(suggestedKey, { silent: true });
  }

  if (!process.stdin.isTTY) {
    // Non-TTY: skip confirmation (same as --yes)
    success(`Auto-selected ${suggestedKey.toUpperCase()} (non-interactive)`);
    console.log('');
    return cmdApplyTier(suggestedKey, { silent: true });
  }

  // Interactive
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`  Apply tier ${clr(suggestedKey.toUpperCase(), C.bold)}? [Y/n/tier-name] `, (answer) => {
    rl.close();
    const ans = answer.trim().toLowerCase();
    if (ans === '' || ans === 'y' || ans === 'yes') {
      return cmdApplyTier(suggestedKey);
    }
    if (tiers.TIERS[ans]) {
      return cmdApplyTier(ans);
    }
    if (ans === 'n' || ans === 'no') {
      console.log(`  ${clr('Cancelled. No changes made.', C.dim)}`);
      return;
    }
    console.log(`  ${clr('Invalid response. No changes made.', C.yellow)}`);
  });
}

/**
 * Continuous monitoring (watch mode).
 */
function cmdWatch(interval) {
  const intervalMin = parseInt(interval, 10) || 30;

  header('TIER WATCH', `Auto-adjusting every ${intervalMin} min`);

  console.log(`  ${clr('Monitoring in background. Press Ctrl+C to stop.', C.dim)}`);
  console.log(`  ${clr('Tier changes apply on next OpenCode session.', C.dim)}`);
  console.log('');

  let lastTier = null;

  scheduler.startPolling(intervalMin, () => {
    try {
      const analysis = budget.analyze();
      if (analysis.urgency === null || analysis.urgency === undefined) {
        warn('Budget data unavailable — skipping check');
        return;
      }

      const { key } = tiers.selectTierForUrgency(analysis.urgency);

      if (key !== lastTier && lastTier !== null) {
        const tierDef = tiers.TIERS[key];
        const ts = new Date().toLocaleTimeString();
        console.log(`  [${clr(ts, C.dim)}] ${clr('Budget:', C.dim)} ${analysis.urgency}%  ${clr(icons.arrow, C.blue)}  Switching to ${tierDef.icon} ${clr(key.toUpperCase(), C.bold)}`);
        cmdApplyTier(key, { silent: true });
      } else if (lastTier === null) {
        const tierDef = tiers.TIERS[key];
        console.log(`  [${clr(new Date().toLocaleTimeString(), C.dim)}] ${clr('Initial:', C.dim)} ${analysis.urgency}% → ${tierDef.icon} ${clr(key.toUpperCase(), C.bold)}`);
        // Apply on first check if different from current
        const currentTier = tiers.detectTier(config.readConfig().agent);
        if (currentTier !== key) {
          cmdApplyTier(key, { silent: true });
        }
      }
      lastTier = key;
    } catch (err) {
      const ts = new Date().toLocaleTimeString();
      console.log(`  [${clr(ts, C.dim)}] ${clr('Watch error:', C.red)} ${err.message}`);
    }
  });
}

/**
 * Show status.
 */
function cmdStatus() {
  header('TIER STATUS', 'Current configuration & budget');

  // Current config
  let cfg;
  try {
    cfg = config.readConfig();
  } catch (err) {
    error(`Cannot read config: ${err.message}`);
    process.exit(1);
  }

  const currentTier = tiers.detectTier(cfg.agent);
  const tierDef = tiers.TIERS[currentTier];
  const icon = tierDef ? tierDef.icon : clr('?', C.yellow);

  console.log(`  ${icon}  ${clr('Tier: ' + (tierDef ? tierDef.label : currentTier.toUpperCase()), C.bold)}`);
  if (tierDef) {
    console.log(`     ${clr(tierDef.description, C.dim)}`);
    console.log(`     ${clr(tierDef.costRange, C.dim)}`);
  }
  console.log('');

  // Agent models
  console.log(`  ${clr('Agent models:', C.dim)}`);
  for (const agentName of tiers.KNOWN_AGENTS) {
    if (cfg.agent && cfg.agent[agentName]) {
      const model = cfg.agent[agentName].model || '(default)';
      console.log(`    ${clr(agentName.padEnd(14), C.cyan)} ${model}`);
    }
  }
  console.log('');

  // Providers
  const prov = providers.detectProviders();
  console.log(`  ${clr('Providers:', C.dim)}`);
  console.log(`    ${clr('Go:'.padEnd(14), C.dim)} ${prov.opencodeGo ? clr(icons.check + ' connected', C.green) : clr('not connected', C.dim)}`);
  console.log(`    ${clr('GitHub:'.padEnd(14), C.dim)} ${prov.github  ? clr(icons.check + ' connected', C.green) : clr('not connected', C.dim)}`);
  console.log(`    ${clr('Google:'.padEnd(14), C.dim)} ${prov.google  ? clr(icons.check + ' ' + prov.googleKeyHint, C.green) : clr('not configured', C.yellow)}`);
  console.log('');

  // Budget
  try {
    const analysis = budget.analyze();
    if (analysis.urgency !== null) {
      console.log(`  ${clr('Budget:', C.dim)}`);
      console.log(`    ${clr('Daily:'.padEnd(14), C.dim)} $${analysis.dailyCost.toFixed(2)}`);
      console.log(`    ${clr('Total:'.padEnd(14), C.dim)} $${analysis.totalCost.toFixed(2)}`);
      const uc = analysis.urgency >= 60 ? C.red : analysis.urgency >= 30 ? C.yellow : C.green;
      console.log(`    ${clr('Urgency:'.padEnd(14), C.dim)} ${clr(analysis.urgency + '%', uc)}`);
      if (analysis.breakdown) {
        console.log(`    ${clr('5h limit:'.padEnd(14), C.dim)} ${analysis.breakdown.score5h}%`);
        console.log(`    ${clr('Weekly:'.padEnd(14), C.dim)} ${analysis.breakdown.scoreWeekly}%`);
        console.log(`    ${clr('Monthly:'.padEnd(14), C.dim)} ${analysis.breakdown.scoreMonthly}%`);
      }
    }
  } catch {
    console.log(`  ${clr('Budget:', C.dim)} ${clr('(opencode stats unavailable)', C.yellow)}`);
  }
  console.log('');

  // Service status
  const svc = scheduler.checkServiceStatus();
  if (svc.installed) {
    success(`Auto-switching: ${svc.method} — ${svc.details}`);
  } else {
    console.log(`  ${clr('Auto-switching:', C.dim)}  ${clr('not installed', C.dim)}`);
    console.log(`     Run ${clr('opencode-tier install', C.bold)} to enable automatic tier switching.`);
  }
  console.log('');

  // Recent switches
  const logs = config.tailLog(5);
  if (logs.length > 0) {
    console.log(`  ${clr('Recent switches:', C.dim)}`);
    for (const line of logs) {
      console.log(`    ${clr(line, C.dim)}`);
    }
    console.log('');
  }
}

/**
 * Show providers.
 */
function cmdProviders() {
  header('PROVIDERS', 'Connected AI service status');

  const prov = providers.detectProviders();
  const steps = providers.setupGuide(prov);

  console.log(`  ${prov.opencodeGo ? clr(icons.check, C.green) : clr(icons.cross, C.red)}  OpenCode Go     ${prov.opencodeGo ? '(connected)' : clr('(not connected — paid plan)', C.dim)}`);
  console.log(`  ${clr(icons.check, C.green)}  OpenCode Zen    (always available — free tier)`);
  console.log(`  ${prov.github  ? clr(icons.check, C.green) : clr(icons.cross, C.yellow)}  GitHub Copilot  ${prov.github  ? '(connected — FREE via Education)' : clr('(not connected — FREE via .edu email)', C.dim)}`);
  console.log(`  ${prov.google  ? clr(icons.check, C.green) : clr(icons.cross, C.yellow)}  Google Gemini   ${prov.google  ? '(' + prov.googleKeyHint + ' — FREE tier)' : clr('(not configured — FREE via API key)', C.dim)}`);
  console.log('');

  // Recommendation
  const best = providers.bestTierForProviders(prov);
  console.log(`  ${clr('Best tier:', C.bold)}  ${tiers.TIERS[best] ? tiers.TIERS[best].icon + ' ' : ''}${best.toUpperCase()}`);
  console.log('');

  // Setup guide if missing providers
  if (steps.length > 0) {
    console.log(`  ${clr('Setup steps:', C.bold)}`);
    for (const line of steps) {
      console.log(`  ${line}`);
    }
  }
}

/**
 * Setup wizard.
 */
function cmdSetup() {
  header('SETUP', 'Connect free providers for Ultimate tier');

  const prov = providers.detectProviders();

  console.log(`  ${clr('This wizard helps you connect FREE AI providers', C.bold)}`);
  console.log(`  ${clr('to unlock professional-grade models at $0/day.', C.dim)}`);
  console.log('');

  // Step 1: GitHub Copilot
  console.log(`  ${clr('Step 1: GitHub Copilot (FREE via Education)', C.bold)}`);
  console.log(`  ${clr('─────────────────────────────────────────', C.dim)}`);
  if (prov.github) {
    success('Already connected!');
  } else {
    console.log(`    1. Verify your educational status at:`);
    console.log(`       ${clr('https://github.com/settings/education/benefits', C.cyan)}`);
    console.log(`       Use your university email (.edu or @icesi.edu.co)`);
    console.log('');
    console.log(`    2. In OpenCode TUI, run:  ${clr('/connect', C.bold)}`);
    console.log(`       Select ${clr('GitHub Copilot', C.cyan)} and follow the OAuth flow`);
    console.log('');
    console.log(`    3. After connecting, you get these models for FREE:`);
    console.log(`       ${clr('github/claude-3.5-sonnet', C.cyan)}  — best for complex tasks`);
    console.log(`       ${clr('github/gpt-4o', C.cyan)}            — best for general coding`);
    console.log('');
  }

  // Step 2: Google Gemini
  console.log(`  ${clr('Step 2: Google Gemini API (FREE tier)', C.bold)}`);
  console.log(`  ${clr('──────────────────────────────────────────', C.dim)}`);
  if (prov.google) {
    success('API key found: ' + prov.googleKeyHint);
  } else {
    console.log(`    1. Go to ${clr('https://aistudio.google.com/', C.cyan)}`);
    console.log(`    2. Generate a free API key (no credit card needed)`);
    console.log(`    3. Configure it:`);
    console.log('');
    console.log(`       ${clr('# Option A: Environment variable', C.bold)}`);
    console.log(`       echo 'export GOOGLE_API_KEY=your_key_here' >> ~/.bashrc`);
    console.log(`       source ~/.bashrc`);
    console.log('');
    console.log(`       ${clr('# Option B: OpenCode .env file', C.bold)}`);
    console.log(`       echo 'GOOGLE_API_KEY=your_key_here' > ~/.config/opencode/.env`);
    console.log('');
  }

  // Step 3: Verify
  console.log(`  ${clr('Step 3: Verify and activate', C.bold)}`);
  console.log(`  ${clr('────────────────────────────', C.dim)}`);
  console.log(`    After connecting providers:`);

  // Check if we can recommend ultimate
  const updatedProv = providers.detectProviders();
  if (updatedProv.github && updatedProv.google) {
    console.log(`    ${clr('Run:', C.bold)}  opencode-tier ultimate`);
    console.log(`    ${clr('→ Professional models at $0/day!', C.green)}`);
  } else {
    console.log(`    ${clr('Run:', C.bold)}  opencode-tier auto`);
    console.log(`    ${clr('→ Let the system pick the best tier.', C.dim)}`);
  }
  console.log('');
  console.log(`    ${clr('Run:', C.bold)}  opencode-tier providers`);
  console.log(`    ${clr('→ Verify your connections.', C.dim)}`);
  console.log('');
  console.log(`    ${clr('Run:', C.bold)}  opencode-tier install`);
  console.log(`    ${clr('→ Enable automatic switching (every 30 min).', C.dim)}`);
  console.log('');
}

/**
 * Install service + commands.
 */
function cmdInstall() {
  header('INSTALL', 'Setting up auto-switching');

  const scriptPath = pathRelative(require.resolve('./opencode-tier'));
  console.log(`  Script: ${clr(scriptPath, C.dim)}`);
  console.log('');

  // Install scheduler service
  console.log(`  ${clr('Installing scheduler...', C.dim)}`);
  const svc = scheduler.installService(scriptPath);
  if (svc.success) {
    success(svc.message);
  } else {
    warn(svc.message);
    console.log(`  ${clr('Falling back to in-process polling.', C.yellow)}`);
    console.log(`  ${clr('Run "opencode-tier watch" for continuous monitoring.', C.dim)}`);
  }
  console.log('');

  // Install OpenCode commands
  console.log(`  ${clr('Installing /tier commands for OpenCode TUI...', C.dim)}`);
  const cmdFiles = scheduler.installCommands(scriptPath);
  success(`Installed ${cmdFiles.length} commands:`);
  for (const file of cmdFiles) {
    console.log(`    ${clr(file, C.cyan)}`);
  }
  console.log('');
  console.log(`  ${clr('You can now use these commands in OpenCode TUI:', C.dim)}`);
  console.log(`    ${clr('/tier-status', C.bold)}    — show current tier`);
  console.log(`    ${clr('/tier', C.bold)}           — switch tiers`);
  console.log(`    ${clr('/tier-auto', C.bold)}       — auto-switch`);
  console.log(`    ${clr('/tier-watch', C.bold)}      — start monitoring`);
  console.log(`    ${clr('/tier-providers', C.bold)}  — show providers`);
  console.log('');
  success('Installation complete!');
  console.log('');
}

/**
 * Uninstall service.
 */
function cmdUninstall() {
  header('UNINSTALL', 'Removing auto-switching');

  const svc = scheduler.uninstallService();
  if (svc.success) {
    success(svc.message);
  } else {
    warn(svc.message);
  }

  // Remove commands
  try {
    const cmdDir = path.join(os.homedir(), '.config', 'opencode', 'commands');
    for (const cmd of ['tier-status.md', 'tier-auto.md', 'tier.md', 'tier-watch.md', 'tier-providers.md']) {
      try { fs.unlinkSync(path.join(cmdDir, cmd)); } catch { /* ignore */ }
    }
    success('Commands removed from OpenCode TUI');
  } catch { /* ignore */ }

  console.log('');
  console.log(`  ${clr('To stop a running watch process, press Ctrl+C in that terminal.', C.dim)}`);
  console.log('');
}

/**
 * Show help.
 */
function cmdHelp() {
  header('OPENCODE-TIER', 'v2.0.0 — Autonomous model tier switcher');

  console.log(`  ${clr('USAGE', C.bold)}`);
  console.log(`    opencode-tier <command>`);
  console.log('');
  console.log(`  ${clr('COMMANDS', C.bold)}`);
  console.log(`    ultimate    ${clr('Professional free models (GitHub + Google + Zen)', C.dim)}`);
  console.log(`    green       ${clr('Full paid power — deepseek-v4-pro, qwen3.6-plus', C.dim)}`);
  console.log(`    yellow      ${clr('Balanced mid-range — deepseek-v4-flash, minimax', C.dim)}`);
  console.log(`    orange      ${clr('Economy — cheap paid + free Zen mix', C.dim)}`);
  console.log(`    red         ${clr('Survival — free Zen only (big-pickle)', C.dim)}`);
  console.log(`    auto        ${clr('Auto-detect best tier based on budget', C.dim)}`);
  console.log(`    watch [N]   ${clr('Continuous monitoring (checks every N min)', C.dim)}`);
  console.log(`    status      ${clr('Show current configuration and budget', C.dim)}`);
  console.log(`    providers   ${clr('Show connected AI providers', C.dim)}`);
  console.log(`    setup       ${clr('Interactive setup wizard', C.dim)}`);
  console.log(`    install     ${clr('Install auto-switching service + commands', C.dim)}`);
  console.log(`    uninstall   ${clr('Remove service and commands', C.dim)}`);
  console.log('');
  console.log(`  ${clr('TIERS (daily cost)', C.bold)}`);
  console.log(`    ${clr('🟣 Ultimate', C.magenta)}  $0/day (GitHub Edu + Google Gemini + Zen free)`);
  console.log(`    ${clr('🟢 Green', C.green)}     $6-12/day (Go paid models, full power)`);
  console.log(`    ${clr('🟡 Yellow', C.yellow)}    $2-5/day (Go mid-range)`);
  console.log(`    ${clr('🟠 Orange', C.yellow)}    $0.30-1/day (Go cheap + free mix)`);
  console.log(`    ${clr('🔴 Red', C.red)}       $0/day (Zen free only)`);
  console.log('');
  console.log(`  ${clr('EXAMPLES', C.bold)}`);
  console.log(`    opencode-tier auto              ${clr('# Interactive budget check', C.dim)}`);
  console.log(`    opencode-tier auto --yes        ${clr('# Hands-free auto switch', C.dim)}`);
  console.log(`    opencode-tier watch             ${clr('# Monitor and auto-adjust', C.dim)}`);
  console.log(`    opencode-tier ultimate          ${clr('# Activate free pro models', C.dim)}`);
  console.log(`    opencode-tier install           ${clr('# Set up persistent service', C.dim)}`);
  console.log('');
  console.log(`  ${clr('INFO', C.bold)}`);
  console.log(`    Changes take effect on ${clr('NEXT', C.bold)} OpenCode session`);
  console.log(`    Config backups: ~/.local/share/opencode-tier/`);
    console.log(`    Docs: https://github.com/NickRivers1983/opencode-tier`);
  console.log('');
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function pathRelative(absPath) {
  const home = os.homedir();
  if (absPath.startsWith(home)) return '~' + absPath.slice(home.length);
  return absPath;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';

  // Check prerequisites
  try {
    require.resolve('./lib/tiers');
  } catch {
    error('opencode-tier modules not found. Run from the package directory.');
    process.exit(1);
  }

  switch (cmd) {
    case 'ultimate':
      return cmdApplyTier('ultimate');

    case 'green':
    case 'yellow':
    case 'orange':
    case 'red':
      return cmdApplyTier(cmd);

    case 'auto':
      return cmdAuto({ yes: args.includes('--yes') || args.includes('-y') });

    case 'watch':
      return cmdWatch(args[1]);

    case 'status':
    case 'st':
      return cmdStatus();

    case 'providers':
    case 'connect':
      return cmdProviders();

    case 'setup':
      return cmdSetup();

    case 'install':
      return cmdInstall();

    case 'uninstall':
      return cmdUninstall();

    case 'help':
    case '--help':
    case '-h':
    case '':
      return cmdHelp();

    default:
      error(`Unknown command: ${cmd}`);
      console.log(`  Run ${clr('opencode-tier help', C.bold)} for usage.`);
      process.exit(1);
  }
}

main();
