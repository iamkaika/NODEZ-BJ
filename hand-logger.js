#!/usr/bin/env node
// Continuously logs hands to a file for later analysis
// Run in background: node hand-logger.js &

const WebSocket = require('ws');
const fs = require('fs');
const http = require('http');

const LOG_FILE = '/tmp/bj-hands.log';
let currentHand = null;

function connect() {
  http.get('http://localhost:9222/json/list', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      const pages = JSON.parse(data);
      const bjPage = pages.find(p => p.url.includes('blackjack') && p.type === 'page');
      if (!bjPage) {
        console.log('Blackjack page not found, retrying in 10s...');
        setTimeout(connect, 10000);
        return;
      }
      startLogging(bjPage.webSocketDebuggerUrl);
    });
  }).on('error', () => {
    console.log('Chrome not connected, retrying in 10s...');
    setTimeout(connect, 10000);
  });
}

function startLogging(wsUrl) {
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('Hand logger connected - logging to ' + LOG_FILE);
    ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method !== 'Console.messageAdded') return;
    const text = msg.params.message.text;
    const level = msg.params.message.level;
    const time = new Date().toISOString();

    // Track hand starts
    if (text.includes('Starting hand tracking after deal:')) {
      const match = text.match(/deal: (.+) vs (.+)$/);
      if (match) {
        currentHand = {
          time: time,
          cards: match[1],
          dealer: match[2],
          actions: [],
          playerTotal: null,
          dealerTotal: null,
          result: null,
          payout: null,
          issues: []
        };
      }
    }

    // Track decisions
    if (text.includes('Decision:') && currentHand) {
      const match = text.match(/Decision: (\w+)/);
      if (match) currentHand.actions.push(match[1]);
    }

    // Track finish
    if (text.includes('finishHand - using P:') && currentHand) {
      const match = text.match(/P: (\d+) D: (.+)$/);
      if (match) {
        currentHand.playerTotal = parseInt(match[1]);
        currentHand.dealerTotal = match[2] === '—' ? 'pending' : parseInt(match[2]);
      }
    }

    // Track server payout
    if (text.includes('SERVER] Server reports') && currentHand) {
      const payoutMatch = text.match(/payout: ([\d.]+|unknown)/);
      if (payoutMatch && payoutMatch[1] !== 'unknown') {
        currentHand.payout = parseFloat(payoutMatch[1]);
      }
    }

    // Track issues
    if (currentHand) {
      if (level === 'error') currentHand.issues.push('ERROR: ' + text.substring(0, 80));
      if (text.includes('DISCREPANCY')) currentHand.issues.push('DISCREPANCY: ' + text.substring(0, 80));
      if (text.includes('mismatch')) currentHand.issues.push('MISMATCH: ' + text.substring(0, 80));
      if (text.includes('null') && text.includes('upRank')) currentHand.issues.push('NULL_UPRANK');
    }

    // Save hand when new one starts
    if (text.includes('[SBJ] Starting hand sequence') && currentHand && currentHand.playerTotal) {
      // Determine result
      const p = currentHand.playerTotal;
      const d = currentHand.dealerTotal;
      if (p > 21) currentHand.result = 'BUST';
      else if (d === 'pending' || d === 0) currentHand.result = 'PENDING';
      else if (d > 21) currentHand.result = 'WIN';
      else if (p > d) currentHand.result = 'WIN';
      else if (p === d) currentHand.result = 'PUSH';
      else currentHand.result = 'LOSS';

      // Append to log
      fs.appendFileSync(LOG_FILE, JSON.stringify(currentHand) + '\n');
      currentHand = null;
    }
  });

  ws.on('close', () => {
    console.log('Disconnected, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.log('WS error:', err.message);
  });
}

// Start
console.log('Starting hand logger...');
connect();
