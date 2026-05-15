/**
 * opencode-tier — Tier definitions
 * ───────────────────────────────────
 * Each tier defines a model per agent, with estimated daily cost
 * and a description of when to use it.
 *
 * Tiers are ordered from most expensive to cheapest:
 *   GREEN (full paid) → YELLOW → ORANGE → RED (all free)
 *
 * The ULTIMATE tier is special — it uses FREE provider-based models
 * (GitHub Copilot, Google Gemini, OpenCode Zen) and costs $0/day
 * when all providers are connected.
 */

'use strict';

/**
 * @typedef {Object} TierConfig
 * @property {string} label       - Display name (e.g. "GREEN")
 * @property {string} icon        - Single emoji icon
 * @property {string} description - One-line description
 * @property {Object<string, string>} agents - Map of agent → model ID
 * @property {string} costRange   - Estimated daily cost range
 */

/**
 * All 5 standard tiers.
 * Each tier defines model overrides for every known agent.
 * Agents not listed inherit the default model (set in opencode.json top-level).
 *
 * Model ID format:  provider/model-name
 *   opencode-go/...   = paid via Go credits ($5-10/mo plan)
 *   opencode/...      = free via OpenCode Zen
 *   google/...        = free via Google Gemini API key (1500 req/day)
 *   github/...        = free via GitHub Copilot (Education or Pro)
 *
 * @type {Object<string, TierConfig>}
 */
const TIERS = {
  ultimate: {
    label: 'ULTIMATE',
    icon: '\u{1F7E3}',  // purple circle
    description: 'Professional-grade models at $0/day — requires GitHub Copilot + Google Gemini',
    costRange: '$0/day (when all free providers connected)',
    requiresGo: false,
    agents: {
      oracle:     'google/gemini-2.5-flash',
      councillor: 'google/gemini-2.5-flash',
      explorer:   'opencode/deepseek-v4-flash-free',
      librarian:  'google/gemini-2.5-flash',
      fixer:      'google/gemini-2.5-flash',
      designer:   'opencode/qwen3.6-plus-free',
    },
    smallModel: 'opencode/deepseek-v4-flash-free',
  },

  green: {
    label: 'GREEN',
    icon: '\u{1F7E2}',  // green circle
    description: 'Full power — fastest premium models via Go credits',
    costRange: '$6–12/day (Go paid)',
    requiresGo: true,
    agents: {
      oracle:     'opencode-go/deepseek-v4-pro',
      councillor: 'opencode-go/deepseek-v4-pro',
      explorer:   'opencode-go/deepseek-v4-flash',
      librarian:  'opencode-go/deepseek-v4-flash',
      fixer:      'opencode-go/deepseek-v4-flash',
      designer:   'opencode-go/qwen3.6-plus',
    },
    smallModel: 'opencode-go/deepseek-v4-flash',
  },

  yellow: {
    label: 'YELLOW',
    icon: '\u{1F7E1}',  // yellow circle
    description: 'Balanced — mid-range paid models, good speed/cost ratio',
    costRange: '$2–5/day (Go paid)',
    requiresGo: true,
    agents: {
      oracle:     'opencode-go/deepseek-v4-flash',
      councillor: 'opencode-go/deepseek-v4-flash',
      explorer:   'opencode-go/deepseek-v4-flash',
      librarian:  'opencode-go/deepseek-v4-flash',
      fixer:      'opencode-go/minimax-m2.5',
      designer:   'opencode-go/qwen3.6-plus',
    },
    smallModel: 'opencode-go/minimax-m2.5',
  },

  orange: {
    label: 'ORANGE',
    icon: '\u{1F7E0}',  // orange circle
    description: 'Economy — mix of cheap paid models + free Zen models',
    costRange: '$0.30–1/day (stretches Go credits far)',
    requiresGo: true,
    agents: {
      oracle:     'opencode-go/minimax-m2.5',
      councillor: 'opencode-go/minimax-m2.5',
      explorer:   'opencode/deepseek-v4-flash-free',
      librarian:  'opencode/deepseek-v4-flash-free',
      fixer:      'opencode/minimax-m2.5-free',
      designer:   'opencode/qwen3.6-plus-free',
    },
    smallModel: 'opencode/deepseek-v4-flash-free',
  },

  red: {
    label: 'RED',
    icon: '\u{1F534}',  // red circle
    description: 'Survival — free Zen models only. Zero cost, unlimited use.',
    costRange: '$0/day (Zen free, unlimited)',
    requiresGo: false,
    agents: {
      oracle:     'opencode/big-pickle',
      councillor: 'opencode/big-pickle',
      explorer:   'opencode/big-pickle',
      librarian:  'opencode/big-pickle',
      fixer:      'opencode/big-pickle',
      designer:   'opencode/big-pickle',
    },
    smallModel: 'opencode/big-pickle',
  },
};

/** Ordered list of tier keys from most to least expensive. */
const TIER_ORDER = ['green', 'yellow', 'orange', 'red'];

/** Known agents that can receive tier-specific model overrides. */
const KNOWN_AGENTS = [
  'oracle',
  'councillor',
  'explorer',
  'librarian',
  'fixer',
  'designer',
];

/**
 * Detect which tier a config matches.
 * Compares agent models against each tier definition.
 *
 * @param {Object} agentConfig - The `agent` section of opencode.json
 * @returns {string} Tier key ('ultimate', 'green', 'yellow', 'orange', 'red', or 'custom')
 */
function detectTier(agentConfig) {
  if (!agentConfig) return 'custom';

  const modelOf = (name) => (agentConfig[name] && agentConfig[name].model) || '';

  // Check ultimate first (special: uses github/google/opencode mix)
  const u = TIERS.ultimate.agents;
  const o = modelOf('oracle');
  const l = modelOf('librarian');
  if (o && (o.startsWith('github/') || o.startsWith('google/')) && l && l.startsWith('google/')) {
    return 'ultimate';
  }

  // Check standard tiers
  for (const key of TIER_ORDER) {
    const tier = TIERS[key];
    let matches = 0;
    let total = 0;
    for (const [agent, expected] of Object.entries(tier.agents)) {
      total++;
      if (modelOf(agent) === expected) matches++;
    }
    // Heuristic: if the oracle model matches, it's likely this tier
    if (modelOf('oracle') === tier.agents.oracle) return key;
  }

  return 'custom';
}

/**
 * Select the best tier given an urgency score (0–100).
 * Falls back to free-only tiers if Go credits aren't available.
 *
 * @param {number} urgency - 0 (no usage) to 100 (at limit)
 * @param {Object} [options]
 * @param {boolean} [options.hasGo] - Whether Go credits are connected
 * @returns {{ key: string, tier: TierConfig }}
 */
function selectTierForUrgency(urgency, { hasGo } = {}) {
  // Walk tier order from most expensive to cheapest
  for (const key of TIER_ORDER) {
    const tier = TIERS[key];
    // Skip Go-requiring tiers if Go isn't available
    if (tier.requiresGo && hasGo === false) continue;
    // Check urgency threshold
    const thresholds = { green: 30, yellow: 60, orange: 85 };
    if (urgency < (thresholds[key] ?? Infinity)) {
      return { key, tier };
    }
  }
  // Fallback: always-safe RED
  return { key: 'red', tier: TIERS.red };
}

module.exports = {
  TIERS,
  TIER_ORDER,
  KNOWN_AGENTS,
  detectTier,
  selectTierForUrgency,
};
