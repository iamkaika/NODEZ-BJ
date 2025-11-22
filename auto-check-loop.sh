#!/bin/bash
# Run this in a separate terminal - checks every 30 min
# Stop with Ctrl+C

echo "Auto-checker started. Checking every 30 minutes. Ctrl+C to stop."
while true; do
    sleep 1800  # 30 minutes
    /opt/homebrew/bin/tmux -S /private/tmp/tmux-501/default send-keys -t bj-bot "check status"
    /opt/homebrew/bin/tmux -S /private/tmp/tmux-501/default send-keys -t bj-bot Enter
    echo "$(date): Sent check"
done
