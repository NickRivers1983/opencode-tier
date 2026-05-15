/**
 * opencode-tier — Desktop notification system
 * ────────────────────────────────────────────
 * Cross-platform desktop notifications for tier changes and budget alerts.
 *
 * Linux:   notify-send (libnotify)
 * macOS:   osascript display notification
 * Windows: PowerShell toast (or falls back to console)
 *
 * Falls back gracefully to console output if no notification system available.
 */

'use strict';

const { execSync } = require('node:child_process');
const os = require('node:os');

/**
 * Send a desktop notification.
 *
 * @param {Object} opts
 * @param {string} opts.title   - Notification title
 * @param {string} opts.body    - Notification body text
 * @param {string} [opts.urgency] - 'low' | 'normal' | 'critical' (Linux only)
 * @param {boolean} [opts.silent] - If true, skip notification, only log
 * @returns {boolean} True if notification was sent
 */
function notify(opts = {}) {
  const { title, body, urgency = 'normal', silent = false } = opts;

  if (silent || !title) return false;

  // CI environments — never attempt desktop notifications
  if (process.env.CI) return false;
  if (!process.stdout.isTTY && !process.env.DISPLAY) return false;

  const platform = os.platform();

  try {
    if (platform === 'linux') {
      return notifyLinux(title, body, urgency);
    }
    if (platform === 'darwin') {
      return notifyMac(title, body);
    }
    if (platform === 'win32') {
      return notifyWindows(title, body);
    }
  } catch {
    // Notification failed — non-critical
  }

  return false;
}

/**
 * Send notification via notify-send (Linux/libnotify).
 */
function notifyLinux(title, body, urgency) {
  const urgMap = { low: 'low', normal: 'normal', critical: 'critical' };
  const urg = urgMap[urgency] || 'normal';

  // Check if notify-send is available
  try {
    execSync('which notify-send', { timeout: 2000 });
  } catch {
    return false; // notify-send not installed
  }

  // Escape single quotes in title/body for shell safety
  const escTitle = title.replace(/'/g, "'\\''");
  const escBody = body.replace(/'/g, "'\\''");

  execSync(
    `notify-send '${escTitle}' '${escBody}' --urgency=${urg} --app-name=opencode-tier --icon=dialog-information 2>/dev/null`,
    { timeout: 5000 }
  );
  return true;
}

/**
 * Send notification via osascript (macOS).
 */
function notifyMac(title, body) {
  const escTitle = title.replace(/"/g, '\\"');
  const escBody = body.replace(/"/g, '\\"');

  execSync(
    `osascript -e 'display notification "${escBody}" with title "${escTitle}"'`,
    { timeout: 5000 }
  );
  return true;
}

/**
 * Send notification via PowerShell toast (Windows).
 */
function notifyWindows(title, body) {
  const escTitle = title.replace(/"/g, '`"');
  const escBody = body.replace(/"/g, '`"');

  execSync(
    `powershell -Command "& {[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $textNodes = $template.GetElementsByTagName('text'); $textNodes.Item(0).AppendChild($template.CreateTextNode('${escTitle}')) > $null; $textNodes.Item(1).AppendChild($template.CreateTextNode('${escBody}')) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('opencode-tier').Show($toast)}"`,
    { timeout: 5000, windowsHide: true }
  );
  return true;
}

/**
 * Check if desktop notifications are available on this system.
 *
 * @returns {{ available: boolean, method: string|null }}
 */
function checkAvailability() {
  const platform = os.platform();

  if (platform === 'linux') {
    try {
      execSync('which notify-send', { timeout: 2000 });
      return { available: true, method: 'notify-send' };
    } catch {
      return { available: false, method: null };
    }
  }

  if (platform === 'darwin') {
    return { available: true, method: 'osascript' };
  }

  if (platform === 'win32') {
    return { available: true, method: 'PowerShell toast' };
  }

  return { available: false, method: null };
}

module.exports = {
  notify,
  checkAvailability,
};
