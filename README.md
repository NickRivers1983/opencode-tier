# opencode-tier 🧠⚡

> **Autonomous model tier switcher for OpenCode.**  
> Proactively monitors your Go credits and automatically switches between premium/free model tiers based on real-time budget analysis. No user intervention needed — set it and forget it.

```
opencode-tier auto --yes    # Hands-free budget-aware switching
opencode-tier watch         # Continuous monitoring daemon
opencode-tier ultimate      # Professional models at $0/day
```

[![npm version](https://img.shields.io/npm/v/opencode-tier.svg)](https://www.npmjs.com/package/opencode-tier)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-linux%20|%20macOS%20|%20windows-lightgrey)](https://npmjs.org/package/opencode-tier)

---

## The Problem

You're deep in a complex refactor. Models are firing. Code is flowing. Then suddenly:

```
Rate limit exceeded. Your Go credits have run out.
```

Your session dies. Your context vanishes. You wait — or you rebuild from scratch.

OpenCode Go has hard limits:
| Window | Limit |
|--------|-------|
| Rolling 5 hours | ~$12 |
| Weekly | ~$30 |
| Monthly | ~$60 |

Existing solutions are **reactive**: they only kick in *after* you've already hit the wall. **opencode-tier** is *proactive*: it watches your burn rate and downgrades tiers *before* you exhaust your budget, keeping you productive on free models instead of dead in the water.

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│  1. 📊  opencode stats  ← reads your actual spend       │
│  2. 🧮  Calculates urgency against Go limits            │
│  3. 🎯  Selects optimal tier for current burn rate      │
│  4. 🔄  Applies tier to opencode.json (next session)    │
│  5. ⏰  Repeats every 30 minutes (or your interval)     │
└──────────────────────────────────────────────────────────┘
```

## Tier System

| Tier | Daily Cost | When | Models |
|------|-----------|------|--------|
| 🟣 **Ultimate** | $0 | All free providers connected | `github/claude-3.5-sonnet`, `google/gemini-2.5-flash`, `opencode/deepseek-v4-flash-free` |
| 🟢 **Green** | $6–12 | Low usage, full speed needed | `opencode-go/deepseek-v4-pro` (oracle), `opencode-go/qwen3.6-plus` (designer) |
| 🟡 **Yellow** | $2–5 | Moderate usage, balanced | `opencode-go/deepseek-v4-flash` (oracle), `opencode-go/minimax-m2.5` (fixer) |
| 🟠 **Orange** | $0.30–1 | Budget getting tight | `opencode-go/minimax-m2.5` (oracle), `opencode/deepseek-v4-flash-free` (explorer) |
| 🔴 **Red** | $0 | Approaching limits, survival | `opencode/big-pickle` (all agents) |

Each tier assigns **different models per agent** — oracle gets the best, explorer gets a lighter model, etc.

## Installation

### Quick install (recommended)

```bash
npm install -g opencode-tier

# Verify it works
opencode-tier help
```

### Or run directly

```bash
npx opencode-tier help
```

## Quick Start

```bash
# 1. See your current state
opencode-tier status

# 2. Check what AI providers you have connected
opencode-tier providers

# 3. Let the system pick the best tier
opencode-tier auto

# 4. Enable automatic switching (checks every 30 min)
opencode-tier install

# 5. (Optional) Connect FREE providers for Ultimate tier
opencode-tier setup
```

## Usage

### 🔄 Auto — Budget-aware tier selection

```bash
# Interactive (asks before switching)
opencode-tier auto

# Hands-free (for cron/systemd/scripts)
opencode-tier auto --yes
```

The analyzer reads your actual spend from `opencode stats`, projects it against Go limits, and selects the most aggressive tier that keeps you under budget.

### 👁 Watch — Continuous monitoring daemon

```bash
# Default: checks every 30 minutes
opencode-tier watch

# Custom interval: every 15 minutes
opencode-tier watch 15
```

The watch mode runs as an in-process daemon. It checks your budget on each tick and automatically adjusts tiers when your burn rate crosses a threshold. Works on all platforms.

### 🎯 Manual tier switching

```bash
opencode-tier ultimate    # FREE pro models (needs GitHub + Google)
opencode-tier green       # Full paid power
opencode-tier yellow      # Balanced mid-range
opencode-tier orange      # Economy mode
opencode-tier red         # Survival — free only
```

Changes take effect on your **next** OpenCode session. Running sessions keep their current model until restarted.

### 📦 Install persistent service

```bash
opencode-tier install
```

Auto-detects your OS and installs the appropriate scheduler:

| Platform | Method | How it works |
|----------|--------|-------------|
| Linux | systemd | User timer, runs every 30 min |
| macOS | launchd | User agent, runs every 30 min |
| Any | cron | Fallback, runs every 30 min |
| Any | In-process | `opencode-tier watch` — works everywhere |

The install command also registers `/tier` slash commands in your OpenCode TUI:

- `/tier-status` — Show current configuration
- `/tier` — Switch between tiers
- `/tier-auto` — Auto-detect best tier
- `/tier-watch` — Start continuous monitoring
- `/tier-providers` — Show connected providers

### 🗑 Uninstall

```bash
opencode-tier uninstall
```

## Architecture

```
opencode-tier/
├── opencode-tier.js     # CLI entry point (shebang)
├── lib/
│   ├── tiers.js         # 5 tier definitions with per-agent models
│   ├── config.js        # opencode.json R/W with atomic backups
│   ├── budget.js        # `opencode stats` parser + urgency calculator
│   ├── providers.js     # Provider auto-detection + setup guide
│   └── scheduler.js     # Cross-platform scheduling (systemd/launchd/cron/polling)
├── package.json
└── README.md
```

**Zero npm dependencies.** Pure Node.js built-ins (`fs`, `path`, `os`, `child_process`). Works on Node 18+.

### Budget Algorithm

```
urgency = max(
    (dailyCost × 5/24) / limit5h × 100,       # 5-hour projection
    (dailyCost × 7) / limitWeekly × 100,       # Weekly projection  
    totalCost / limitMonthly × 100             # Monthly actual
)
```

| Urgency | Selected Tier |
|---------|---------------|
| 0–29%   | 🟢 Green |
| 30–59%  | 🟡 Yellow |
| 60–84%  | 🟠 Orange |
| 85–100% | 🔴 Red |

## Provider Setup

For **Ultimate tier** ($0/day, professional models), connect:

1. **GitHub Copilot** — FREE with `.edu` email
   - Verify at https://github.com/settings/education/benefits
   - Run `/connect` in OpenCode TUI → select GitHub Copilot

2. **Google Gemini API** — FREE tier (1500 req/day)
   - Get key at https://aistudio.google.com/
   - Add to `~/.config/opencode/.env`: `GOOGLE_API_KEY=your_key`

Run `opencode-tier setup` for an interactive guide.

## Comparison

| Feature | opencode-tier | opencode-agent-modes | model-fallback | manual switching |
|---------|:---:|:---:|:---:|:---:|
| Trigger | **Proactive** (budget %) | Manual | Reactive (error) | Manual |
| Autonomous | ✅ | ❌ | ✅ | ❌ |
| Budget monitoring | ✅ | ❌ | ❌ | ❌ |
| Per-agent granularity | ✅ | ✅ | ✅ | ❌ |
| Cross-platform | ✅ | ❌ (Linux) | ✅ | ✅ |
| Zero npm deps | ✅ | ❌ | ❌ | ✅ |
| System service | ✅ | ❌ | ✅ (plugin) | ❌ |
| TUI commands | ✅ | ✅ | ❌ | ❌ |

## Changelog

### 2.0.0 (May 2026)
- Complete rewrite: bash → Node.js (cross-platform)
- Zero npm dependencies — pure built-ins
- In-process polling daemon (`opencode-tier watch`)
- systemd, launchd, and cron service support
- OpenCode TUI command integration (`/tier`, `/tier-auto`, etc.)
- Interactive setup wizard (`opencode-tier setup`)
- Atomic config writes with timestamped backups
- Provider auto-detection (Go, GitHub, Google, Zen)

### 1.0.0 (May 2026)
- Initial release — bash script with systemd timer

## Roadmap

- [ ] OpenCode plugin integration (direct hook into session lifecycle)
- [ ] Real-time token usage tracking (via OpenCode API)
- [ ] Custom tier definitions (user-defined model sets)
- [ ] Multi-user / team budget sharing
- [ ] Prometheus metrics export
- [ ] Web dashboard for budget visualization

## FAQ

**Does this work with my current OpenCode session?**  
No. Tier changes modify `opencode.json`, which is read at OpenCode startup. The new models apply on your next session.

**Does this replace OpenCode's built-in model fallback?**  
No. opencode-tier is complementary. OpenCode's fallback handles API errors reactively; opencode-tier proactively manages your budget to *prevent* those errors.

**Can I customize the models in each tier?**  
Yes — edit the `TIERS` object in `lib/tiers.js`. Each tier defines per-agent model IDs.

**Does it work on Windows?**  
Yes. The CLI, polling daemon, and cron scheduling work on Windows. Systemd/launchd service installation is skipped (cron or WSL fallback).

**Will this drain my Go credits faster?**  
No. It does the opposite — it reduces your Go usage by switching to cheaper/free models when you're approaching limits.

## License

MIT © [Nicolas Rios Herrera](https://github.com/nriosdev)
