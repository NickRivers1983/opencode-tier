/**
 * opencode-tier — Provider auto-detection
 * ─────────────────────────────────────────
 * Scans the environment and opencode config to detect
 * which AI providers are connected and available.
 */

'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * @typedef {Object} ProviderStatus
 * @property {boolean} opencodeGo   - Paid Go plan connected
 * @property {boolean} opencodeZen  - Free Zen tier (always available)
 * @property {boolean} github       - GitHub Copilot (free via Education)
 * @property {boolean} google       - Google Gemini API key found
 * @property {string}  googleKeyHint - Masked key preview
 */

/**
 * Detect which providers are available.
 * Scans: env vars, opencode auth list, .env files, opencode.json.
 *
 * @returns {ProviderStatus}
 */
function detectProviders() {
  const result = {
    opencodeGo: false,
    opencodeZen: true,  // always available (no auth needed)
    github: false,
    google: false,
    googleKeyHint: '',
  };

  // 1. Check opencode auth list
  try {
    const authOutput = execSync('opencode auth list', {
      encoding: 'utf-8',
      timeout: 10000,
    }).toLowerCase();

    if (authOutput.includes('opencode') || authOutput.includes('go')) {
      result.opencodeGo = true;
    }
    if (authOutput.includes('github')) {
      result.github = true;
    }
    if (authOutput.includes('google')) {
      result.google = true;
    }
  } catch {
    // opencode auth not available or not configured
  }

  // 2. Check env vars for Google Gemini API key
  const googleKey = process.env.GOOGLE_API_KEY
    || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || '';

  if (googleKey) {
    result.google = true;
    result.googleKeyHint = googleKey.slice(0, 8) + '...' + googleKey.slice(-4);
  }

  // 3. Check ~/.config/opencode/.env
  if (!result.google) {
    const envPath = path.join(os.homedir(), '.config', 'opencode', '.env');
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const keyMatch = envContent.match(/^GOOGLE_API_KEY=(.+)$/m);
      if (keyMatch) {
        const key = keyMatch[1].trim();
        if (key && !key.startsWith('#')) {
          result.google = true;
          result.googleKeyHint = key.slice(0, 8) + '...' + key.slice(-4);
        }
      }
    } catch {
      // .env doesn't exist
    }
  }

  // 4. Check opencode.json for Google config
  if (!result.google) {
    try {
      const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const configRaw = fs.readFileSync(configPath, 'utf-8');
      if (configRaw.includes('google') || configRaw.includes('GOOGLE_API_KEY')) {
        result.google = true;
      }
    } catch {
      // config doesn't exist
    }
  }

  return result;
}

/**
 * Check if GitHub Copilot is available by trying a lightweight detection.
 *
 * @returns {boolean}
 */
function checkGitHubCopilot() {
  try {
    const out = execSync('opencode auth list', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return out.toLowerCase().includes('github');
  } catch {
    return false;
  }
}

/**
 * Determine the best possible tier given current provider connections.
 *
 * @param {ProviderStatus} providers
 * @returns {string} Recommended tier key
 */
function bestTierForProviders(providers) {
  // Ultimate requires BOTH GitHub Copilot AND Google Gemini
  if (providers.github && providers.google) {
    return 'ultimate';
  }
  // Partial free: can use orange (free Zen + one external free provider)
  if (providers.github || providers.google) {
    return 'orange';
  }
  if (providers.opencodeGo) {
    return 'yellow';
  }
  return 'red';
}

/**
 * Generate a human-readable setup guide.
 *
 * @param {ProviderStatus} providers
 * @returns {string[]} List of action items
 */
function setupGuide(providers) {
  const steps = [];

  if (!providers.github) {
    steps.push(
      '🔗 Connect GitHub Copilot (FREE via Education):',
      '   1. Verify your .edu email at https://github.com/settings/education/benefits',
      '   2. In OpenCode TUI, run:  /connect',
      '   3. Select "GitHub Copilot" and authorize',
      '   4. You get claude-3.5-sonnet + gpt-4o for FREE',
      '',
    );
  }

  if (!providers.google) {
    steps.push(
      '🔑 Add Google Gemini API key (FREE tier):',
      '   1. Go to https://aistudio.google.com/',
      '   2. Generate a free API key',
      '   3. Run:  opencode-tier setup',
      '   Or manually:',
      `     echo 'GOOGLE_API_KEY=your_key_here' >> ~/.bashrc`,
      '',
    );
  }

  if (providers.github && providers.google) {
    steps.push(
      '🎉 You have ALL free providers connected!',
      '   Run:  opencode-tier ultimate',
      '   To use professional models at $0/day.',
      '',
    );
  }

  if (!providers.opencodeGo) {
    steps.push(
      '💎 Optional: Subscribe to OpenCode Go',
      '   For paid models when you need full speed:',
      '   https://opencode.ai/pricing  ($5-10/mo)',
      '',
    );
  }

  return steps;
}

module.exports = {
  detectProviders,
  checkGitHubCopilot,
  bestTierForProviders,
  setupGuide,
};
