/**
 * opencode-tier — Budget analyzer
 * ─────────────────────────────────
 * Runs `opencode stats`, parses the text output to extract cost data,
 * then computes an urgency score based on OpenCode Go usage limits.
 *
 * Go limits (as of May 2026):
 *   $12 / rolling 5 hours
 *   $30 / week
 *   $60 / month
 */

'use strict';

const { execSync } = require('node:child_process');

/** Default Go plan spending limits (USD). */
const DEFAULT_LIMITS = {
  limit5h:     12.0,
  limitWeekly: 30.0,
  limitMonthly: 60.0,
};

/**
 * Parse the text output of `opencode stats` and extract the total cost.
 *
 * Expected format (from opencode stats):
 *   │Total Cost                                       $10.93 │
 *
 * @param {string} output - Raw stdout from `opencode stats`
 * @returns {number|null} Total cost in USD, or null if not found
 */
function parseTotalCost(output) {
  if (!output) return null;
  // Match: $X.XX anywhere in the output
  const lines = output.split('\n');
  for (const line of lines) {
    // Look for "Total Cost" or any line with $
    if (line.includes('Total Cost') || line.includes('Total')) {
      const match = line.match(/\$([0-9]+\.?[0-9]*)/);
      if (match) return parseFloat(match[1]);
    }
  }
  // Fallback: find any dollar amount
  const fallback = output.match(/\$([0-9]+\.?[0-9]*)/);
  return fallback ? parseFloat(fallback[1]) : null;
}

/**
 * Parse all cost-related data from stats output.
 * Returns a structured object with all detectable metrics.
 * Uses multiple fallback strategies for resilience against output format changes.
 *
 * @param {string} output - Raw stdout from `opencode stats`
 * @returns {Object} Parsed stats
 */
function parseAllStats(output) {
  const result = {
    totalCost: null,
    sessions: null,
    messages: null,
    days: null,
    inputTokens: null,
    outputTokens: null,
    cacheRead: null,
    cacheWrite: null,
  };

  if (!output) return result;

  const lines = output.split('\n');
  let lastDollarLine = null;
  let lastDollarValue = null;

  for (const line of lines) {
    // Track any dollar amount as last-resort fallback
    const anyDollar = line.match(/\$([0-9]+\.?[0-9]*)/);
    if (anyDollar) {
      lastDollarLine = line;
      lastDollarValue = parseFloat(anyDollar[1]);
    }

    // Total Cost — try multiple label variants
    const costMatch = line.match(/(?:Total\s*Cost|Total|Cost)\s+\$?([0-9]+\.?[0-9]*)/i);
    if (costMatch) result.totalCost = parseFloat(costMatch[1]);

    // Sessions
    const sessMatch = line.match(/Sessions?\s+(\d+)/i);
    if (sessMatch) result.sessions = parseInt(sessMatch[1], 10);

    // Messages
    const msgMatch = line.match(/Messages?\s+([\d,]+)/i);
    if (msgMatch) result.messages = parseInt(msgMatch[1].replace(/,/g, ''), 10);

    // Days
    const daysMatch = line.match(/Days?\s+(\d+)/i);
    if (daysMatch) result.days = parseInt(daysMatch[1], 10);

    // Token counts — match patterns like "Input  1.2M" or "Input Tokens  500K"
    const inMatch = line.match(/(?:Input|Input\s+Tokens?)\s+([\d.]+)\s*([MK]?)/i);
    if (inMatch) {
      let val = parseFloat(inMatch[1]);
      if (inMatch[2] === 'M') val *= 1_000_000;
      else if (inMatch[2] === 'K') val *= 1_000;
      result.inputTokens = val;
    }

    const outMatch = line.match(/(?:Output|Output\s+Tokens?)\s+([\d.]+)\s*([MK]?)/i);
    if (outMatch) {
      let val = parseFloat(outMatch[1]);
      if (outMatch[2] === 'M') val *= 1_000_000;
      else if (outMatch[2] === 'K') val *= 1_000;
      result.outputTokens = val;
    }

    // Cache Read
    const cacheReadMatch = line.match(/(?:Cache\s+Read|Cache\s+read)\s+([\d.]+)\s*([MK]?)/i);
    if (cacheReadMatch) {
      let val = parseFloat(cacheReadMatch[1]);
      if (cacheReadMatch[2] === 'M') val *= 1_000_000;
      else if (cacheReadMatch[2] === 'K') val *= 1_000;
      result.cacheRead = val;
    }

    // Cache Write
    const cacheWriteMatch = line.match(/(?:Cache\s+Write|Cache\s+write)\s+([\d.]+)\s*([MK]?)/i);
    if (cacheWriteMatch) {
      let val = parseFloat(cacheWriteMatch[1]);
      if (cacheWriteMatch[2] === 'M') val *= 1_000_000;
      else if (cacheWriteMatch[2] === 'K') val *= 1_000;
      result.cacheWrite = val;
    }
  }

  // Fallback: if totalCost not found but we saw a dollar amount, use it
  if (result.totalCost === null && lastDollarValue !== null) {
    result.totalCost = lastDollarValue;
  }

  return result;
}

/**
 * Run `opencode stats` and return parsed data.
 *
 * @param {Object} [opts]
 * @param {number} [opts.days=1] - Number of days for stats
 * @returns {Object} { dailyStats, totalStats, dailyCost, totalCost }
 */
function runStats(opts = {}) {
  const days = opts.days || 1;

  let dailyOutput = null;
  let totalOutput = null;

  try {
    dailyOutput = execSync(`opencode stats --days ${days}`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
  } catch {
    // opencode might be busy or not running
    try {
      execSync('opencode --version', { encoding: 'utf-8', timeout: 5000 });
      // opencode exists but stats may need a running session
    } catch {
      throw new Error('opencode CLI not found or not installed');
    }
  }

  try {
    totalOutput = execSync('opencode stats', {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
  } catch {
    // Non-fatal — we can work with daily stats only
  }

  const dailyParsed = parseAllStats(dailyOutput);
  const totalParsed = parseAllStats(totalOutput);

  return {
    dailyStats:  dailyParsed,
    totalStats:  totalParsed,
    dailyCost:   dailyParsed.totalCost,
    totalCost:   totalParsed.totalCost || dailyParsed.totalCost,
  };
}

/**
 * Compute an urgency score (0–100) based on cost data and Go limits.
 *
 * Algorithm (same as v1 but with JavaScript math):
 *   5h urgency  = (dailyCost * 5/24) / limit5h * 100
 *   weekly      = (dailyCost * 7) / limitWeekly * 100
 *   monthly     = totalCost / limitMonthly * 100
 *   final       = Math.max(all three), clamped 0–100
 *
 * @param {number} dailyCost  - Spend in last 24h
 * @param {number} totalCost  - All-time spend
 * @param {Object} [limits]   - Custom limits (overrides DEFAULT_LIMITS)
 * @returns {Object} { urgency, breakdown: { score5h, scoreWeekly, scoreMonthly } }
 */
function calculateUrgency(dailyCost, totalCost, limits) {
  const lim = { ...DEFAULT_LIMITS, ...limits };

  const score5h     = dailyCost > 0 ? ((dailyCost * 5 / 24) / lim.limit5h) * 100 : 0;
  const scoreWeekly = dailyCost > 0 ? ((dailyCost * 7) / lim.limitWeekly) * 100 : 0;
  const scoreMonthly = totalCost > 0 ? (totalCost / lim.limitMonthly) * 100 : 0;

  const urgency = Math.min(100, Math.max(0, Math.ceil(Math.max(score5h, scoreWeekly, scoreMonthly))));

  return {
    urgency,
    breakdown: {
      score5h:      Math.round(score5h),
      scoreWeekly:  Math.round(scoreWeekly),
      scoreMonthly: Math.round(scoreMonthly),
    },
  };
}

/**
 * High-level analysis: run stats + calculate urgency in one call.
 *
 * @param {Object} [opts]
 * @param {number} [opts.days=1]
 * @param {Object} [opts.limits] - Custom Go limits
 * @returns {Object} { dailyCost, totalCost, urgency, breakdown, stats }
 */
function analyze(opts = {}) {
  const stats = runStats(opts);
  const { dailyCost, totalCost } = stats;

  if (dailyCost === null && totalCost === null) {
    return {
      dailyCost: null,
      totalCost: null,
      urgency: null,
      breakdown: null,
      stats,
      error: 'No cost data available from opencode stats',
    };
  }

  const cost = dailyCost || 0;
  const total = totalCost || cost;
  const result = calculateUrgency(cost, total, opts.limits);

  return {
    dailyCost: cost,
    totalCost: total,
    urgency: result.urgency,
    breakdown: result.breakdown,
    stats,
  };
}

module.exports = {
  DEFAULT_LIMITS,
  parseTotalCost,
  parseAllStats,
  runStats,
  calculateUrgency,
  analyze,
};
