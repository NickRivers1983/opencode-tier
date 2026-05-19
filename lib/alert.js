/**
 * opencode-tier — Alert & warning system
 * ───────────────────────────────────────
 * Preemptive budget warnings and tier change notifications.
 *
 * Warnings are sent at configurable urgency thresholds:
 *   60% — heads-up: budget usage is climbing
 *   80% — caution: consider switching to a lower tier
 *   90% — critical: budget almost exhausted, RED tier recommended
 *
 * Rate-limited to prevent spam: each threshold warns at most once per
 * WARNING_COOLDOWN_MS (default 1 hour — fast enough for 5-min checks).
 */

'use strict';

const notify = require('./notify');
const config = require('./config');

// ─── Constants ────────────────────────────────────────────────────────────

/** Urgency thresholds at which to send preemptive warnings. */
const WARNING_THRESHOLDS = [60, 80, 90];

/** Minimum time between warning notifications of the same level. */
const WARNING_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour (was 6h)

// ─── Warning messages ────────────────────────────────────────────────────

function warningMessage(urgency, breakdown) {
  const pct = Math.round(urgency);
  const lines = [];

  if (pct >= 90) {
    lines.push(`CRITICAL: Budget at ${pct}% of limit!`);
    lines.push(`Switching to RED (free Zen) recommended immediately.`);
    lines.push(`Run: opencode-tier red`);
  } else if (pct >= 80) {
    lines.push(`Warning: Budget at ${pct}% of limit.`);
    lines.push(`Consider switching to ORANGE or RED tier.`);
    lines.push(`Run: opencode-tier auto`);
  } else {
    lines.push(`Heads up: Budget usage at ${pct}%`);
    if (breakdown) {
      lines.push(`5h: ${breakdown.score5h}% | Weekly: ${breakdown.scoreWeekly}% | Monthly: ${breakdown.scoreMonthly}%`);
    }
    lines.push(`Run: opencode-tier status for details`);
  }

  return lines.join('\n');
}

function warningTitle(urgency) {
  if (urgency >= 90) return 'BUDGET CRITICAL';
  if (urgency >= 80) return 'Budget Warning';
  return 'Budget Notice';
}

// ─── Tier change notification ────────────────────────────────────────────

/**
 * Send a notification when a tier change occurs.
 *
 * @param {string} tierKey     - New tier (e.g. 'red')
 * @param {Object} tierDef     - Tier definition from tiers.js
 * @param {'auto'|'manual'} source - Who initiated the change
 */
function notifyTierChange(tierKey, tierDef, source) {
  const icon = tierDef.icon || '';
  const label = tierDef.label || tierKey.toUpperCase();
  const desc = tierDef.description || '';
  const cost = tierDef.costRange || '';

  const title = source === 'auto'
    ? `${icon} Auto-switched to ${label}`
    : `${icon} Tier changed to ${label}`;

  const body = `${desc}\n${cost}`;

  // Always console log
  if (source === 'auto') {
    console.log(`  [ALERT] Auto-switched tier to ${icon} ${label}`);
  }

  // Send desktop notification
  const urg = tierKey === 'red' ? 'critical' : 'normal';
  notify.notify({ title, body, urgency: urg });
}

// ─── Preemptive warnings ─────────────────────────────────────────────────

/**
 * Check urgency against warning thresholds and log warnings.
 * Rate-limited: each threshold warns at most once per WARNING_COOLDOWN_MS.
 *
 * Console-only warnings (no desktop notification — desktop notifications
 * are reserved for actual tier change events via notifyTierChange).
 *
 * @param {number} urgency   - Current budget urgency (0-100)
 * @param {Object} breakdown - { score5h, scoreWeekly, scoreMonthly }
 * @returns {boolean} True if a warning was sent
 */
function checkAndWarn(urgency, breakdown) {
  if (urgency === null || urgency === undefined) return false;

  const history = config.state.get('warningHistory', {});
  let sent = false;

  for (const threshold of WARNING_THRESHOLDS) {
    if (urgency >= threshold) {
      const lastSent = history[`threshold_${threshold}`] || 0;
      const elapsed = Date.now() - lastSent;

      if (elapsed >= WARNING_COOLDOWN_MS) {
        // Console warning (not desktop notification to avoid rate limiting)
        const pct = urgency >= 90 ? `\x1b[31m${urgency}%\x1b[0m` : `\x1b[33m${urgency}%\x1b[0m`;
        console.log(`  [ALERT] Budget at ${pct} — ${warningTitle(urgency)}`);

        // Record
        history[`threshold_${threshold}`] = Date.now();
        sent = true;

        // For critical (90%), don't warn for lower thresholds in same cycle
        if (threshold >= 90) break;
      }
    }
  }

  if (sent) {
    config.state.set('warningHistory', history);
  }

  return sent;
}

/**
 * Get the highest threshold that has been breached.
 *
 * @returns {number|null}
 */
function getHighestWarningLevel() {
  const history = config.state.get('warningHistory', {});
  let highest = null;

  for (const threshold of WARNING_THRESHOLDS) {
    if (history[`threshold_${threshold}`]) {
      highest = threshold;
    }
  }

  return highest;
}

/**
 * Reset all warning history (e.g., after budget cycle resets).
 */
function resetWarnings() {
  config.state.set('warningHistory', {});
}

// ─── Imminent boundary detection ─────────────────────────────────────────

/** Tier boundary thresholds (urgency % where tier switches). */
const BOUNDARY_THRESHOLDS = [60, 80, 90]; // green→yellow, yellow→orange, orange→red

/** Zone width: detect approach within this % of each boundary. */
const IMMINENT_ZONE = 5;

/** Critical zone: within this %, send hard-stop SAVE NOW notification. */
const CRITICAL_ZONE = 2;

/** Tier names matching BOUNDARY_THRESHOLDS (the tier we're about to enter). */
const BOUNDARY_TIERS = ['YELLOW', 'ORANGE', 'RED'];

/**
 * Check if urgency is approaching a tier boundary and notify the user
 * to SAVE THEIR WORK before the tier switch triggers.
 *
 * This is the "hard stop" pre-switch signal. Since OpenCode doesn't reload
 * config mid-session, the user MUST manually save and restart. This gives
 * them advance warning to do so.
 *
 * Two notification levels:
 *   - IMMINENT (within 5% of boundary): "Prepare to save"
 *   - CRITICAL (within 2% of boundary): "SAVE NOW — tier change imminent"
 *
 * Rate-limited: each boundary warns at most once per IMMINENT_COOLDOWN.
 *
 * @param {number} urgency - Current budget urgency (0-100)
 * @returns {{ imminent: boolean, boundary: number|null, tier: string|null, level: 'imminent'|'critical'|null }}
 */
function checkImminentBoundary(urgency) {
  if (urgency === null || urgency === undefined) {
    return { imminent: false, boundary: null, tier: null, level: null };
  }

  const history = config.state.get('imminentHistory', {});

  for (let i = 0; i < BOUNDARY_THRESHOLDS.length; i++) {
    const boundary = BOUNDARY_THRESHOLDS[i];
    const tierName = BOUNDARY_TIERS[i];
    const distance = boundary - urgency;

    // Only check if we're below the boundary but within the imminent zone
    if (distance <= 0 || distance > IMMINENT_ZONE) continue;

    // Rate limit: don't spam the same boundary approach
    const lastNotified = history[`boundary_${boundary}`] || 0;
    const cooldown = 10 * 60 * 1000; // 10 min cooldown per boundary
    if (Date.now() - lastNotified < cooldown) continue;

    const level = distance <= CRITICAL_ZONE ? 'critical' : 'imminent';
    const urgencyPct = Math.round(urgency);
    const remainingPct = Math.round(distance);

    // Build notification
    let title, body;
    if (level === 'critical') {
      title = `⛔ SAVE NOW — Switching to ${tierName} in ~${remainingPct}%`;
      body = [
        `Urgency ${urgencyPct}% — tier change at ${boundary}%.`,
        `1. SAVE all work in OpenCode`,
        `2. CLOSE and REOPEN OpenCode`,
        `3. New tier ${tierName} will be active`,
      ].join('\n');
    } else {
      title = `⚠️ Approaching ${tierName} tier (${boundary}%)`;
      body = [
        `Urgency at ${urgencyPct}% — ${remainingPct}% until tier switch.`,
        `Prepare to save your work.`,
        `Run: opencode-tier status`,
      ].join('\n');
    }

    // Console log (always visible in service output)
    const urgencyStr = level === 'critical'
      ? `\x1b[31m${urgencyPct}%\x1b[0m`
      : `\x1b[33m${urgencyPct}%\x1b[0m`;
    console.log(`  [IMMINENT] Budget ${urgencyStr} → approaching ${tierName} tier at ${boundary}% (${level})`);

    // Desktop notification (high priority for critical)
    const urg = level === 'critical' ? 'critical' : 'normal';
    notify.notify({ title, body, urgency: urg });

    // Record notification time
    history[`boundary_${boundary}`] = Date.now();
    config.state.set('imminentHistory', history);

    return { imminent: true, boundary, tier: tierName, level };
  }

  return { imminent: false, boundary: null, tier: null, level: null };
}

/**
 * Reset imminent boundary history (e.g., after budget cycle resets).
 */
function resetImminentHistory() {
  config.state.set('imminentHistory', {});
}

module.exports = {
  WARNING_THRESHOLDS,
  WARNING_COOLDOWN_MS,
  notifyTierChange,
  checkAndWarn,
  getHighestWarningLevel,
  resetWarnings,
  checkImminentBoundary,
  resetImminentHistory,
  BOUNDARY_THRESHOLDS,
};
