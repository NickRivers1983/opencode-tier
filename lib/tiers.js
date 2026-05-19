/**
 * opencode-tier — Tier definitions v3.0
 * ───────────────────────────────────
 * Optimized tier structure balancing maximum power, efficiency,
 * effectiveness, and cost-benefit across 5 providers.
 *
 * Tiers ordered from most to least expensive:
 *   GREEN (full paid) → YELLOW → ORANGE → RED (all free)
 *
 * ULTIMATE is special — $0/day using Google Gemini + OpenCode Zen
 *
 * Providers:
 *   opencode-go/...  = paid via Go credits ($12/5h plan)
 *   opencode/...     = free via OpenCode Zen (unlimited)
 *   google/...       = free via Google Gemini API key (per-model rate limits)
 *   mistral/...      = free via Mistral AI Experiment (2 RPM account-wide)
 *   deepseek/...     = paid via DeepSeek direct API (cheapest, $2 min)
 *
 * Key design principles (v3.0):
 *   1. Fixer is inviolable — last paid agent standing
 *   2. Zen is the workhorse — unlimited free for high-frequency agents
 *   3. Gemini is the specialist — best free reasoning for rare calls
 *   4. Pro is the luxury — 1.6T params for oracle in GREEN only
 *   5. MiniMax M2.5 is the crown jewel — 80.2% SWE-bench, free via Zen
 *   6. Each tier degrades each agent by at most one step
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
 * All 5 tiers.
 *
 * @type {Object<string, TierConfig>}
 */
const TIERS = {
  // ═══════════════════════════════════════════════════════════
  // ULTIMATE — $0/day. Google Gemini + Zen free models.
  // Best free quality achievable without Go credits.
  // ═══════════════════════════════════════════════════════════
  ultimate: {
    label: 'ULTIMATE',
    icon: '\u{1F7E3}',  // 🟣 purple circle
    description: '$0/day — Google Gemini (reasoning) + Zen free (unlimited). 85-90% of GREEN quality.',
    costRange: '$0/day (Google Gemini + OpenCode Zen)',
    requiresGo: false,
    agents: {
      oracle:     'google/gemini-2.5-flash',        // Best free reasoning, 10 RPM, rare calls
      councillor: 'opencode/deepseek-v4-flash-free',  // Unlimited Zen, strong reasoning
      explorer:   'opencode/qwen3.6-plus-free',       // Unlimited Zen, fast pattern matching
      librarian:  'google/gemini-2.5-flash-lite',     // 15 RPM, good instruction following
      fixer:      'opencode/minimax-m2.5-free',       // 🏆 80.2% SWE-bench, free, unlimited
      designer:   'opencode/qwen3.6-plus-free',       // Design specialist, unlimited
    },
    smallModel: 'opencode/deepseek-v4-flash-free',
  },

  // ═══════════════════════════════════════════════════════════
  // GREEN — Full power. All 6 agents on paid Go credits.
  // Use when budget is healthy and max quality is needed.
  // ═══════════════════════════════════════════════════════════
  green: {
    label: 'GREEN',
    icon: '\u{1F7E2}',  // 🟢 green circle
    description: 'Full power — all agents on paid Go models. 1.6T Pro for oracle.',
    costRange: '~$0.08/h — $2–5/day (Go paid)',
    requiresGo: true,
    agents: {
      oracle:     'opencode-go/deepseek-v4-pro',    // 1.6T params, ~80% SWE-bench, 1M ctx
      councillor: 'opencode-go/deepseek-v4-flash',  // Fast, good reasoning, rare calls
      explorer:   'opencode-go/deepseek-v4-flash',  // 1M context for large codebase searches
      librarian:  'opencode-go/deepseek-v4-flash',  // 1M context for doc analysis
      fixer:      'opencode-go/minimax-m2.5',       // 80.2% SWE-bench, coding specialist
      designer:   'opencode-go/qwen3.6-plus',       // Best design/creative model
    },
    smallModel: 'opencode-go/deepseek-v4-flash',
  },

  // ═══════════════════════════════════════════════════════════
  // YELLOW — Balanced. 3 paid + 3 free. ~74% cost reduction.
  // Explorer, councillor, librarian move to free Zen.
  // Oracle, fixer, designer remain on paid Go.
  // ═══════════════════════════════════════════════════════════
  yellow: {
    label: 'YELLOW',
    icon: '\u{1F7E1}',  // 🟡 yellow circle
    description: 'Balanced — 3 paid (oracle/fixer/designer) + 3 free Zen. ~74% cheaper than GREEN.',
    costRange: '~$0.02/h — $0.50–1.50/day (Go paid)',
    requiresGo: true,
    agents: {
      oracle:     'opencode-go/deepseek-v4-flash',    // Paid: reasoning quality matters
      councillor: 'opencode/deepseek-v4-flash-free',   // Free: less reasoning depth needed
      explorer:   'opencode/qwen3.6-plus-free',        // Free: speed over depth for search
      librarian:  'opencode/deepseek-v4-flash-free',   // Free: general purpose sufficient
      fixer:      'opencode-go/minimax-m2.5',          // ⛔ KEPT PAID: code quality is non-negotiable
      designer:   'opencode-go/qwen3.6-plus',          // Paid: cheap model, design nuance matters
    },
    smallModel: 'opencode-go/minimax-m2.5',
  },

  // ═══════════════════════════════════════════════════════════
  // ORANGE — Economy. 1 paid (fixer) + 5 free. ~78% cost reduction.
  // Only fixer stays on paid Go. Oracle moves to Google Gemini.
  // ═══════════════════════════════════════════════════════════
  orange: {
    label: 'ORANGE',
    icon: '\u{1F7E0}',  // 🟠 orange circle
    description: 'Economy — only fixer on paid Go. Oracle uses Gemini Flash (free).',
    costRange: '~$0.02/h — $0.30–1/day (Go paid, fixer only)',
    requiresGo: true,
    agents: {
      oracle:     'google/gemini-2.5-flash',           // Free: best free reasoning, 10 RPM
      councillor: 'opencode/deepseek-v4-flash-free',   // Free, unlimited
      explorer:   'opencode/qwen3.6-plus-free',        // Free, unlimited
      librarian:  'opencode/deepseek-v4-flash-free',   // Free, unlimited
      fixer:      'opencode-go/minimax-m2.5',          // ⛔ LAST PAID STANDING — code quality preserved
      designer:   'opencode/qwen3.6-plus-free',        // Free: design tolerates downgrade
    },
    smallModel: 'opencode/deepseek-v4-flash-free',
  },

  // ═══════════════════════════════════════════════════════════
  // RED — Survival. All 6 agents on free Zen. Unlimited, $0.
  // Diversified across 3 Zen models to avoid single-model dependency.
  // MiniMax M2.5-free has same model weights as paid version.
  // ═══════════════════════════════════════════════════════════
  red: {
    label: 'RED',
    icon: '\u{1F534}',  // 🔴 red circle
    description: 'Survival — all Zen free. 3-model diversification. MiniMax-free same weights as paid.',
    costRange: '$0/day (Zen free, unlimited)',
    requiresGo: false,
    agents: {
      oracle:     'opencode/deepseek-v4-flash-free',  // Best Zen reasoning
      councillor: 'opencode/deepseek-v4-flash-free',  // Same model, zero cost
      explorer:   'opencode/qwen3.6-plus-free',       // Fast, unlimited
      librarian:  'opencode/deepseek-v4-flash-free',  // General purpose, unlimited
      fixer:      'opencode/minimax-m2.5-free',       // 🏆 Same model as paid, only queue differs
      designer:   'opencode/qwen3.6-plus-free',       // Design/creative, unlimited
    },
    smallModel: 'opencode/deepseek-v4-flash-free',
  },
};

/**
 * Ordered list of standard tier keys from most to least expensive.
 * ULTIMATE is excluded — it's a manual choice, not auto-selected.
 */
const TIER_ORDER = ['green', 'yellow', 'orange', 'red'];

/**
 * Known agents that can receive tier-specific model overrides.
 */
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

  // Check ultimate first — characterized by Google Gemini on oracle
  // and Zen free models on fixer
  const o = modelOf('oracle');
  const f = modelOf('fixer');
  if (o === 'google/gemini-2.5-flash' && f && f.includes('-free')) {
    return 'ultimate';
  }

  // Check standard tiers by oracle model (most distinctive per tier)
  for (const key of TIER_ORDER) {
    const tier = TIERS[key];
    if (modelOf('oracle') === tier.agents.oracle) return key;
  }

  return 'custom';
}

/**
 * Select the best tier given an urgency score (0–100).
 * Falls back to free-only tiers if Go credits aren't available.
 *
 * v3.0 thresholds (widened to maximize free quality at low urgency):
 *   green  < 60   (was 30) — stay premium longer when budget allows
 *   yellow < 80   (was 60) — balanced zone
 *   orange < 90   (was 85) — strip to fixer-only paid
 *   red    >= 90            — all free survival
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
    const thresholds = { green: 60, yellow: 80, orange: 90 };
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
