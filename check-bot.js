#!/usr/bin/env node
// Quick bot health check + analyze logged hands

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const LOG_FILE = '/tmp/bj-hands.log';
const issues = [];
const stats = { hands: 0, wins: 0, losses: 0, errors: 0, mismatches: 0 };

// First analyze logged hands
function analyzeLoggedHands() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('              30-MINUTE HAND ANALYSIS                       ');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(LOG_FILE)) {
    console.log('No hands logged yet.\n');
    return;
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(l => l);
  if (lines.length === 0) {
    console.log('No hands logged yet.\n');
    return;
  }

  const hands = lines.map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(h => h);

  // Get hands from last 30 min
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentHands = hands.filter(h => new Date(h.time) > thirtyMinAgo);

  const wins = recentHands.filter(h => h.result === 'WIN').length;
  const losses = recentHands.filter(h => h.result === 'LOSS').length;
  const pushes = recentHands.filter(h => h.result === 'PUSH').length;
  const busts = recentHands.filter(h => h.result === 'BUST').length;
  const handsWithIssues = recentHands.filter(h => h.issues && h.issues.length > 0);

  console.log('LAST 30 MINUTES:');
  console.log('   Hands: ' + recentHands.length);
  console.log('   Wins: ' + wins + ' | Losses: ' + losses + ' | Pushes: ' + pushes + ' | Busts: ' + busts);
  if (recentHands.length > 0) {
    console.log('   Win Rate: ' + ((wins / recentHands.length) * 100).toFixed(1) + '%');
  }
  console.log('');

  if (handsWithIssues.length > 0) {
    console.log('ISSUES FOUND (' + handsWithIssues.length + ' hands):');
    handsWithIssues.slice(0, 5).forEach((h, i) => {
      console.log('   ' + (i+1) + '. ' + h.cards + ' vs ' + h.dealer + ': ' + h.issues.join(', '));
    });
    console.log('');
  } else {
    console.log('NO ISSUES in logged hands\n');
  }

  // Show last 5 hands
  console.log('LAST 5 HANDS:');
  recentHands.slice(-5).forEach(h => {
    const icon = h.result === 'WIN' ? 'W' : h.result === 'LOSS' ? 'L' : h.result === 'BUST' ? 'B' : 'P';
    const payout = h.payout !== null ? ' $' + h.payout : '';
    console.log('   [' + icon + '] ' + h.cards + ' vs ' + h.dealer + ' -> P:' + h.playerTotal + ' D:' + h.dealerTotal + payout);
  });
  console.log('');

  // Clear old entries (keep last 500)
  if (hands.length > 500) {
    const keepHands = hands.slice(-500);
    fs.writeFileSync(LOG_FILE, keepHands.map(h => JSON.stringify(h)).join('\n') + '\n');
  }
}

// Then do live check
function liveCheck() {
  http.get('http://localhost:9222/json/list', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      const pages = JSON.parse(data);
      const bjPage = pages.find(p => p.url.includes('blackjack') && p.type === 'page');
      if (!bjPage) {
        console.log('Blackjack page not found - is Chrome running?\n');
        console.log('═══════════════════════════════════════════════════════════');
        return;
      }
      runLiveCheck(bjPage.webSocketDebuggerUrl);
    });
  }).on('error', () => {
    console.log('Chrome not connected.\n');
    console.log('═══════════════════════════════════════════════════════════');
  });
}

function runLiveCheck(wsUrl) {
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('LIVE CHECK (5 sec):');
    ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));

    setTimeout(() => {
      ws.close();
      printLiveReport();
    }, 5000);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Console.messageAdded') {
      const text = msg.params.message.text;
      const level = msg.params.message.level;

      if (text.includes('finishHand')) stats.hands++;
      if (text.includes('payout: 2') || (text.includes('result') && text.includes('win'))) stats.wins++;
      if (text.includes('payout: 0') || (text.includes('result') && text.includes('loss'))) stats.losses++;

      if (level === 'error' || text.includes('ERROR')) {
        stats.errors++;
        issues.push({ type: 'ERROR', text: text.substring(0, 100) });
      }
      if (text.includes('DISCREPANCY') || text.includes('mismatch')) {
        stats.mismatches++;
        issues.push({ type: 'MISMATCH', text: text.substring(0, 100) });
      }
    }
  });

  ws.on('error', (err) => {
    console.log('   Connection error\n');
    console.log('═══════════════════════════════════════════════════════════');
  });
}

function printLiveReport() {
  if (stats.hands === 0) {
    console.log('   No hands in last 5 sec - bot may be paused\n');
  } else {
    console.log('   ' + stats.hands + ' hands active');
  }

  if (issues.length === 0) {
    console.log('   No live errors\n');
  } else {
    console.log('   ' + issues.length + ' issue(s) detected!\n');
  }

  console.log('═══════════════════════════════════════════════════════════');
}

// Run
analyzeLoggedHands();
liveCheck();
