# Claude Session Quick Start Guide

## Project Overview
Stake.us Blackjack Bot - Tampermonkey userscript that plays optimal basic strategy.

## Key Files
- `NODEZ STAKE WEB BJ 2.0.js` - Main bot script (runs in browser via Tampermonkey)
- `check-bot.js` - Health check + 30-min hand analysis
- `hand-logger.js` - Continuous hand logging to `/tmp/bj-hands.log`
- `/tmp/check-stats.js` - Live console monitor for stats comparison

## Architecture
- **Main Chrome** - Logged into Stake, running the bot (Tampermonkey)
- **MCP Chrome** - Controlled via chrome-devtools MCP, can't auth but can debug
- Both connect via Chrome remote debugging at `localhost:9222`

## Stats Tracking
Bot tracks internally:
- `runningStats.totalBet` - total wagered
- `runningStats.totalWon` - total returned
- Net = totalWon - totalBet

Compares against Stake UI:
- `[data-testid="bets-stats-wagered"]`
- `[data-testid="bets-stats-profit"]`

## Key Console Logs
```
[SBJ NET] Hand details, bet, payout, net calculations
[SBJ COMPARE] OurWager vs StakeWager, OurNet vs StakeNet, with Diff
[SBJ DISCREPANCY] When card/payout mismatches detected
[SBJ DEBUG] Running totals after each hand
```

## Quick Commands

### Check bot health + last 30 min:
```bash
cd /Users/garretthaae/Desktop/blackjack && node check-bot.js
```

### View recent hand logs:
```bash
tail -20 /tmp/bj-hands.log
```

### Monitor live stats comparison:
```bash
node /tmp/check-stats.js
```

### Start hand logger (background):
```bash
node hand-logger.js &
```

## What We're Checking
Discrepancies between:
1. Bot's internal wager/net tracking
2. Stake's official UI stats

Key areas of concern:
- Splits (bet doubles)
- Doubles (bet doubles)
- Blackjacks (3:2 payout)
- Server payout vs calculated payout

## Current Status
As of last session: All Diff values showing 0.00 - tracking matches Stake perfectly.

## MCP Chrome Setup
If MCP chrome isn't connected:
```bash
# Chrome should be running with remote debugging on port 9222
# MCP tools: take_snapshot, evaluate_script, list_console_messages, etc.
```

## Resume Command
"Continue monitoring blackjack bot stats for discrepancies between net gain and wager tracking"
