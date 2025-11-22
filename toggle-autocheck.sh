#!/bin/bash
CRON_LINE="*/30 * * * * /Users/garretthaae/Desktop/blackjack/auto-check.sh"

if crontab -l 2>/dev/null | grep -q "auto-check.sh"; then
    crontab -l | grep -v "auto-check.sh" | crontab -
    echo "Auto-check DISABLED"
else
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "Auto-check ENABLED (every 30 min)"
fi
