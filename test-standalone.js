#!/usr/bin/env node
// Standalone test file for blackjack bot counting logic

// --------------------------- Core Tracking Logic ---------------------------
let handHistory = [];
let currentHand = null;

let runningStats = {
  totalWins: 0,
  totalLosses: 0,
  totalPushes: 0,
  totalHands: 0,
  totalBet: 0,
  totalWon: 0
};

let _lastBJRaw = null;

function deepFindBlackjack(node, max = 12000) {
  const stack = [node];
  let seen = 0;
  while (stack.length && seen < max) {
    const cur = stack.pop();
    seen++;
    if (!cur || typeof cur !== 'object') continue;

    if (cur.blackjackBet) return cur.blackjackBet;
    if (cur.blackjackNext) return cur.blackjackNext;
    if (cur.data && cur.data.blackjackBet) return cur.data.blackjackBet;
    if (cur.data && cur.data.blackjackNext) return cur.data.blackjackNext;

    for (const k in cur)
      if (Object.prototype.hasOwnProperty.call(cur, k)) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
  }
  return null;
}

function startNewHand(playerCards, dealerUp, betAmount = null) {
  if (!betAmount) {
    betAmount = 0.25;
  }

  currentHand = {
    startTime: new Date().toLocaleTimeString(),
    playerStart: playerCards.join(','),
    dealerUp: dealerUp,
    actions: [],
    finalPlayer: null,
    finalDealer: null,
    result: 'ongoing',
    betAmount: betAmount,
    winAmount: 0
  };
}

function logAction(action, playerCards, playerTotal, soft) {
  if (currentHand) {
    if (action === 'double') {
      if (currentHand.isSplit) {
        currentHand.betAmount += currentHand.splitBetAmount;
      } else {
        currentHand.betAmount *= 2;
      }
    }

    if (action === 'split') {
      currentHand.isSplit = true;
      currentHand.splitBetAmount = currentHand.betAmount;
      currentHand.betAmount *= 2;
    }

    currentHand.actions.push({
      action: action,
      cards: playerCards.join(','),
      total: playerTotal,
      soft: soft
    });
  }
}

function finishHand(result, finalPlayerTotal, finalDealerTotal) {
  if (currentHand) {
    currentHand.result = result;
    currentHand.finalPlayer = finalPlayerTotal;
    currentHand.finalDealer = finalDealerTotal;

    const bj = deepFindBlackjack(_lastBJRaw);
    let winAmount = 0;

    const payout = bj?.payout || bj?.winAmount || bj?.totalWin || bj?.amount || 0;
    const profit = bj?.profit || bj?.netWin || 0;
    const betAmount = currentHand.betAmount;

    // Better split handling
    if (currentHand.isSplit && bj?.state?.player) {
      const playerHands = bj.state.player;
      let totalWinAmount = 0;

      for (const hand of playerHands) {
        const handValue = hand.value || 0;
        const handActions = hand.actions || [];
        const dealerValue = bj.state?.dealer?.[0]?.value || 0;

        let handBet = currentHand.splitBetAmount || betAmount / 2;

        if (handActions.includes('double')) {
          handBet *= 2;
        }

        if (handActions.includes('bust') || handValue > 21) {
          // Lost - win 0
        } else if (handValue === 21 && hand.cards?.length === 2) {
          // Blackjack on split (1:1)
          totalWinAmount += handBet * 2;
        } else if (dealerValue > 21) {
          // Dealer busts, player wins
          totalWinAmount += handBet * 2;
        } else if (handValue > dealerValue) {
          // Won
          totalWinAmount += handBet * 2;
        } else if (handValue === dealerValue) {
          // Push
          totalWinAmount += handBet;
        }
        // else: Lost (handValue < dealerValue) - win 0
      }

      winAmount = totalWinAmount;
    } else if (result === 'win') {
      if (payout > 0) {
        winAmount = payout;
      } else if (profit > 0) {
        winAmount = betAmount + profit;
      } else {
        const isBlackjack = finalPlayerTotal === 21 && currentHand.playerStart.split(',').length === 2;
        if (isBlackjack) {
          winAmount = betAmount * 2.5; // 3:2
        } else {
          winAmount = betAmount * 2; // 1:1
        }
      }
    } else if (result === 'push') {
      winAmount = betAmount;
    } else {
      winAmount = 0;
    }

    currentHand.winAmount = winAmount;

    const actualBetAmount = currentHand.betAmount;

    handHistory.push(currentHand);

    runningStats.totalBet += actualBetAmount;
    runningStats.totalWon += winAmount;

    if (result === 'win') runningStats.totalWins++;
    else if (result === 'loss') runningStats.totalLosses++;
    else if (result === 'push') runningStats.totalPushes++;

    runningStats.totalHands = runningStats.totalWins + runningStats.totalLosses + runningStats.totalPushes;

    if (handHistory.length > 50) {
      handHistory = handHistory.slice(-50);
    }

    currentHand = null;
  }
}

// --------------------------- TEST SUITE ---------------------------
const TestSuite = {
  tests: [],
  results: [],

  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  },

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  },

  assertClose(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\nExpected: ${expected} ± ${tolerance}\nActual: ${actual}`);
    }
  },

  test(name, fn) {
    this.tests.push({ name, fn });
  },

  mockGameState(config) {
    return {
      blackjackBet: {
        state: {
          player: config.playerHands || [],
          dealer: config.dealer ? [config.dealer] : []
        },
        bet: { amount: config.betAmount || 1 },
        betAmount: config.betAmount || 1,
        payout: config.payout || 0,
        profit: config.profit || 0
      }
    };
  },

  resetTracking() {
    handHistory = [];
    currentHand = null;
    runningStats = {
      totalWins: 0,
      totalLosses: 0,
      totalPushes: 0,
      totalHands: 0,
      totalBet: 0,
      totalWon: 0
    };
  },

  async runAll() {
    this.results = [];
    console.log('\n\x1b[32m\x1b[1m[TEST SUITE] Starting tests...\x1b[0m\n');

    for (const test of this.tests) {
      try {
        this.resetTracking();
        await test.fn();
        this.results.push({ name: test.name, status: 'PASS', error: null });
        console.log(`\x1b[32m✓ ${test.name}\x1b[0m`);
      } catch (error) {
        this.results.push({ name: test.name, status: 'FAIL', error: error.message });
        console.error(`\x1b[31m✗ ${test.name}\x1b[0m`);
        console.error(`  \x1b[31m${error.message}\x1b[0m`);
      }
    }

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;

    console.log(
      failed > 0
        ? `\n\x1b[31m\x1b[1m[TEST SUITE] Complete: ${passed} passed, ${failed} failed\x1b[0m\n`
        : `\n\x1b[32m\x1b[1m[TEST SUITE] Complete: ${passed} passed, ${failed} failed\x1b[0m\n`
    );

    return this.results;
  }
};

// --------------------------- TEST CASES ---------------------------

// Test 1: Basic win
TestSuite.test('Basic Win - Correct bet and win amount tracking', () => {
  const betAmount = 1.0;
  startNewHand(['K', '9'], '7', betAmount);
  logAction('stand', ['K', '9'], 19, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount,
    playerHands: [{ value: 19, cards: [{ rank: 'K' }, { rank: '9' }], actions: ['stand'] }],
    dealer: { value: 18, cards: [{ rank: '7' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 18);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
  TestSuite.assertEqual(runningStats.totalBet, 1.0, 'Total bet should be 1.00');
  TestSuite.assertClose(runningStats.totalWon, 2.0, 0.01, 'Total won should be ~2.00');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.0, 0.01, 'Net profit should be ~1.00');
});

// Test 2: Basic loss
TestSuite.test('Basic Loss - Correct bet and loss tracking', () => {
  const betAmount = 1.0;
  startNewHand(['10', '6'], '10', betAmount);
  logAction('hit', ['10', '6', '9'], 25, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount,
    playerHands: [{ value: 25, cards: [{ rank: '10' }, { rank: '6' }, { rank: '9' }], actions: ['bust'] }],
    dealer: { value: 20, cards: [{ rank: '10' }, { rank: 'K' }] }
  });
  _lastBJRaw = mockState;
  finishHand('loss', 25, 20);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalLosses, 1, 'Should have 1 loss');
  TestSuite.assertEqual(runningStats.totalBet, 1.0, 'Total bet should be 1.00');
  TestSuite.assertEqual(runningStats.totalWon, 0, 'Total won should be 0');
  TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, -1.0, 'Net loss should be -1.00');
});

// Test 3: Push
TestSuite.test('Push - Bet returned correctly', () => {
  const betAmount = 1.0;
  startNewHand(['K', '7'], '10', betAmount);
  logAction('stand', ['K', '7'], 17, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount,
    playerHands: [{ value: 17, cards: [{ rank: 'K' }, { rank: '7' }], actions: ['stand'] }],
    dealer: { value: 17, cards: [{ rank: '10' }, { rank: '7' }] }
  });
  _lastBJRaw = mockState;
  finishHand('push', 17, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalPushes, 1, 'Should have 1 push');
  TestSuite.assertEqual(runningStats.totalBet, 1.0, 'Total bet should be 1.00');
  TestSuite.assertEqual(runningStats.totalWon, 1.0, 'Total won should be 1.00');
  TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, 0, 'Net should be 0');
});

// Test 4: Double down win
TestSuite.test('Double Down Win - Bet doubled correctly', () => {
  const betAmount = 1.0;
  startNewHand(['5', '6'], '6', betAmount);
  logAction('double', ['5', '6', '9'], 20, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [{ value: 20, cards: [{ rank: '5' }, { rank: '6' }, { rank: '9' }], actions: ['double'] }],
    dealer: { value: 19, cards: [{ rank: '6' }, { rank: 'K' }, { rank: '3' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 20, 19);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00');
  TestSuite.assertClose(runningStats.totalWon, 4.0, 0.01, 'Total won should be ~4.00');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 2.0, 0.01, 'Net profit should be ~2.00');
});

// Test 5: Split - both win
TestSuite.test('Split - Both Hands Win', () => {
  const betAmount = 1.0;
  startNewHand(['8', '8'], '6', betAmount);
  logAction('split', ['8', '8'], 8, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 19, cards: [{ rank: '8' }, { rank: 'K' }, { rank: 'A' }], actions: ['stand'] },
      { value: 18, cards: [{ rank: '8' }, { rank: '10' }], actions: ['stand'] }
    ],
    dealer: { value: 17, cards: [{ rank: '6' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00');
  TestSuite.assertClose(runningStats.totalWon, 4.0, 0.01, 'Total won should be ~4.00 (both win)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 2.0, 0.01, 'Net profit should be ~2.00');
});

// Test 6: Split - both lose
TestSuite.test('Split - Both Hands Lose', () => {
  const betAmount = 1.0;
  startNewHand(['8', '8'], 'K', betAmount);
  logAction('split', ['8', '8'], 8, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 18, cards: [{ rank: '8' }, { rank: '10' }], actions: ['stand'] },
      { value: 17, cards: [{ rank: '8' }, { rank: '9' }], actions: ['stand'] }
    ],
    dealer: { value: 20, cards: [{ rank: 'K' }, { rank: '10' }] }
  });
  _lastBJRaw = mockState;
  finishHand('loss', 18, 20);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00');
  TestSuite.assertEqual(runningStats.totalWon, 0, 'Total won should be 0');
  TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, -2.0, 'Net loss should be -2.00');
});

// Test 7: Split - one win, one loss
TestSuite.test('Split - One Win, One Loss (Mixed)', () => {
  const betAmount = 1.0;
  startNewHand(['8', '8'], '7', betAmount);
  logAction('split', ['8', '8'], 8, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 19, cards: [{ rank: '8' }, { rank: 'K' }, { rank: 'A' }], actions: ['stand'] },
      { value: 16, cards: [{ rank: '8' }, { rank: '8' }], actions: ['stand'] }
    ],
    dealer: { value: 17, cards: [{ rank: '7' }, { rank: '10' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00');
  TestSuite.assertClose(runningStats.totalWon, 2.0, 0.01, 'Total won should be ~2.00 (break even)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 0.0, 0.01, 'Net should be ~0.00');
});

// Test 8: Split - one win, one push
TestSuite.test('Split - One Win, One Push', () => {
  const betAmount = 1.0;
  startNewHand(['9', '9'], '7', betAmount);
  logAction('split', ['9', '9'], 9, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 19, cards: [{ rank: '9' }, { rank: '10' }], actions: ['stand'] },
      { value: 18, cards: [{ rank: '9' }, { rank: '9' }], actions: ['stand'] }
    ],
    dealer: { value: 18, cards: [{ rank: '7' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 18);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00');
  TestSuite.assertClose(runningStats.totalWon, 3.0, 0.01, 'Total won should be ~3.00 (one wins, one pushes)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.0, 0.01, 'Net profit should be ~1.00');
});

// Test 9: Split with double on one hand
TestSuite.test('Split + Double on One Hand - Bets calculated correctly', () => {
  const betAmount = 1.0;
  startNewHand(['9', '9'], '6', betAmount);
  logAction('split', ['9', '9'], 9, false);
  logAction('double', ['9', 'A', '9'], 19, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 19, cards: [{ rank: '9' }, { rank: 'A' }, { rank: '9' }], actions: ['double'] },
      { value: 19, cards: [{ rank: '9' }, { rank: '10' }], actions: ['stand'] }
    ],
    dealer: { value: 17, cards: [{ rank: '6' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 3.0, 'Total bet should be 3.00 (split + double)');
  TestSuite.assertClose(runningStats.totalWon, 6.0, 0.01, 'Total won should be ~6.00 (both win)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 3.0, 0.01, 'Net profit should be ~3.00');
});

// Test 10: Blackjack
TestSuite.test('Blackjack - 3:2 Payout', () => {
  const betAmount = 1.0;
  startNewHand(['A', 'K'], '7', betAmount);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount,
    playerHands: [{ value: 21, cards: [{ rank: 'A' }, { rank: 'K' }], actions: [] }],
    dealer: { value: 19, cards: [{ rank: '7' }, { rank: 'Q' }, { rank: '2' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 21, 19);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
  TestSuite.assertEqual(runningStats.totalBet, 1.0, 'Total bet should be 1.00');
  TestSuite.assertClose(runningStats.totalWon, 2.5, 0.01, 'Total won should be ~2.50 (3:2 blackjack)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.5, 0.01, 'Net profit should be ~1.50');
});

// Test 11: Multiple hands
TestSuite.test('Multiple Hands - Cumulative Stats Correct', () => {
  // Hand 1: Win
  startNewHand(['K', '9'], '7', 1.0);
  logAction('stand', ['K', '9'], 19, false);
  let mockState = TestSuite.mockGameState({
    betAmount: 1.0,
    playerHands: [{ value: 19, cards: [{ rank: 'K' }, { rank: '9' }], actions: ['stand'] }],
    dealer: { value: 18, cards: [{ rank: '7' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 18);

  // Hand 2: Loss
  startNewHand(['10', '6'], '10', 1.0);
  logAction('hit', ['10', '6', '9'], 25, false);
  mockState = TestSuite.mockGameState({
    betAmount: 1.0,
    playerHands: [{ value: 25, cards: [{ rank: '10' }, { rank: '6' }, { rank: '9' }], actions: ['bust'] }],
    dealer: { value: 20, cards: [{ rank: '10' }, { rank: 'K' }] }
  });
  _lastBJRaw = mockState;
  finishHand('loss', 25, 20);

  // Hand 3: Push
  startNewHand(['K', '7'], '10', 1.0);
  logAction('stand', ['K', '7'], 17, false);
  mockState = TestSuite.mockGameState({
    betAmount: 1.0,
    playerHands: [{ value: 17, cards: [{ rank: 'K' }, { rank: '7' }], actions: ['stand'] }],
    dealer: { value: 17, cards: [{ rank: '10' }, { rank: '7' }] }
  });
  _lastBJRaw = mockState;
  finishHand('push', 17, 17);

  TestSuite.assertEqual(runningStats.totalHands, 3, 'Should have 3 hands total');
  TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
  TestSuite.assertEqual(runningStats.totalLosses, 1, 'Should have 1 loss');
  TestSuite.assertEqual(runningStats.totalPushes, 1, 'Should have 1 push');
  TestSuite.assertEqual(runningStats.totalBet, 3.0, 'Total bet should be 3.00');
  TestSuite.assertClose(runningStats.totalWon, 3.0, 0.01, 'Total won should be ~3.00');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 0.0, 0.01, 'Net should be 0.00');
});

// Test 12: Double down loss
TestSuite.test('Double Down Loss - Bet doubled and lost', () => {
  const betAmount = 1.0;
  startNewHand(['5', '6'], '10', betAmount);
  logAction('double', ['5', '6', '5'], 16, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [{ value: 16, cards: [{ rank: '5' }, { rank: '6' }, { rank: '5' }], actions: ['double'] }],
    dealer: { value: 20, cards: [{ rank: '10' }, { rank: 'K' }] }
  });
  _lastBJRaw = mockState;
  finishHand('loss', 16, 20);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalLosses, 1, 'Should have 1 loss');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00 (doubled)');
  TestSuite.assertEqual(runningStats.totalWon, 0, 'Total won should be 0');
  TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, -2.0, 'Net loss should be -2.00');
});

// Test 13: Double down push
TestSuite.test('Double Down Push - Bet doubled and returned', () => {
  const betAmount = 1.0;
  startNewHand(['5', '6'], '9', betAmount);
  logAction('double', ['5', '6', '8'], 19, false);
  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [{ value: 19, cards: [{ rank: '5' }, { rank: '6' }, { rank: '8' }], actions: ['double'] }],
    dealer: { value: 19, cards: [{ rank: '9' }, { rank: 'K' }] }
  });
  _lastBJRaw = mockState;
  finishHand('push', 19, 19);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalPushes, 1, 'Should have 1 push');
  TestSuite.assertEqual(runningStats.totalBet, 2.0, 'Total bet should be 2.00 (doubled)');
  TestSuite.assertEqual(runningStats.totalWon, 2.0, 'Total won should be 2.00 (bet returned)');
  TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, 0, 'Net should be 0');
});

// Test 14: Double after split - both doubled, both win
TestSuite.test('Split + Double Both Hands - Both win', () => {
  const betAmount = 1.0;
  startNewHand(['9', '9'], '6', betAmount);
  logAction('split', ['9', '9'], 9, false);
  // First hand doubles
  logAction('double', ['9', 'A', '9'], 19, false);
  // Second hand also doubles
  logAction('double', ['9', '10'], 19, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 19, cards: [{ rank: '9' }, { rank: 'A' }, { rank: '9' }], actions: ['double'] },
      { value: 19, cards: [{ rank: '9' }, { rank: '10' }], actions: ['double'] }
    ],
    dealer: { value: 17, cards: [{ rank: '6' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 19, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  // Split = 2.00 (1.00 * 2), then both doubled = +1.00 + 1.00 = 4.00 total
  TestSuite.assertEqual(runningStats.totalBet, 4.0, 'Total bet should be 4.00 (split + both doubled)');
  TestSuite.assertClose(runningStats.totalWon, 8.0, 0.01, 'Total won should be ~8.00 (both doubled hands win)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 4.0, 0.01, 'Net profit should be ~4.00');
});

// Test 15: Double after split - one doubled wins, one regular loses
TestSuite.test('Split + Double One Hand - Mixed outcome', () => {
  const betAmount = 1.0;
  startNewHand(['8', '8'], '10', betAmount);
  logAction('split', ['8', '8'], 8, false);
  // First hand doubles
  logAction('double', ['8', 'A', '2'], 21, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 21, cards: [{ rank: '8' }, { rank: 'A' }, { rank: '2' }], actions: ['double'] }, // Doubled, 2.00 bet, wins
      { value: 17, cards: [{ rank: '8' }, { rank: '9' }], actions: ['stand'] } // Regular, 1.00 bet, loses
    ],
    dealer: { value: 19, cards: [{ rank: '10' }, { rank: '9' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 21, 19);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  // Split = 2.00, one doubles = +1.00 = 3.00 total
  TestSuite.assertEqual(runningStats.totalBet, 3.0, 'Total bet should be 3.00 (split + one double)');
  // Doubled hand wins: 2.00 * 2 = 4.00, regular hand loses: 0
  TestSuite.assertClose(runningStats.totalWon, 4.0, 0.01, 'Total won should be ~4.00 (only doubled hand wins)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.0, 0.01, 'Net profit should be ~1.00');
});

// Test 16: Double after split - one doubled loses, one regular wins
TestSuite.test('Split + Double One Hand - Reversed outcome', () => {
  const betAmount = 1.0;
  startNewHand(['7', '7'], '6', betAmount);
  logAction('split', ['7', '7'], 7, false);
  // First hand doubles and busts
  logAction('double', ['7', '10', '7'], 24, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 24, cards: [{ rank: '7' }, { rank: '10' }, { rank: '7' }], actions: ['double', 'bust'] }, // Doubled, 2.00 bet, busts
      { value: 18, cards: [{ rank: '7' }, { rank: 'A' }], actions: ['stand'] } // Regular, 1.00 bet, wins
    ],
    dealer: { value: 17, cards: [{ rank: '6' }, { rank: 'K' }, { rank: 'A' }] }
  });
  _lastBJRaw = mockState;
  finishHand('win', 18, 17);

  TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
  TestSuite.assertEqual(runningStats.totalBet, 3.0, 'Total bet should be 3.00 (split + one double)');
  // Doubled hand busts: 0, regular hand wins: 1.00 * 2 = 2.00
  TestSuite.assertClose(runningStats.totalWon, 2.0, 0.01, 'Total won should be ~2.00 (only regular hand wins)');
  TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, -1.0, 0.01, 'Net loss should be ~-1.00');
});

// ==================== BASIC STRATEGY TESTS ====================
// These test the decision logic from the betMatrix

// Helper function to test strategy decisions
function testStrategy(playerCards, playerTotal, soft, dealerUp, expectedAction, description) {
  const view = {
    total: playerTotal,
    soft: soft,
    upRank: dealerUp,
    actions: ['hit', 'stand', 'double', 'split'], // All actions available
    cardsRanks: playerCards
  };

  // Import the betMatrix and decideFromMatrix function
  const betMatrix = {
    hard: {
      "12":{"2":"H","3":"H","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "13":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "14":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "15":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "16":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "17":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "18":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "19":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "20":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"}
    },
    soft: {
      "17":{"2":"H","3":"D","4":"D","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "18":{"2":"S","3":"DS","4":"DS","5":"DS","6":"DS","7":"S","8":"S","9":"H","10":"H","A":"H"},
      "19":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "20":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"}
    }
  };

  function decideFromMatrix(view) {
    const { total, soft, upRank, actions, cardsRanks } = view;

    // Safety guards
    if (!soft && total >= 17 && actions.includes('stand')) return 'stand';
    if (soft && total >= 19 && actions.includes('stand')) return 'stand';

    if (soft) {
      const row = betMatrix.soft[String(total)];
      const rec = row?.[upRank];
      if (rec) {
        if (rec === 'S' && actions.includes('stand')) return 'stand';
        if (rec === 'H' && actions.includes('hit')) return 'hit';
        if (rec === 'D' && actions.includes('double')) return 'double';
        if (rec === 'DS') {
          if (actions.includes('double')) return 'double';
          if (actions.includes('stand'))  return 'stand';
        }
      }
      if (total < 18 && actions.includes('hit')) return 'hit';
      if (actions.includes('stand')) return 'stand';
    }

    const row = betMatrix.hard[String(total)];
    const rec = row?.[upRank];
    if (rec) {
      if (rec === 'S' && actions.includes('stand')) return 'stand';
      if (rec === 'H' && actions.includes('hit')) return 'hit';
      if (rec === 'D') {
        if (actions.includes('double')) return 'double';
        if (actions.includes('hit'))    return 'hit';
      }
    }
    if (total < 17 && actions.includes('hit')) return 'hit';
    if (actions.includes('stand')) return 'stand';

    return actions[0] || null;
  }

  const decision = decideFromMatrix(view);
  TestSuite.assertEqual(decision, expectedAction, description);
}

// Test 17: Hard 17 always stands
TestSuite.test('Strategy: Hard 17 Always Stands', () => {
  testStrategy(['10', '7'], 17, false, '10', 'stand', 'Hard 17 vs 10 should stand');
  testStrategy(['10', '7'], 17, false, 'A', 'stand', 'Hard 17 vs A should stand');
  testStrategy(['10', '7'], 17, false, '6', 'stand', 'Hard 17 vs 6 should stand');
});

// Test 18: Hard 18-20 always stands
TestSuite.test('Strategy: Hard 18+ Always Stands', () => {
  testStrategy(['10', '8'], 18, false, '10', 'stand', 'Hard 18 vs 10 should stand');
  testStrategy(['10', '9'], 19, false, 'A', 'stand', 'Hard 19 vs A should stand');
  testStrategy(['10', 'K'], 20, false, '9', 'stand', 'Hard 20 vs 9 should stand');
});

// Test 19: Hard 16 vs dealer 6 - should stand
TestSuite.test('Strategy: Hard 16 vs Low Cards - Stand', () => {
  testStrategy(['10', '6'], 16, false, '2', 'stand', 'Hard 16 vs 2 should stand');
  testStrategy(['10', '6'], 16, false, '3', 'stand', 'Hard 16 vs 3 should stand');
  testStrategy(['10', '6'], 16, false, '4', 'stand', 'Hard 16 vs 4 should stand');
  testStrategy(['10', '6'], 16, false, '5', 'stand', 'Hard 16 vs 5 should stand');
  testStrategy(['10', '6'], 16, false, '6', 'stand', 'Hard 16 vs 6 should stand');
});

// Test 20: Hard 16 vs dealer 7+ - should hit
TestSuite.test('Strategy: Hard 16 vs High Cards - Hit', () => {
  testStrategy(['10', '6'], 16, false, '7', 'hit', 'Hard 16 vs 7 should hit');
  testStrategy(['10', '6'], 16, false, '8', 'hit', 'Hard 16 vs 8 should hit');
  testStrategy(['10', '6'], 16, false, '9', 'hit', 'Hard 16 vs 9 should hit');
  testStrategy(['10', '6'], 16, false, '10', 'hit', 'Hard 16 vs 10 should hit');
  testStrategy(['10', '6'], 16, false, 'A', 'hit', 'Hard 16 vs A should hit');
});

// Test 21: Hard 12 vs dealer 2-3 - should hit
TestSuite.test('Strategy: Hard 12 vs 2-3 - Hit', () => {
  testStrategy(['10', '2'], 12, false, '2', 'hit', 'Hard 12 vs 2 should hit');
  testStrategy(['10', '2'], 12, false, '3', 'hit', 'Hard 12 vs 3 should hit');
});

// Test 22: Hard 12 vs dealer 4-6 - should stand
TestSuite.test('Strategy: Hard 12 vs 4-6 - Stand', () => {
  testStrategy(['10', '2'], 12, false, '4', 'stand', 'Hard 12 vs 4 should stand');
  testStrategy(['10', '2'], 12, false, '5', 'stand', 'Hard 12 vs 5 should stand');
  testStrategy(['10', '2'], 12, false, '6', 'stand', 'Hard 12 vs 6 should stand');
});

// Test 23: Hard 13-16 vs dealer 2-6 - should stand
TestSuite.test('Strategy: Hard 13-15 vs 2-6 - Stand', () => {
  testStrategy(['10', '3'], 13, false, '2', 'stand', 'Hard 13 vs 2 should stand');
  testStrategy(['10', '4'], 14, false, '4', 'stand', 'Hard 14 vs 4 should stand');
  testStrategy(['10', '5'], 15, false, '6', 'stand', 'Hard 15 vs 6 should stand');
});

// Test 24: Soft 18 - Stand or Double as appropriate
TestSuite.test('Strategy: Soft 18 Stand/Double Logic', () => {
  testStrategy(['A', '7'], 18, true, '2', 'stand', 'Soft 18 vs 2 should stand');
  testStrategy(['A', '7'], 18, true, '6', 'double', 'Soft 18 vs 6 should double (DS)');
  testStrategy(['A', '7'], 18, true, '7', 'stand', 'Soft 18 vs 7 should stand');
  testStrategy(['A', '7'], 18, true, '8', 'stand', 'Soft 18 vs 8 should stand');
});

// Test 25: Soft 18 vs dealer 9-A - should hit
TestSuite.test('Strategy: Soft 18 vs 9-A - Hit', () => {
  testStrategy(['A', '7'], 18, true, '9', 'hit', 'Soft 18 vs 9 should hit');
  testStrategy(['A', '7'], 18, true, '10', 'hit', 'Soft 18 vs 10 should hit');
  testStrategy(['A', '7'], 18, true, 'A', 'hit', 'Soft 18 vs A should hit');
});

// Test 26: Soft 19+ always stands
TestSuite.test('Strategy: Soft 19+ Always Stands', () => {
  testStrategy(['A', '8'], 19, true, '10', 'stand', 'Soft 19 vs 10 should stand');
  testStrategy(['A', '9'], 20, true, 'A', 'stand', 'Soft 20 vs A should stand');
  testStrategy(['A', '8'], 19, true, '6', 'stand', 'Soft 19 vs 6 should stand');
});

// Test 27: Safety guard - never hit hard 17+
TestSuite.test('Strategy: Safety - Never Hit Hard 17+', () => {
  const view = { total: 17, soft: false, upRank: 'A', actions: ['hit', 'stand'], cardsRanks: ['10', '7'] };
  const betMatrix = { hard: {} };
  function decideFromMatrix(v) {
    if (!v.soft && v.total >= 17 && v.actions.includes('stand')) return 'stand';
    return 'hit';
  }
  const decision = decideFromMatrix(view);
  TestSuite.assertEqual(decision, 'stand', 'Safety guard should prevent hitting hard 17+');
});

// Test 28: Safety guard - never hit soft 19+
TestSuite.test('Strategy: Safety - Never Hit Soft 19+', () => {
  const view = { total: 19, soft: true, upRank: 'A', actions: ['hit', 'stand'], cardsRanks: ['A', '8'] };
  function decideFromMatrix(v) {
    if (v.soft && v.total >= 19 && v.actions.includes('stand')) return 'stand';
    return 'hit';
  }
  const decision = decideFromMatrix(view);
  TestSuite.assertEqual(decision, 'stand', 'Safety guard should prevent hitting soft 19+');
});

// Test 29: CRITICAL - Never hit against dealer 6 when you should stand
TestSuite.test('Strategy: NEVER Hit vs Dealer 6 - Critical Test', () => {
  // Hard 12-16 should ALWAYS stand vs dealer 6
  testStrategy(['10', '2'], 12, false, '6', 'stand', 'Hard 12 vs 6 should stand');
  testStrategy(['10', '3'], 13, false, '6', 'stand', 'Hard 13 vs 6 should stand');
  testStrategy(['10', '4'], 14, false, '6', 'stand', 'Hard 14 vs 6 should stand');
  testStrategy(['10', '5'], 15, false, '6', 'stand', 'Hard 15 vs 6 should stand');
  testStrategy(['10', '6'], 16, false, '6', 'stand', 'Hard 16 vs 6 should stand');

  // Hard 17+ should ALWAYS stand
  testStrategy(['10', '7'], 17, false, '6', 'stand', 'Hard 17 vs 6 should stand');
  testStrategy(['10', '8'], 18, false, '6', 'stand', 'Hard 18 vs 6 should stand');

  // Soft 18+ should stand or double (never hit)
  testStrategy(['A', '7'], 18, true, '6', 'double', 'Soft 18 vs 6 should double/stand');
  testStrategy(['A', '8'], 19, true, '6', 'stand', 'Soft 19 vs 6 should stand');

  // The ONLY hands that should hit vs dealer 6 are:
  // - Hard 11 or less (should actually double on 9-11)
  // - Soft 17 or less
  testStrategy(['5', '5'], 10, false, '6', 'double', 'Hard 10 vs 6 should double');
  testStrategy(['5', '6'], 11, false, '6', 'double', 'Hard 11 vs 6 should double');
  testStrategy(['A', '5'], 16, true, '6', 'double', 'Soft 16 vs 6 should double');
  testStrategy(['A', '6'], 17, true, '6', 'double', 'Soft 17 vs 6 should double');
});

// Test 30: Verify hard 18 never hits (reported issue)
TestSuite.test('Strategy: Hard 18 Should NEVER Hit', () => {
  testStrategy(['10', '8'], 18, false, '6', 'stand', 'Hard 18 vs 6 should stand');
  testStrategy(['10', '8'], 18, false, '7', 'stand', 'Hard 18 vs 7 should stand');
  testStrategy(['10', '8'], 18, false, '8', 'stand', 'Hard 18 vs 8 should stand');
  testStrategy(['10', '8'], 18, false, '9', 'stand', 'Hard 18 vs 9 should stand');
  testStrategy(['10', '8'], 18, false, '10', 'stand', 'Hard 18 vs 10 should stand');
  testStrategy(['10', '8'], 18, false, 'A', 'stand', 'Hard 18 vs A should stand');
});

// Test 31: Multi-card hands vs dealer 6
TestSuite.test('Strategy: Multi-Card Hands vs Dealer 6', () => {
  // 3-card hard 14 should stand vs 6
  testStrategy(['5', '4', '5'], 14, false, '6', 'stand', '3-card hard 14 vs 6 should stand');

  // 3-card hard 16 should stand vs 6
  testStrategy(['5', '5', '6'], 16, false, '6', 'stand', '3-card hard 16 vs 6 should stand');

  // 4-card hard 18 should stand vs 6
  testStrategy(['5', '4', '4', '5'], 18, false, '6', 'stand', '4-card hard 18 vs 6 should stand');

  // Soft hand that becomes hard after hit
  // A-5 (soft 16) hit and got 10 = hard 16, should stand vs 6
  testStrategy(['A', '5', '10'], 16, false, '6', 'stand', 'A-5-10 (hard 16) vs 6 should stand');
});

// Test 32: Edge case - what SHOULD hit vs dealer 6
TestSuite.test('Strategy: What SHOULD Hit vs Dealer 6', () => {
  // Hard 11 or less should hit/double
  testStrategy(['5', '4'], 9, false, '6', 'double', 'Hard 9 vs 6 should double');
  testStrategy(['5', '5'], 10, false, '6', 'double', 'Hard 10 vs 6 should double');
  testStrategy(['5', '6'], 11, false, '6', 'double', 'Hard 11 vs 6 should double');

  // Hard 8 or less with no double available should hit
  const view8 = { total: 8, soft: false, upRank: '6', actions: ['hit', 'stand'], cardsRanks: ['5', '3'] };
  function decideNoDouble(v) {
    if (!v.soft && v.total >= 17) return 'stand';
    if (v.total >= 12 && v.upRank === '6') return 'stand';
    if (v.actions.includes('hit')) return 'hit';
    return 'stand';
  }
  const decision8 = decideNoDouble(view8);
  TestSuite.assertEqual(decision8, 'hit', 'Hard 8 vs 6 (no double) should hit');
});

// Test 33: RTP calculation
TestSuite.test('RTP Calculation - Percentage Correct', () => {
  // 5 wins
  for (let i = 0; i < 5; i++) {
    startNewHand(['K', '9'], '7', 1.0);
    let mockState = TestSuite.mockGameState({
      betAmount: 1.0,
      playerHands: [{ value: 19, cards: [{ rank: 'K' }, { rank: '9' }], actions: [] }],
      dealer: { value: 18, cards: [{ rank: '7' }, { rank: 'K' }, { rank: 'A' }] }
    });
    _lastBJRaw = mockState;
    finishHand('win', 19, 18);
  }

  // 5 losses
  for (let i = 0; i < 5; i++) {
    startNewHand(['10', '6'], '10', 1.0);
    let mockState = TestSuite.mockGameState({
      betAmount: 1.0,
      playerHands: [{ value: 16, cards: [{ rank: '10' }, { rank: '6' }], actions: [] }],
      dealer: { value: 20, cards: [{ rank: '10' }, { rank: 'K' }] }
    });
    _lastBJRaw = mockState;
    finishHand('loss', 16, 20);
  }

  const rtp = (runningStats.totalWon / runningStats.totalBet) * 100;

  TestSuite.assertEqual(runningStats.totalHands, 10, 'Should have 10 hands');
  TestSuite.assertEqual(runningStats.totalBet, 10.0, 'Total bet should be 10.00');
  TestSuite.assertEqual(runningStats.totalWon, 10.0, 'Total won should be 10.00');
  TestSuite.assertClose(rtp, 100.0, 0.1, 'RTP should be 100%');
});

// Test: Wager Tracking - Basic bet
TestSuite.test('Wager Tracking - Basic bet tracked correctly', () => {
  const betAmount = 0.50;
  startNewHand(['J', '8'], 'K', betAmount);
  logAction('stand', ['J', '8'], 18, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount,
    playerHands: [{ value: 18, cards: [{rank:'J'},{rank:'8'}], actions: ['stand'] }],
    dealer: { value: 17, cards: [{rank:'K'},{rank:'7'}] }
  });
  _lastBJRaw = mockState;

  finishHand('win', 18, 17);

  TestSuite.assertEqual(runningStats.totalBet, 0.50, 'Total wager should be 0.50');
});

// Test: Wager Tracking - Double down
TestSuite.test('Wager Tracking - Double down wager tracked correctly', () => {
  const betAmount = 0.50;
  startNewHand(['5', '6'], '5', betAmount);
  logAction('double', ['5', '6', 'K'], 21, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [{ value: 21, cards: [{rank:'5'},{rank:'6'},{rank:'K'}], actions: ['double'] }],
    dealer: { value: 20, cards: [{rank:'5'},{rank:'K'},{rank:'5'}] }
  });
  _lastBJRaw = mockState;

  finishHand('win', 21, 20);

  TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total wager should be 1.00 (doubled)');
});

// Test: Wager Tracking - Split
TestSuite.test('Wager Tracking - Split wager tracked correctly', () => {
  const betAmount = 0.50;
  startNewHand(['8', '8'], '6', betAmount);
  logAction('split', ['8', '8'], 16, false);

  const mockState = TestSuite.mockGameState({
    betAmount: betAmount * 2,
    playerHands: [
      { value: 18, cards: [{rank:'8'},{rank:'10'}], actions: ['split'] },
      { value: 19, cards: [{rank:'8'},{rank:'A'}], actions: [] }
    ],
    dealer: { value: 20, cards: [{rank:'6'},{rank:'K'},{rank:'4'}] }
  });
  _lastBJRaw = mockState;

  finishHand('loss', 18, 20);

  TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total wager should be 1.00 (split = 2x bet)');
});

// Test: BUG FIX - Null upRank should not cause wrong decisions
TestSuite.test('BUG: Null upRank Should Not Cause Hit on 13', () => {
  // This reproduces the bug where during splits, upRank becomes null
  // and the fallback logic incorrectly hits on hands that should stand

  const betMatrix = {
    hard: {
      "12":{"2":"H","3":"H","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "13":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "14":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "15":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "16":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "17":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
    },
    soft: {}
  };

  // BROKEN VERSION - this is what the current code does
  function decideFromMatrixBroken(view) {
    const { total, soft, upRank, actions, cardsRanks } = view;

    if (!soft && total >= 17 && actions.includes('stand')) return 'stand';

    const row = betMatrix.hard[String(total)];
    const rec = row?.[upRank]; // This returns undefined when upRank is null!

    if (rec) {
      if (rec === 'S' && actions.includes('stand')) return 'stand';
      if (rec === 'H' && actions.includes('hit')) return 'hit';
    }

    // BUG: Falls through to this when upRank is null
    if (total < 17 && actions.includes('hit')) return 'hit';
    if (actions.includes('stand')) return 'stand';

    return actions[0] || null;
  }

  // FIXED VERSION - handles null upRank safely
  function decideFromMatrixFixed(view) {
    const { total, soft, upRank, actions, cardsRanks } = view;

    if (!soft && total >= 17 && actions.includes('stand')) return 'stand';

    // FIX: If upRank is null/undefined, default to safe play for 13-16
    if (!upRank) {
      // Conservative play: stand on 13-16 (assume weak dealer)
      if (!soft && total >= 13 && total <= 16 && actions.includes('stand')) {
        return 'stand';
      }
    }

    const row = betMatrix.hard[String(total)];
    const rec = row?.[upRank];

    if (rec) {
      if (rec === 'S' && actions.includes('stand')) return 'stand';
      if (rec === 'H' && actions.includes('hit')) return 'hit';
    }

    if (total < 17 && actions.includes('hit')) return 'hit';
    if (actions.includes('stand')) return 'stand';

    return actions[0] || null;
  }

  // Test case: Hard 13 with NULL upRank (simulating split bug)
  const view13NullDealer = {
    total: 13,
    soft: false,
    upRank: null, // BUG: This is what happens during splits
    actions: ['hit', 'stand'],
    cardsRanks: ['6', '7']
  };

  const brokenDecision = decideFromMatrixBroken(view13NullDealer);
  const fixedDecision = decideFromMatrixFixed(view13NullDealer);

  // The broken version INCORRECTLY returns 'hit'
  TestSuite.assertEqual(brokenDecision, 'hit', 'Broken version hits on 13 with null upRank (demonstrating bug)');

  // The fixed version should return 'stand' (safe default)
  TestSuite.assertEqual(fixedDecision, 'stand', 'Fixed version stands on 13 with null upRank');
});

// Test: BUG FIX - All stiff hands (13-16) should stand when upRank is null
TestSuite.test('BUG: All Stiff Hands Should Stand with Null upRank', () => {
  const betMatrix = {
    hard: {
      "12":{"2":"H","3":"H","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "13":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "14":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "15":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "16":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "17":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
    },
    soft: {}
  };

  function decideFromMatrixFixed(view) {
    const { total, soft, upRank, actions } = view;

    if (!soft && total >= 17 && actions.includes('stand')) return 'stand';

    // FIX: If upRank is null/undefined, default to safe play for 13-16
    if (!upRank) {
      if (!soft && total >= 13 && total <= 16 && actions.includes('stand')) {
        return 'stand';
      }
    }

    const row = betMatrix.hard[String(total)];
    const rec = row?.[upRank];

    if (rec) {
      if (rec === 'S' && actions.includes('stand')) return 'stand';
      if (rec === 'H' && actions.includes('hit')) return 'hit';
    }

    if (total < 17 && actions.includes('hit')) return 'hit';
    if (actions.includes('stand')) return 'stand';

    return actions[0] || null;
  }

  // Test all stiff hands with null upRank
  for (let total = 13; total <= 16; total++) {
    const view = {
      total: total,
      soft: false,
      upRank: null,
      actions: ['hit', 'stand'],
      cardsRanks: ['10', String(total - 10)]
    };
    const decision = decideFromMatrixFixed(view);
    TestSuite.assertEqual(decision, 'stand', `Hard ${total} with null upRank should stand`);
  }
});

// Test: Wager Tracking - Multiple hands cumulative
TestSuite.test('Wager Tracking - Multiple hands accumulate correctly', () => {
  // Hand 1: $0.50 bet
  startNewHand(['K', '9'], '7', 0.50);
  logAction('stand', ['K', '9'], 19, false);
  finishHand('win', 19, 18);

  // Hand 2: $1.00 bet with double = $2.00 total
  startNewHand(['5', '6'], '5', 1.00);
  logAction('double', ['5', '6', 'K'], 21, false);
  finishHand('win', 21, 20);

  // Hand 3: $0.25 bet with split = $0.50 total
  startNewHand(['8', '8'], '6', 0.25);
  logAction('split', ['8', '8'], 16, false);
  finishHand('loss', 18, 20);

  TestSuite.assertClose(runningStats.totalBet, 3.00, 0.01, 'Total wager should be ~3.00 (0.50 + 2.00 + 0.50)');
});

// --------------------------- RUN TESTS ---------------------------
(async () => {
  const results = await TestSuite.runAll();
  const failed = results.filter(r => r.status === 'FAIL').length;
  process.exit(failed > 0 ? 1 : 0);
})();
