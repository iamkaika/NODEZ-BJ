#!/bin/bash
# Start the hand logger if not already running
if ! pgrep -f "hand-logger.js" > /dev/null; then
    cd /Users/garretthaae/Desktop/blackjack
    nohup node hand-logger.js > /tmp/hand-logger.out 2>&1 &
    echo "Hand logger started"
else
    echo "Hand logger already running"
fi
