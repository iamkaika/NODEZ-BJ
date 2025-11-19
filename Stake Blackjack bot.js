// ==UserScript==
// @name         Stake Blackjack – Matrix Bot (fixed deal loop)
// @namespace    stake-bj
// @match        https://stake.us/casino/games/blackjack*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --------------------------- Hand History & UI Functions (defined first) ---------------------------
  let handHistory = [];
  let currentHand = null;

  // Separate running totals that persist beyond the 50-hand display limit
  let runningStats = {
    totalWins: 0,
    totalLosses: 0,
    totalPushes: 0,
    totalHands: 0,
    totalBet: 0,    // Total money wagered
    totalWon: 0     // Total money returned
  };

  function getBetAmountFromUI() {
    // Extract bet amount from the UI input element
    const betInput = document.querySelector('input[data-testid="input-game-amount"]');
    if (betInput && betInput.value) {
      const amount = parseFloat(betInput.value);
      if (!isNaN(amount) && amount > 0) {
        console.log('[SBJ DEBUG] Extracted bet amount from UI:', amount);
        return amount;
      }
    }
    return null;
  }

  function startNewHand(playerCards, dealerUp, betAmount = null) {
    // Try to extract bet amount from UI first, then server state, then default
    if (!betAmount) {
      betAmount = getBetAmountFromUI();

      if (!betAmount) {
        const bj = deepFindBlackjack(_lastBJRaw);
        betAmount = bj?.bet?.amount || bj?.betAmount || null;
      }

      if (!betAmount) {
        betAmount = 0.25; // Final fallback
      }
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

    console.log('[SBJ DEBUG] Started tracking hand with bet amount:', betAmount);
  }

  function logAction(action, playerCards, playerTotal, soft) {
    if (currentHand) {
      // If this is a double down, update the bet amount
      if (action === 'double') {
        if (currentHand.isSplit) {
          // For splits with double, add the original bet amount to account for doubling one hand
          currentHand.betAmount += currentHand.splitBetAmount;
          console.log('[SBJ DEBUG] Double after split detected - added splitBetAmount:', currentHand.splitBetAmount, 'new total:', currentHand.betAmount);
        } else {
          // Regular double
          currentHand.betAmount *= 2;
          console.log('[SBJ DEBUG] Regular double detected - bet amount doubled to:', currentHand.betAmount);
        }
      }

      // If this is a split, track that we now have 2 hands being bet on
      if (action === 'split') {
        currentHand.isSplit = true;
        currentHand.splitBetAmount = currentHand.betAmount; // Original bet per hand
        // For splits, update betAmount to reflect total wagered (2x original)
        currentHand.betAmount *= 2;
        console.log('[SBJ DEBUG] Split detected - original bet per hand:', currentHand.splitBetAmount, 'total bet amount:', currentHand.betAmount);
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

      // Try to extract bet and win amounts from server state
      const bj = deepFindBlackjack(_lastBJRaw);
      let winAmount = 0;

      // Debug: log the entire blackjack object to see available data
      console.log('[SBJ DEBUG] Full blackjack data for payout detection:', bj);

      // Look for win amount in various possible locations
      const payout = bj?.payout || bj?.winAmount || bj?.totalWin || bj?.amount || 0;
      const profit = bj?.profit || bj?.netWin || 0;
      const betAmount = currentHand.betAmount;

      console.log('[SBJ DEBUG] Payout detection - payout:', payout, 'profit:', profit, 'betAmount:', betAmount, 'result:', result);
      console.log('[SBJ DEBUG] Current hand details - isSplit:', currentHand.isSplit, 'splitBetAmount:', currentHand.splitBetAmount);

      // Better split handling: for splits, check both player hands in the server state
      if (currentHand.isSplit && bj?.state?.player) {
        const playerHands = bj.state.player;
        console.log('[SBJ DEBUG] Split detected with', playerHands.length, 'player hands');

        // Calculate win amount based on each hand's outcome
        let totalWinAmount = 0;
        for (const hand of playerHands) {
          const handValue = hand.value || 0;
          const handActions = hand.actions || [];
          const dealerValue = bj.state?.dealer?.[0]?.value || 0;

          let handBet = currentHand.splitBetAmount || (betAmount / 2);

          // If this hand was doubled, account for that
          if (handActions.includes('double')) {
            handBet *= 2;
          }

          // Determine this hand's result
          if (handActions.includes('bust') || handValue > 21) {
            // Lost this hand - win 0
            console.log('[SBJ DEBUG] Split hand bust - bet:', handBet, 'win: 0');
          } else if (handValue === 21 && hand.cards?.length === 2) {
            // Blackjack on split (usually pays 1:1, not 3:2)
            totalWinAmount += handBet * 2;
            console.log('[SBJ DEBUG] Split hand BJ - bet:', handBet, 'win:', handBet * 2);
          } else if (dealerValue > 21) {
            // Dealer busts, player wins
            totalWinAmount += handBet * 2;
            console.log('[SBJ DEBUG] Split hand win (dealer bust) - bet:', handBet, 'win:', handBet * 2);
          } else if (handValue > dealerValue) {
            // Won this hand
            totalWinAmount += handBet * 2;
            console.log('[SBJ DEBUG] Split hand win - bet:', handBet, 'win:', handBet * 2);
          } else if (handValue === dealerValue) {
            // Push this hand
            totalWinAmount += handBet;
            console.log('[SBJ DEBUG] Split hand push - bet:', handBet, 'win:', handBet);
          } else {
            // Lost this hand (handValue < dealerValue)
            console.log('[SBJ DEBUG] Split hand loss - bet:', handBet, 'win: 0');
          }
        }

        winAmount = totalWinAmount;
        console.log('[SBJ DEBUG] Split total winAmount:', winAmount, 'vs total bet:', betAmount);
      } else if (result === 'win') {
        // Calculate payout ourselves (don't trust API payout field)
        // Check for blackjack: 21 with exactly 2 cards and no actions (no hits/doubles)
        const hasNoActions = !currentHand.actions || currentHand.actions.length === 0 ||
                              (currentHand.actions.length === 1 && currentHand.actions[0].action === 'stand');
        const hasTwoCards = currentHand.playerStart && currentHand.playerStart.split(',').length === 2;
        const isBlackjack = (finalPlayerTotal === 21) && hasTwoCards && hasNoActions;

        if (isBlackjack) {
          winAmount = betAmount * 2.5; // 3:2 payout
          console.log('[SBJ DEBUG] Blackjack win - bet:', betAmount, 'winAmount:', winAmount, 'cards:', currentHand.playerStart);
        } else {
          winAmount = betAmount * 2; // 1:1 payout
          console.log('[SBJ DEBUG] Regular win - bet:', betAmount, 'winAmount:', winAmount);
        }
      } else if (result === 'push') {
        winAmount = betAmount; // Get bet back
        console.log('[SBJ DEBUG] Push - bet:', betAmount, 'winAmount:', winAmount);
      } else {
        winAmount = 0; // Lose everything
        console.log('[SBJ DEBUG] Loss - bet:', betAmount, 'winAmount:', winAmount);
      }

      currentHand.winAmount = winAmount;

      // Store action summary before clearing currentHand
      const actionSummary = currentHand.actions.map(a => a.action).join(',');

      // For running stats, always use the betAmount field which should reflect total wagered
      // (including splits and doubles as they get updated)
      const actualBetAmount = currentHand.betAmount;

      handHistory.push(currentHand);

      // Update running totals for money-based RTP using the final bet amount
      runningStats.totalBet += actualBetAmount;
      runningStats.totalWon += winAmount;

      // Update total win display
      SBJ._updateTotalWin();

      // Update wager counter
      SBJ._updateWagerCounter();

      // Update hand counts (keep for reference)
      if (result === 'win') runningStats.totalWins++;
      else if (result === 'loss') runningStats.totalLosses++;
      else if (result === 'push') runningStats.totalPushes++;

      runningStats.totalHands = runningStats.totalWins + runningStats.totalLosses + runningStats.totalPushes;

      // Keep only last 50 hands for DISPLAY (but stats include all)
      if (handHistory.length > 50) {
        handHistory = handHistory.slice(-50);
      }

      // Clear currentHand after using all its data
      currentHand = null;

      console.log('[SBJ DEBUG] Hand finished. Bet:', actualBetAmount, 'Won:', winAmount, 'Result:', result, 'Action summary:', actionSummary);
      console.log('[SBJ DEBUG] Running totals - Hands:', runningStats.totalHands, 'Bet:', runningStats.totalBet, 'Won:', runningStats.totalWon, 'Net:', (runningStats.totalWon - runningStats.totalBet).toFixed(2));
      updateLogWindow();
    }
  }

  function updateLogWindow() {
    const logEl = document.getElementById('sbj-log-content');
    const statsEl = document.getElementById('sbj-log-stats');
    if (!logEl) return;

    let html = '';
    handHistory.slice(-20).reverse().forEach((hand, idx) => {
      const resultColor = hand.result === 'win' ? '#4ade80' :
                         hand.result === 'loss' ? '#f87171' :
                         hand.result === 'push' ? '#fbbf24' : '#9ca3af';

      // Calculate multiplier and net gain for display
      const multiplier = hand.betAmount ? (hand.winAmount / hand.betAmount) : 0;
      const netGain = hand.winAmount - hand.betAmount;

      html += `<div style="margin-bottom:8px;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;font-size:11px;">`;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px;">`;
      html += `<span style="color:#94a3b8;">${hand.startTime}</span>`;
      html += `<span style="color:${resultColor};font-weight:bold;">${hand.result.toUpperCase()}</span>`;
      html += `</div>`;
      html += `<div style="color:#e2e8f0;">Player: ${hand.playerStart} vs ${hand.dealerUp}</div>`;

      if (hand.actions.length) {
        html += `<div style="color:#cbd5e1;margin-top:2px;">Actions: `;
        hand.actions.forEach((act, i) => {
          html += `${act.action}`;
          if (act.action === 'hit') html += `→${act.cards}(${act.total}${act.soft?'s':''})`;
          if (i < hand.actions.length - 1) html += ', ';
        });
        html += `</div>`;
      }

      if (hand.finalPlayer && hand.finalDealer) {
        html += `<div style="color:#94a3b8;margin-top:2px;font-size:10px;">Final: P${hand.finalPlayer} vs D${hand.finalDealer}</div>`;
      }

      // Add bet/win information (show split info if applicable)
      if (hand.betAmount !== undefined && hand.winAmount !== undefined) {
        html += `<div style="color:#a78bfa;margin-top:2px;font-size:10px;display:flex;justify-content:space-between;">`;
        if (hand.isSplit) {
          html += `<span>Split: ${hand.splitBetAmount.toFixed(2)}×2</span>`;
        } else {
          html += `<span>Bet: ${hand.betAmount.toFixed(2)}</span>`;
        }
        html += `<span>×${multiplier.toFixed(2)}</span>`;
        html += `<span style="color:${netGain >= 0 ? '#4ade80' : '#f87171'};">${netGain >= 0 ? '+' : ''}${netGain.toFixed(2)}</span>`;
        html += `<span>Won: ${hand.winAmount.toFixed(2)}</span>`;
        html += `</div>`;
      }

      html += `</div>`;
    });

    if (!html) {
      html = '<div style="color:#94a3b8;text-align:center;margin-top:20px;">No hands played yet</div>';
    }

    logEl.innerHTML = html;

    // Update statistics using RUNNING TOTALS (money-based RTP)
    if (statsEl) {
      const wins = runningStats.totalWins;
      const losses = runningStats.totalLosses;
      const pushes = runningStats.totalPushes;
      const total = runningStats.totalHands;
      const totalBet = runningStats.totalBet;
      const totalWon = runningStats.totalWon;
      const netGain = totalWon - totalBet;

      // Calculate true RTP: (money returned / money wagered) * 100
      const rtp = totalBet > 0 ? ((totalWon / totalBet) * 100).toFixed(1) : '0.0';

      console.log('[SBJ DEBUG] Money-based RTP - Total bet:', totalBet, 'Total won:', totalWon, 'Net gain:', netGain.toFixed(2), 'RTP:', rtp + '%');

      statsEl.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
          <span>Hands: ${total}</span>
          <span style="color: #4ade80;">W: ${wins}</span>
          <span style="color: #f87171;">L: ${losses}</span>
          <span style="color: #fbbf24;">P: ${pushes}</span>
          <span>RTP: ${rtp}%</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 10px; color: #6b7280;">
          <span>Bet: ${totalBet.toFixed(2)}</span>
          <span>Net: ${netGain >= 0 ? '+' : ''}${netGain.toFixed(2)}</span>
          <span>Won: ${totalWon.toFixed(2)}</span>
        </div>
      `;
    }
  }

  function toggleLogWindow() {
    let logWindow = document.getElementById('sbj-log-window');

    if (logWindow) {
      logWindow.remove();
      return;
    }

    logWindow = document.createElement('div');
    logWindow.id = 'sbj-log-window';
    logWindow.style.cssText = `
      position: fixed; z-index: 2147483647; top: 20px; right: 20px;
      width: 400px; height: 500px; background: rgba(0,0,0,0.9); color: #fff;
      border: 1px solid #374151; border-radius: 12px; backdrop-filter: blur(8px);
      display: flex; flex-direction: column; font: 12px/1.3 'Monaco', 'Consolas', monospace;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6); cursor: move;
    `;

    const header = document.createElement('div');
    header.id = 'sbj-log-header';
    header.style.cssText = `
      padding: 12px 16px; border-bottom: 1px solid #374151; display: flex;
      justify-content: space-between; align-items: center; background: rgba(99,102,241,0.1);
      cursor: move; user-select: none;
    `;
    header.innerHTML = `
      <span style="font-weight: bold; color: #6366f1; pointer-events: none;">Hand History (drag to move)</span>
      <button onclick="document.getElementById('sbj-log-window').remove()" style="
        background: none; border: none; color: #94a3b8; cursor: pointer;
        font-size: 18px; padding: 0; width: 24px; height: 24px; pointer-events: auto;
      ">×</button>
    `;

    const content = document.createElement('div');
    content.id = 'sbj-log-content';
    content.style.cssText = `
      flex: 1; overflow-y: auto; padding: 12px;
      scrollbar-width: thin; scrollbar-color: #4b5563 transparent;
    `;

    const stats = document.createElement('div');
    stats.id = 'sbj-log-stats';
    stats.style.cssText = `
      padding: 8px 16px; border-top: 1px solid #374151;
      background: rgba(0,0,0,0.3); font-size: 11px; color: #94a3b8;
    `;

    logWindow.append(header, content, stats);
    document.documentElement.appendChild(logWindow);

    // Make it draggable
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const startDrag = (e) => {
      // Only allow dragging from the header, not the close button
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = logWindow.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      header.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const doDrag = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Keep window within viewport
      const maxLeft = window.innerWidth - 400;
      const maxTop = window.innerHeight - 500;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      logWindow.style.left = newLeft + 'px';
      logWindow.style.top = newTop + 'px';
      logWindow.style.right = 'auto';
    };

    const stopDrag = () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'move';
        document.body.style.userSelect = '';
      }
    };

    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);

    // Clean up event listeners when window is removed
    logWindow.addEventListener('remove', () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    });

    updateLogWindow();
  }

  // --------------------------- DOM helpers ---------------------------
  const q  = (sel, root=document)=>root.querySelector(sel);
  const qa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

  const SELECTORS = {
    playBtn:   '[data-testid="bet-button"][data-test-action-enabled="true"]',
    actBtns:   '[data-testid="action"][data-test-action-enabled="true"]',
  };

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function humanClick(el){
    if (!el) return false;
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.max(1, Math.min(rect.width-2, 4 + Math.random()*(rect.width-8)));
      const y = rect.top  + Math.max(1, Math.min(rect.height-2, 4 + Math.random()*(rect.height-8)));
      const opts = {bubbles:true, cancelable:true, clientX:x, clientY:y};
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      await sleep(5 + Math.random()*15);
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch { return false; }
  }

  // --------------------------- Network monitoring for updated game state ---------------------------
  let _waitingForUpdate = false;
  let _updateReceived = null;

  // Patch fetch to capture blackjack responses (only if not already patched)
  if (!window._sbjFetchPatched) {
    const _origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const res = await _origFetch.apply(this, arguments);
      try {
        const url = (typeof input === 'string') ? input : input?.url || '';
        const isBJ = /\/_api\/casino\/blackjack\/(bet|next)\b/.test(url);
        const ct = res.headers?.get?.('content-type') || '';

        if (isBJ && ct.includes('application/json')) {
          console.log(`[SBJ DEBUG] Intercepted blackjack API call: ${url}`);
          const clone = res.clone();
          clone.text().then(txt => {
            console.log(`[SBJ DEBUG] API Response received, length: ${txt.length}`);
            setLastFromJSON(txt);
            // Signal that we got an update
            if (_waitingForUpdate) {
              _updateReceived = txt;
              console.log('[SBJ] Network update received');
            }
          }).catch(err => {
            console.log('[SBJ DEBUG] Error reading API response:', err);
          });
        }
      } catch (err) {
        console.log('[SBJ DEBUG] Error in fetch interception:', err);
      }
      return res;
    };
    window._sbjFetchPatched = true;
    console.log('[SBJ] Network monitoring patched');
  }

  async function waitForNetworkUpdate(timeoutMs = 1000) { // Reduced for faster play
    _waitingForUpdate = true;
    _updateReceived = null;

    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (_updateReceived) {
        _waitingForUpdate = false;
        console.log('[SBJ] Network update captured');
        return true;
      }
      await sleep(20); // Reduced for faster play
    }

    _waitingForUpdate = false;
    console.log('[SBJ] Network update timeout');
    return false;
  }

  function clickAction(name) {
    const btn = qa(SELECTORS.actBtns).find(b => (b.getAttribute('data-test-action') || b.getAttribute('action')) === name);
    if (!btn) return false;
    return humanClick(btn);
  }
  function clickPlay() {
    const btn = q(SELECTORS.playBtn);
    if (!btn) return false;
    return humanClick(btn);
  }
  function getAvailableActions() {
    return qa(SELECTORS.actBtns).map(b => b.getAttribute('data-test-action') || b.getAttribute('action') || '');
  }

  // --------------------------- bet matrix ---------------------------
  const betMatrix = {
    hard: {
      "4":{"2":"H","3":"H","4":"H","5":"H","6":"H","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "5":{"2":"H","3":"H","4":"H","5":"H","6":"H","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "6":{"2":"H","3":"H","4":"H","5":"H","6":"H","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "7":{"2":"H","3":"H","4":"H","5":"H","6":"H","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "8":{"2":"H","3":"H","4":"H","5":"H","6":"H","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "9":{"2":"H","3":"D","4":"D","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "10":{"2":"D","3":"D","4":"D","5":"D","6":"D","7":"D","8":"D","9":"D","10":"H","A":"H"},
      "11":{"2":"D","3":"D","4":"D","5":"D","6":"D","7":"D","8":"D","9":"D","10":"D","A":"D"},
      "12":{"2":"H","3":"H","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "13":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "14":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "15":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "16":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "17":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "18":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "19":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "20":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "21":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"}
    },
    soft: {
      "12":{"2":"H","3":"H","4":"H","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "13":{"2":"H","3":"H","4":"H","5":"H","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "14":{"2":"H","3":"H","4":"H","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "15":{"2":"H","3":"H","4":"H","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "16":{"2":"H","3":"H","4":"D","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "17":{"2":"H","3":"D","4":"D","5":"D","6":"D","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "18":{"2":"S","3":"DS","4":"DS","5":"DS","6":"DS","7":"S","8":"S","9":"H","10":"H","A":"H"},
      "19":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "20":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "21":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"}
    },
    splits: {
      "22":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"P","8":"H","9":"H","10":"H","A":"H"},
      "33":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"P","8":"H","9":"H","10":"H","A":"H"},
      "44":{"2":"H","3":"H","4":"H","5":"P","6":"P","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "55":{"2":"D","3":"D","4":"D","5":"D","6":"D","7":"D","8":"D","9":"D","10":"H","A":"H"},
      "66":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"H","8":"H","9":"H","10":"H","A":"H"},
      "77":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"P","8":"H","9":"H","10":"H","A":"H"},
      "88":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"P","8":"P","9":"P","10":"P","A":"P"},
      "99":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"S","8":"P","9":"P","10":"S","A":"S"},
      "1010":{"2":"S","3":"S","4":"S","5":"S","6":"S","7":"S","8":"S","9":"S","10":"S","A":"S"},
      "AA":{"2":"P","3":"P","4":"P","5":"P","6":"P","7":"P","8":"P","9":"P","10":"P","A":"P"}
    }
  };

  // --------------------------- State capture (fetch-only, safe) ---------------------------
  let _lastBJRaw = null; // whole JSON root that contains blackjackBet
  function deepFindBlackjack(node, max=12000) {
    const stack = [node]; let seen = 0;
    while (stack.length && seen < max) {
      const cur = stack.pop(); seen++;
      if (!cur || typeof cur !== 'object') continue;

      // Look for both blackjackBet and blackjackNext
      if (cur.blackjackBet) return cur.blackjackBet;
      if (cur.blackjackNext) return cur.blackjackNext;
      if (cur.data && cur.data.blackjackBet) return cur.data.blackjackBet;
      if (cur.data && cur.data.blackjackNext) return cur.data.blackjackNext;

      for (const k in cur) if (Object.prototype.hasOwnProperty.call(cur,k)) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return null;
  }
  function setLastFromJSON(txt) {
    try {
      const j = JSON.parse(txt);
      if (!j) return;

      // Debug: Log the actual response structure
      console.log('[SBJ DEBUG] Full API response structure:', j);

      const bj = deepFindBlackjack(j);
      if (bj) {
        _lastBJRaw = j;
        console.log('[SBJ DEBUG] Successfully updated _lastBJRaw with blackjack data');

        // Log the updated game state details
        const st = bj.state || {};
        const players = st.player || [];
        const dealer = (st.dealer || [])[0] || {};
        if (players[0]) {
          console.log('[SBJ DEBUG] Updated game state - Player total:', players[0].value, 'Cards:', players[0].cards?.map(c => c.rank));
          console.log('[SBJ DEBUG] Updated game state - Dealer upcard:', dealer.cards?.[0]?.rank);
        }
      } else {
        console.log('[SBJ DEBUG] No blackjack data found. Response keys:', Object.keys(j));
        if (j.blackjackNext) {
          console.log('[SBJ DEBUG] Found blackjackNext, keys:', Object.keys(j.blackjackNext));
          console.log('[SBJ DEBUG] blackjackNext structure:', j.blackjackNext);
        }
      }
    } catch (err) {
      console.log('[SBJ DEBUG] Error parsing JSON:', err);
    }
  }

  // Note: Fetch patching is now handled in the network monitoring section above

  // --------------------------- Interpret server state ---------------------------
  function computeSoftFromRanks(total, ranks){
    // A hand is soft if it contains an Ace that can be counted as 11 without busting
    const aceCount = ranks.filter(r => r === 'A').length;
    if (!aceCount) return false;

    // Calculate the minimum total (all Aces = 1)
    let minTotal = 0;
    for (const rank of ranks) {
      if (rank === 'A') {
        minTotal += 1;
      } else if (['J', 'Q', 'K'].includes(rank)) {
        minTotal += 10;
      } else {
        minTotal += parseInt(rank);
      }
    }

    // If we can count one Ace as 11 and stay <= 21, it's soft
    // (minTotal + 10 represents counting one Ace as 11 instead of 1)
    const softTotal = minTotal + 10;
    const isSoft = softTotal <= 21 && softTotal === total;

    console.log(`[SBJ DEBUG] Soft calculation: cards=${ranks.join(',')}, total=${total}, minTotal=${minTotal}, softTotal=${softTotal}, isSoft=${isSoft}`);

    return isSoft;
  }

  function readServer() {
    // returns {activeIndex, total, soft, upRank, actions, cardsRanks, stateKey, rawBj}
    if (!_lastBJRaw) {
      console.log('[SBJ DEBUG] No _lastBJRaw available');
      return null;
    }

    const bj = deepFindBlackjack(_lastBJRaw);
    if (!bj) {
      console.log('[SBJ DEBUG] No blackjack data found in _lastBJRaw');
      return null;
    }

    const st = bj.state || {};
    const players = st.player || [];
    const dealer  = (st.dealer || [])[0] || {};
    const upRank  = (dealer.cards && dealer.cards[0] && dealer.cards[0].rank) || null;

    console.log('[SBJ DEBUG] Raw dealer data:', dealer);
    console.log('[SBJ DEBUG] Extracted upRank:', upRank);
    console.log('[SBJ DEBUG] All player hands:', players.length);

    // Find the currently active hand (the one that needs a decision)
    let activeIndex = -1;

    // First, check if any hand currently has actionable buttons
    const availableButtons = getAvailableActions();
    const hasGameActions = availableButtons.some(a => ['hit','stand','double','split'].includes(a));

    console.log('[SBJ DEBUG] Available buttons:', availableButtons, 'hasGameActions:', hasGameActions);

    if (hasGameActions) {
      // Look for the hand that corresponds to the current actionable buttons
      for (let i = 0; i < players.length; i++) {
        const hand = players[i];
        const acts = hand.actions || [];

        // Skip hands that are already complete (have final actions like 'stand', 'bust', etc)
        const completedActions = ['stand', 'bust', 'blackjack', 'surrender'];
        const hasCompletedAction = acts.some(a => completedActions.includes(a));

        // For splits, look for hands that need decisions
        const needsDecision = hand.cards && hand.cards.length >= 2 && !hasCompletedAction;

        console.log(`[SBJ DEBUG] Hand ${i}: cards=${hand.cards?.length || 0}, actions=[${acts.join(',')}], completed=${hasCompletedAction}, needsDecision=${needsDecision}, value=${hand.value}`);

        if (needsDecision) {
          activeIndex = i;
          console.log(`[SBJ DEBUG] Found active split hand at index ${i}`);
          break;
        }
      }
    }

    // Fallback to find any hand with cards if no specific active hand found
    if (activeIndex === -1 && players.length) {
      for (let i = 0; i < players.length; i++) {
        if (players[i].cards && players[i].cards.length >= 2) {
          activeIndex = i;
          console.log(`[SBJ DEBUG] Fallback: using hand ${i} with ${players[i].cards.length} cards`);
          break;
        }
      }
      if (activeIndex === -1) activeIndex = 0;
    }

    const hand = players[activeIndex] || players[0] || null;
    if (!hand) {
      console.log('[SBJ DEBUG] No hand data found');
      return null;
    }

    const actions = (hand.actions || []).slice();
    const total   = Number(hand.value || 0);
    const cards   = (hand.cards || []);
    const cardsRanks = cards.map(c => c.rank);

    const soft = computeSoftFromRanks(total, cardsRanks);

    const id  = bj.id || '';
    const upd = bj.updatedAt || '';
    const handSig = cardsRanks.join('.');
    const stateKey = [id, upd, activeIndex, handSig, total].join('#');

    console.log('[SBJ DEBUG] Parsed hand data:', {
      total, soft, upRank, actions, cardsRanks,
      playerCount: players.length, activeIndex
    });

    return { activeIndex, total, soft, upRank, actions, cardsRanks, stateKey, rawBj: bj };
  }

  // --------------------------- Decision from matrix ---------------------------
  function decideFromMatrix(view) {
    // returns one of ['hit','stand','double','split','noInsurance','insurance'] respecting DS/D rules + safety guards.
    const { total, soft, upRank, actions, cardsRanks } = view;

    // insurance phase handled first
    if (actions.includes('noInsurance') || actions.includes('insurance')) {
      return actions.includes('noInsurance') ? 'noInsurance' : 'insurance';
    }

    // hard safety: never hit hard ≥ 17
    if (!soft && total >= 17 && actions.includes('stand')) return 'stand';
    // soft safety: never hit soft ≥ 19 (soft 18 can hit vs 9/10/A)
    if (soft && total >= 19 && actions.includes('stand')) return 'stand';

    // SPLIT logic MUST come before soft/hard logic (only if exactly two same ranks and split available)
    if (cardsRanks.length === 2 && cardsRanks[0] === cardsRanks[1] && actions.includes('split')) {
      const tenRanks = new Set(['10','J','Q','K']);
      const pairKey = tenRanks.has(cardsRanks[0]) ? '1010' : (cardsRanks[0] + cardsRanks[1]);
      const rec = betMatrix.splits[pairKey]?.[upRank];
      console.log(`[SBJ DEBUG] Split decision: pair=${pairKey}, upcard=${upRank}, recommendation=${rec}`);
      if (rec === 'P') return 'split';
      if (rec === 'S' && actions.includes('stand')) return 'stand';
      if (rec === 'H' && actions.includes('hit')) return 'hit';
      // if no split recommendation or action not available, fall through to hard/soft
    }

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

  // --------------------------- Progress snapshots ---------------------------
  function snapButtons() {
    const acts = getAvailableActions().sort().join(',');
    return acts;
  }
  function snapHand() {
    const v = readServer();
    if (!v) return '';
    return [v.total, v.soft?1:0, v.cardsRanks.join('.'), v.upRank||''].join('|');
  }

  // --------------------------- Hand History Tracking (moved to top) ---------------------------
  const SBJ = {
    _running: false,
    _lastKeyActed: null,
    _statusEl: null,
    _handCountEl: null,
    _handsPerSecEl: null,
    _currentBetEl: null,
    _totalWinEl: null,
    _wagerCountEl: null,
    _reloadCountEl: null,
    _targetHands: 0, // 0 = unlimited
    _targetWager: 0, // 0 = unlimited
    _playedHands: 0,
    _handTimestamps: [], // Track timestamps for hands/sec calculation
    _continuationEnabled: false,
    _reloadCount: 0,
    _handStartTime: null, // Track when current hand started

    _emit(msg){ console.log(msg); if (this._statusEl) this._statusEl.textContent = msg.replace(/^\[SBJ\]\s*/,''); },
    _updateHandCounter() {
      if (this._handCountEl) {
        if (this._targetHands > 0) {
          this._handCountEl.textContent = `${this._playedHands}/${this._targetHands}`;
        } else {
          this._handCountEl.textContent = `${this._playedHands}/∞`;
        }
      }
    },
    _updateHandsPerSec() {
      if (!this._handsPerSecEl) return;

      const now = Date.now();
      this._handTimestamps.push(now);

      // Keep only last 20 hands for calculation
      if (this._handTimestamps.length > 20) {
        this._handTimestamps = this._handTimestamps.slice(-20);
      }

      // Need at least 2 hands to calculate rate
      if (this._handTimestamps.length < 2) {
        this._handsPerSecEl.textContent = '-- h/s';
        return;
      }

      // Calculate hands per second based on last 10 hands (or all if less than 10)
      const recentCount = Math.min(10, this._handTimestamps.length);
      const recentTimestamps = this._handTimestamps.slice(-recentCount);
      const timeSpan = recentTimestamps[recentTimestamps.length - 1] - recentTimestamps[0];

      // Safety check: prevent division by zero or very small numbers
      if (timeSpan < 100) {
        // If less than 100ms elapsed, not enough data yet
        this._handsPerSecEl.textContent = '-- h/s';
        return;
      }

      const handsPerSec = (recentCount - 1) / (timeSpan / 1000);

      // Safety check: cap at reasonable max (no more than 10 hands/sec)
      if (handsPerSec > 10 || !isFinite(handsPerSec)) {
        this._handsPerSecEl.textContent = '-- h/s';
        return;
      }

      this._handsPerSecEl.textContent = `${handsPerSec.toFixed(2)} h/s`;
    },
    _updateCurrentBet() {
      if (!this._currentBetEl) return;

      const betAmount = getBetAmountFromUI();
      if (betAmount !== null) {
        this._currentBetEl.textContent = `Bet: $${betAmount.toFixed(2)}`;
      } else {
        this._currentBetEl.textContent = 'Bet: --';
      }
    },
    _updateTotalWin() {
      if (!this._totalWinEl) return;

      const netGain = runningStats.totalWon - runningStats.totalBet;
      const color = netGain >= 0 ? '#4ade80' : '#f87171'; // green if positive, red if negative
      this._totalWinEl.style.color = color;
      this._totalWinEl.textContent = `Win: $${netGain.toFixed(2)}`;
    },
    _updateWagerCounter() {
      if (!this._wagerCountEl) return;

      const totalWagered = runningStats.totalBet;

      if (this._targetWager > 0) {
        this._wagerCountEl.textContent = `$${totalWagered.toFixed(2)}/$${this._targetWager.toFixed(2)}`;
      } else {
        this._wagerCountEl.textContent = `$${totalWagered.toFixed(2)}/∞`;
      }
    },
    _updateReloadCounter() {
      if (!this._reloadCountEl) return;
      this._reloadCountEl.textContent = `Reloads: ${this._reloadCount}`;
    },
    _saveState() {
      const state = {
        runningStats: runningStats,
        targetHands: this._targetHands,
        targetWager: this._targetWager,
        playedHands: this._playedHands,
        reloadCount: this._reloadCount,
        continuationEnabled: this._continuationEnabled,
        timestamp: Date.now()
      };
      localStorage.setItem('sbj-continuation-state', JSON.stringify(state));
      console.log('[SBJ] State saved for continuation');
    },
    _loadState() {
      const saved = localStorage.getItem('sbj-continuation-state');
      if (!saved) return false;

      try {
        const state = JSON.parse(saved);

        // Restore running stats
        runningStats.totalWins = state.runningStats.totalWins;
        runningStats.totalLosses = state.runningStats.totalLosses;
        runningStats.totalPushes = state.runningStats.totalPushes;
        runningStats.totalHands = state.runningStats.totalHands;
        runningStats.totalBet = state.runningStats.totalBet;
        runningStats.totalWon = state.runningStats.totalWon;

        // Restore settings
        this._targetHands = state.targetHands;
        this._targetWager = state.targetWager;
        this._playedHands = state.playedHands;
        this._reloadCount = state.reloadCount + 1; // Increment reload count
        this._continuationEnabled = state.continuationEnabled;

        console.log('[SBJ] State restored from continuation');
        return true;
      } catch (err) {
        console.log('[SBJ] Failed to restore state:', err);
        return false;
      }
    },
    _clearState() {
      localStorage.removeItem('sbj-continuation-state');
      console.log('[SBJ] Continuation state cleared');
    },
    _triggerReload() {
      if (!this._continuationEnabled) {
        this._emit('[SBJ] Hand timeout - continuation disabled');
        this.stop();
        return;
      }

      this._emit('[SBJ] Hand timeout - reloading page...');
      this._saveState();
      setTimeout(() => location.reload(), 1000); // Small delay for save to complete
    },
    last() { return _lastBJRaw; },

    async _wait(ms){ return sleep(ms); },

    _logPhase(msg, view) {
      const cards = (view?.cardsRanks || []).join(',');
      console.log(`[SBJ] ${msg} | total: ${view?.total} ${view?.soft?'(soft)':''} | up: ${view?.upRank} | acts: [${(view?.actions||[]).join(',')}] | cards: ${cards}`);
      if (this._statusEl) this._statusEl.textContent = `${msg} • total ${view?.total}${view?.soft?' (soft)':''} • up ${view?.upRank || '-'}`;
    },

    async _waitForCardUpdate(beforeState, timeout=4000) {
      const beforeTotal = beforeState.total;
      const beforeCardCount = beforeState.cardsRanks.length;
      const start = performance.now();

      this._emit(`[SBJ] Waiting for new card... (was ${beforeTotal}, ${beforeCardCount} cards)`);

      while (performance.now() - start < timeout) {
        // Check if hand finished
        if (q(SELECTORS.playBtn)) {
          this._emit('[SBJ] Hand finished while waiting for card');
          return null;
        }

        const current = readServer();
        if (!current) {
          await this._wait(100);
          continue;
        }

        const totalChanged = current.total !== beforeTotal;
        const cardCountChanged = current.cardsRanks.length !== beforeCardCount;

        if (totalChanged || cardCountChanged) {
          this._emit(`[SBJ] Card received! ${beforeTotal} → ${current.total}, ${beforeCardCount} → ${current.cardsRanks.length} cards`);
          console.log(`[SBJ DEBUG] New cards: [${current.cardsRanks.join(',')}]`);
          return current;
        }

        await this._wait(80);
      }

      this._emit('[SBJ] Timeout waiting for new card');
      return readServer();
    },

    async _waitForProgress(prevKey, timeout=800) { // Reduced for faster play
      const prevBtns = snapButtons();
      const prevHand = snapHand();
      const start = performance.now();

      // Also track card count changes
      const prevV = readServer();
      const prevCardCount = prevV ? prevV.cardsRanks.length : 0;

      while (performance.now() - start < timeout) {
        const v = readServer();
        const sameKey  = v && v.stateKey === prevKey;
        const changedButtons = snapButtons() !== prevBtns;
        const changedHand    = snapHand()   !== prevHand;
        const changedCards   = v && v.cardsRanks.length !== prevCardCount;

        // Progress detected if: different state key OR buttons changed OR hand changed OR cards changed
        if (!sameKey || changedButtons || changedHand || changedCards) {
          console.log(`[SBJ DEBUG] Progress detected: sameKey=${!sameKey}, buttons=${changedButtons}, hand=${changedHand}, cards=${changedCards}`);
          return v || readServer();
        }
        await this._wait(25); // Reduced for faster play
      }
      return readServer();
    },

    _checkHandTimeout() {
      if (!this._handStartTime) return false;
      const elapsed = Date.now() - this._handStartTime;
      return elapsed > 30000; // 30 seconds
    },

    async _playOneHand() {
      this._emit('[SBJ] Starting hand sequence...');

      // Reset deduplication for new hand
      this._lastKeyActed = null;

      // Track hand start time for timeout detection
      this._handStartTime = Date.now();

      // Step 1: Start a new hand if Play button is visible
      const playVisible = !!q(SELECTORS.playBtn);
      if (playVisible) {
        this._emit('[SBJ] Clicking Play to start hand...');
        if (await clickPlay()) {
          await this._wait(200); // Reduced for faster play
        } else {
          this._emit('[SBJ] Failed to click Play button');
          return;
        }
      }

      // Step 2: Wait for initial cards to be dealt
      this._emit('[SBJ] Waiting for cards to be dealt...');
      let dealWaitAttempts = 0;
      while (dealWaitAttempts < 30) {
        await this._wait(100);
        let btnActs = getAvailableActions();
        let v = readServer();

        // Check if we got a complete initial hand
        if (v && v.cardsRanks.length >= 2 && v.upRank) {
          // Start tracking if not already started
          if (!currentHand) {
            console.log('[SBJ DEBUG] Starting hand tracking after deal:', v.cardsRanks, 'vs', v.upRank);
            startNewHand(v.cardsRanks, v.upRank);
          }

          // Check for immediate hand end (blackjacks)
          const gameActions = btnActs.filter(a => ['hit','stand','double','split','insurance','noInsurance'].includes(a));
          const playButton = q(SELECTORS.playBtn);

          if (gameActions.length > 0) {
            this._emit('[SBJ] Cards dealt, game actions available');
            break;
          } else if (playButton) {
            // Hand ended immediately - likely blackjacks
            this._emit('[SBJ] Hand ended immediately after deal - checking for blackjacks');

            const dealerData = v.rawBj?.state?.dealer?.[0];
            const dealerTotal = dealerData?.value || 0;
            const dealerCards = dealerData?.cards?.length || 0;

            let result = 'unknown';
            const playerBJ = (v.total === 21 && v.cardsRanks.length === 2);
            const dealerBJ = (dealerTotal === 21 && dealerCards === 2);

            if (playerBJ && dealerBJ) {
              result = 'push';
              console.log('[SBJ DEBUG] Both blackjacks - push');
            } else if (playerBJ) {
              result = 'win';
              console.log('[SBJ DEBUG] Player blackjack wins');
            } else if (dealerBJ) {
              result = 'loss';
              console.log('[SBJ DEBUG] Dealer blackjack wins');
            } else {
              console.log('[SBJ DEBUG] Hand ended immediately but no blackjacks detected');
            }

            if (currentHand && result !== 'unknown') {
              console.log('[SBJ DEBUG] Finishing immediate hand - Result:', result, 'Player:', v.total, 'Dealer:', dealerTotal);
              finishHand(result, v.total, dealerTotal);
            }

            // Hand is complete, exit the game loop
            this._emit('[SBJ] Hand completed - exiting to start new hand');
            return;
          }
        }

        // If we have deal action, click it
        if (btnActs.includes('deal')) {
          this._emit(`[SBJ] Sending deal (attempt ${dealWaitAttempts + 1})...`);
          if (await clickAction('deal')) {
            await this._wait(200);
          }
        }

        dealWaitAttempts++;
      }

      // Step 3: Main game action loop
      this._emit('[SBJ] Starting game decisions...');
      for (let safety = 0; safety < 50; safety++) {
        await this._wait(30); // Reduced for faster play

        // Check for hand timeout
        if (this._checkHandTimeout()) {
          this._emit('[SBJ] Hand timeout - 30 seconds exceeded');
          this._triggerReload();
          return;
        }

        // Always get fresh data
        let v = readServer();
        let btnActs = getAvailableActions();

        // Debug logging to see what's happening
        if (v && btnActs.length > 0) {
          console.log(`[SBJ DEBUG] Server: total=${v.total}, cards=[${v.cardsRanks.join(',')}], upcard=${v.upRank}`);
          console.log(`[SBJ DEBUG] Buttons: [${btnActs.join(',')}]`);
        }

        // Check if hand is complete
        if (q(SELECTORS.playBtn)) {
          this._emit('[SBJ] Hand complete - Play button returned');
          break;
        }

        // Handle insurance phase
        if (btnActs.includes('noInsurance') || btnActs.includes('insurance')) {
          const action = btnActs.includes('noInsurance') ? 'noInsurance' : 'insurance';
          this._emit(`[SBJ] Insurance phase: ${action}`);

          if (await clickAction(action)) {
            if (v) this._lastKeyActed = v.stateKey;
            await this._waitForProgress(this._lastKeyActed, 200);
          }
          continue;
        }

        // If only deal available, click it and wait longer for real actions
        if (btnActs.length === 1 && btnActs[0] === 'deal') {
          this._emit('[SBJ] Only deal available, clicking and waiting...');
          if (await clickAction('deal')) {
            await this._wait(400);

            // Wait for non-deal actions to appear
            for (let waitCount = 0; waitCount < 20; waitCount++) {
              await this._wait(50);
              const newActions = getAvailableActions();
              const nonDealActions = newActions.filter(a => a !== 'deal');
              if (nonDealActions.length > 0) {
                this._emit(`[SBJ] Real actions now available: [${nonDealActions.join(',')}]`);
                break;
              }
            }
          }
          continue;
        }

        // CRITICAL FIX: On 2-card hands, wait for double button if it should be available
        // This prevents race conditions where double button hasn't rendered yet
        if (v && v.cardsRanks.length === 2 && !btnActs.includes('double')) {
          // Check if this is a hand that should have double available
          // Double is typically available on all 2-card hands (unless blackjack or special rules)
          const shouldHaveDouble = v.total !== 21; // Not blackjack

          if (shouldHaveDouble) {
            // Wait a bit longer for double button to appear
            let foundDouble = false;
            for (let doubleWait = 0; doubleWait < 5; doubleWait++) {
              await this._wait(50);
              const freshActions = getAvailableActions();
              if (freshActions.includes('double')) {
                btnActs = freshActions;
                foundDouble = true;
                console.log('[SBJ DEBUG] Double button appeared after waiting');
                break;
              }
            }

            if (!foundDouble) {
              console.log('[SBJ DEBUG] Warning: Expected double button on 2-card hand but not found. Total:', v.total);
            }
          }
        }

        // Handle main game actions (calculate after potentially updating btnActs)
        const gameActions = btnActs.filter(a => ['hit','stand','double','split'].includes(a));

        if (gameActions.length === 0) {
          // No game actions available
          if (btnActs.includes('deal')) {
            continue; // Will be handled above
          }

          // Nothing to do, wait a bit more or exit if taking too long
          if (safety > 35) {
            this._emit('[SBJ] Timeout waiting for game actions');
            break;
          }
          await this._wait(100);
          continue;
        }

        // We have game actions - ensure we have complete data
        const currentState = readServer();
        if (!currentState) {
          this._emit('[SBJ] No server state available');
          console.log('[SBJ DEBUG] readServer() returned null');
          await this._wait(100);
          continue;
        }

        if (!currentState.upRank) {
          this._emit('[SBJ] Missing dealer upcard');
          console.log('[SBJ DEBUG] Server state:', {total: currentState.total, cards: currentState.cardsRanks, upRank: currentState.upRank, actions: currentState.actions});
          await this._wait(100);
          continue;
        }

        if (currentState.cardsRanks.length < 2) {
          this._emit('[SBJ] Incomplete hand - only ' + currentState.cardsRanks.length + ' cards');
          console.log('[SBJ DEBUG] Server state:', {total: currentState.total, cards: currentState.cardsRanks, upRank: currentState.upRank, actions: currentState.actions});
          await this._wait(100);
          continue;
        }

        // Log complete hand data for debugging
        console.log('[SBJ DEBUG] Complete hand data:', {
          total: currentState.total,
          soft: currentState.soft,
          cards: currentState.cardsRanks,
          upRank: currentState.upRank,
          serverActions: currentState.actions,
          buttonActions: btnActs
        });

        // Start tracking new hand if not already started
        if (!currentHand && currentState.cardsRanks.length === 2) {
          console.log('[SBJ DEBUG] Starting hand tracking:', currentState.cardsRanks, 'vs', currentState.upRank);
          startNewHand(currentState.cardsRanks, currentState.upRank);

          // Check for immediate blackjack (natural 21)
          if (currentState.total === 21) {
            console.log('[SBJ DEBUG] Player blackjack detected!');
            // Don't finish yet - let the normal flow detect the final result
          }
        } else if (!currentHand) {
          console.log('[SBJ DEBUG] No current hand, but only', currentState.cardsRanks.length, 'cards - waiting');
        } else {
          console.log('[SBJ DEBUG] Hand already being tracked:', currentHand.playerStart, 'vs', currentHand.dealerUp);
        }

        // Use currentState for the rest of the logic
        v = currentState;

        // Avoid duplicate actions - but be smarter about it
        if (this._lastKeyActed && v.stateKey === this._lastKeyActed) {
          this._emit('[SBJ] Same state detected, waiting for actual change...');

          // For hit actions, we need to wait for cards to actually change
          await this._wait(200); // Give server time to process
          const updated = readServer();

          if (updated && (updated.total !== v.total || updated.cardsRanks.length !== v.cardsRanks.length)) {
            // State actually changed, continue with new state
            v = updated;
            btnActs = getAvailableActions();
            this._lastKeyActed = null; // Reset since we have new state
            this._emit(`[SBJ] State updated: ${v.total} total, ${v.cardsRanks.length} cards`);
          } else {
            // No real change yet, wait longer
            const waited = await this._waitForProgress(this._lastKeyActed, 3000);
            if (waited) {
              v = waited;
              btnActs = getAvailableActions();
              this._lastKeyActed = null;
            }

            // If Play button appeared, hand is done
            if (q(SELECTORS.playBtn)) {
              this._emit('[SBJ] Hand finished while waiting');
              break;
            }

            // Check if we have valid actions to continue
            const newGameActions = btnActs.filter(a => ['hit','stand','double','split'].includes(a));
            if (newGameActions.length === 0) {
              this._emit('[SBJ] No valid actions after waiting');
              continue;
            }
          }
        }

        // CRITICAL FIX: Create updated view with current button actions
        const currentView = {
          ...v,
          actions: btnActs  // Use current button state, not stale server state
        };

        // Get strategic decision using current buttons
        let decide = decideFromMatrix(currentView);

        // Safety guards - FIXED: hard 18 should stand!
        if (decide === 'hit') {
          if ((!v.soft && v.total >= 17) || (v.soft && v.total >= 19)) {
            decide = 'stand';
            this._emit('[SBJ] Safety override: changing hit to stand');
          }
        }

        // Handle unavailable actions
        if (!gameActions.includes(decide)) {
          if (decide === 'double' && gameActions.includes('hit')) {
            decide = 'hit';
          } else if (decide === 'double' && gameActions.includes('stand')) {
            decide = 'stand';
          } else {
            decide = gameActions[0]; // Fallback to first available
          }
        }

        if (!decide || !gameActions.includes(decide)) {
          this._emit('[SBJ] No valid decision available');
          await this._wait(100);
          continue;
        }

        this._logPhase(`EXECUTING: ${decide}`, currentView);
        console.log(`[SBJ DEBUG] About to click ${decide}. Current stateKey: ${v.stateKey}, Last acted: ${this._lastKeyActed}`);

        // Log the action
        logAction(decide, v.cardsRanks, v.total, v.soft);

        // Execute the action and wait for network response
        console.log(`[SBJ DEBUG] Sending button: ${decide}`);
        const clicked = await clickAction(decide);

        if (clicked) {
          this._lastKeyActed = v.stateKey;
          this._emit(`[SBJ] Sent ${decide}, waiting for network response...`);

          // Wait for the network response to come back
          const gotUpdate = await waitForNetworkUpdate(1000); // Reduced for faster play

          if (gotUpdate) {
            // Reduced wait time for state to update
            await this._wait(20);
            const newState = readServer();
            if (newState && (newState.total !== v.total || newState.cardsRanks.length !== v.cardsRanks.length)) {
              this._emit(`[SBJ] State updated: ${v.total} → ${newState.total}, ${v.cardsRanks.length} → ${newState.cardsRanks.length} cards`);
              // Reset deduplication since we have new state
              this._lastKeyActed = null;
            } else {
              this._emit(`[SBJ] Network response received but state unchanged`);
            }
          } else {
            this._emit(`[SBJ] No network response received for ${decide}`);
          }
        } else {
          this._emit(`[SBJ] Failed to send ${decide} button`);
        }

        // Check if hand finished during action
        if (q(SELECTORS.playBtn)) {
          this._emit('[SBJ] Hand finished during action');

          // Try to determine result from dealer data
          const finalState = readServer();
          if (finalState && currentHand) {
            const dealerData = finalState.rawBj?.state?.dealer?.[0];
            const dealerTotal = dealerData?.value || 0;

            // Simple result detection (could be enhanced)
            let result = 'unknown';
            if (finalState.total > 21) {
              result = 'loss'; // Player bust
            } else if (dealerTotal > 21) {
              result = 'win'; // Dealer bust
            } else if (finalState.total > dealerTotal) {
              result = 'win';
            } else if (finalState.total < dealerTotal) {
              result = 'loss';
            } else {
              result = 'push';
            }

            console.log('[SBJ DEBUG] Finishing hand - Result:', result, 'Player:', finalState.total, 'Dealer:', dealerTotal);
            finishHand(result, finalState.total, dealerTotal);
          } else if (currentHand) {
            // Fallback if we can't determine result
            console.log('[SBJ DEBUG] Finishing hand - unknown result');
            finishHand('unknown', null, null);
          }

          break;
        }
      }

      // Also finish hand when hand sequence completes normally
      if (currentHand) {
        console.log('[SBJ DEBUG] Hand sequence complete, detecting final result...');

        // Try to get final game state and determine result
        const finalState = readServer();
        if (finalState) {
          const dealerData = finalState.rawBj?.state?.dealer?.[0];
          const dealerTotal = dealerData?.value || 0;

          let result = 'unknown';
          if (finalState.total > 21) {
            result = 'loss'; // Player bust
          } else if (dealerTotal > 21) {
            result = 'win'; // Dealer bust
          } else if (dealerTotal === 0) {
            result = 'unknown'; // Dealer hand not complete yet
          } else if (finalState.total > dealerTotal) {
            result = 'win';
          } else if (finalState.total < dealerTotal) {
            result = 'loss';
          } else {
            result = 'push';
          }

          console.log('[SBJ DEBUG] Final result detection (sequence complete) - Player:', finalState.total, 'Dealer:', dealerTotal, 'Result:', result);
          finishHand(result, finalState.total, dealerTotal);
        } else {
          console.log('[SBJ DEBUG] No final state available, finishing as unknown');
          finishHand('unknown', null, null);
        }
      } else {
        console.log('[SBJ DEBUG] Hand sequence complete but no currentHand to finish');
      }

      this._emit('[SBJ] Hand sequence complete');
    },

    async playOnce() {
      await this._playOneHand();
    },

    async start() {
      if (this._running) return;
      this._running = true;
      this._playedHands = 0;
      this._handTimestamps = []; // Reset timestamps
      this._emit('[SBJ] START');
      this._updateHandCounter();
      this._updateCurrentBet(); // Update bet display at start

      while (this._running) {
        // Check if we've reached the target hand count
        if (this._targetHands > 0 && this._playedHands >= this._targetHands) {
          this._emit('[SBJ] Target hand count reached!');
          break;
        }

        // Check if we've reached the target wager amount
        if (this._targetWager > 0 && runningStats.totalBet >= this._targetWager) {
          this._emit('[SBJ] Target wager reached!');
          break;
        }

        this._playedHands++;
        console.log(`[SBJ DEBUG] Starting hand #${this._playedHands}`);
        this._updateHandCounter();
        this._updateCurrentBet(); // Update bet display before each hand

        try {
          await this.playOnce();
          console.log(`[SBJ DEBUG] Completed hand #${this._playedHands}`);
          this._updateHandsPerSec(); // Update hands/sec after each hand
        } catch (error) {
          console.log(`[SBJ DEBUG] Error in hand #${this._playedHands}:`, error);
          this._emit(`[SBJ] Error in hand: ${error.message}`);
        }

        // Minimal pause between hands for maximum speed
        await this._wait(20);
      }
      this._running = false;
      this._emit('[SBJ] STOP');
    },

    stop() {
      this._running = false;
      this._emit('[SBJ] Stopping...');
    }
  };

  // --------------------------- Mini UI ---------------------------
  function mountPanel(){
    if (q('#sbj-mini')) return;
    const box = document.createElement('div');
    box.id = 'sbj-mini';
    box.style.cssText = `
      position: fixed; z-index: 2147483647; bottom: 16px; right: 16px;
      background: rgba(0,0,0,.7); color: #fff; font: 12px/1.2 system-ui, sans-serif;
      padding: 10px 12px; border-radius: 10px; backdrop-filter: blur(6px);
      display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
      max-width: 500px;
    `;

    // Top row: Status and hands per second
    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display: flex; align-items: center; gap: 12px; justify-content: space-between;';

    const status = document.createElement('span');
    status.textContent = 'Idle';
    status.style.cssText = 'min-width: 160px; flex: 1;';
    SBJ._statusEl = status;

    const currentBet = document.createElement('span');
    currentBet.textContent = 'Bet: --';
    currentBet.style.cssText = 'font-size: 11px; color: #4ade80; font-weight: 700; min-width: 70px; text-align: center;';
    SBJ._currentBetEl = currentBet;

    const totalWin = document.createElement('span');
    totalWin.textContent = 'Win: $0.00';
    totalWin.style.cssText = 'font-size: 11px; color: #4ade80; font-weight: 700; min-width: 85px; text-align: center;';
    SBJ._totalWinEl = totalWin;

    const handsPerSec = document.createElement('span');
    handsPerSec.textContent = '-- h/s';
    handsPerSec.style.cssText = 'font-size: 11px; color: #a78bfa; font-weight: 700; min-width: 55px; text-align: right;';
    SBJ._handsPerSecEl = handsPerSec;

    statusRow.append(status, currentBet, totalWin, handsPerSec);

    // Bottom row: Controls
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

    // Hand count controls container
    const handCountContainer = document.createElement('div');
    handCountContainer.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const handCountLabel = document.createElement('span');
    handCountLabel.textContent = 'Hands:';
    handCountLabel.style.cssText = 'font-size: 11px; color: #94a3b8;';

    const handCountInput = document.createElement('input');
    handCountInput.type = 'number';
    handCountInput.placeholder = '∞';
    handCountInput.min = '0';
    handCountInput.value = '0';
    handCountInput.style.cssText = 'width: 50px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid #374151; border-radius: 4px; padding: 4px 6px; font-size: 11px;';
    handCountInput.onchange = (e) => {
      const val = parseInt(e.target.value) || 0;
      SBJ._targetHands = val;
      SBJ._updateHandCounter();
    };

    const handCounter = document.createElement('span');
    handCounter.textContent = '0/∞';
    handCounter.style.cssText = 'font-size: 11px; color: #22d3ee; font-weight: 700; min-width: 45px; text-align: center;';
    SBJ._handCountEl = handCounter;

    handCountContainer.append(handCountLabel, handCountInput, handCounter);

    // Wager count controls container
    const wagerCountContainer = document.createElement('div');
    wagerCountContainer.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const wagerCountLabel = document.createElement('span');
    wagerCountLabel.textContent = 'Wager:';
    wagerCountLabel.style.cssText = 'font-size: 11px; color: #94a3b8;';

    const wagerCountInput = document.createElement('input');
    wagerCountInput.type = 'number';
    wagerCountInput.placeholder = '∞';
    wagerCountInput.min = '0';
    wagerCountInput.step = '1';
    wagerCountInput.value = '0';
    wagerCountInput.style.cssText = 'width: 60px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid #374151; border-radius: 4px; padding: 4px 6px; font-size: 11px;';
    wagerCountInput.onchange = (e) => {
      const val = parseFloat(e.target.value) || 0;
      SBJ._targetWager = val;
      SBJ._updateWagerCounter();
    };

    const wagerCounter = document.createElement('span');
    wagerCounter.textContent = '$0.00/∞';
    wagerCounter.style.cssText = 'font-size: 11px; color: #fbbf24; font-weight: 700; min-width: 110px; text-align: center;';
    SBJ._wagerCountEl = wagerCounter;

    wagerCountContainer.append(wagerCountLabel, wagerCountInput, wagerCounter);

    const btnStart = document.createElement('button');
    btnStart.textContent = 'Start';
    btnStart.style.cssText = 'background:#16a34a;color:#000;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;';
    btnStart.onclick = ()=>SBJ.start();

    const btnStop = document.createElement('button');
    btnStop.textContent = 'Stop';
    btnStop.style.cssText = 'background:#ef4444;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;';
    btnStop.onclick = ()=>SBJ.stop();

    const btnOnce = document.createElement('button');
    btnOnce.textContent = 'Play Once';
    btnOnce.style.cssText = 'background:#22d3ee;color:#003;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;';
    btnOnce.onclick = ()=>SBJ.playOnce();

    const btnLog = document.createElement('button');
    btnLog.textContent = 'History';
    btnLog.style.cssText = 'background:#6366f1;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;';
    btnLog.onclick = () => toggleLogWindow();

    // Continuation cycle container
    const continuationContainer = document.createElement('div');
    continuationContainer.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const continuationCheckbox = document.createElement('input');
    continuationCheckbox.type = 'checkbox';
    continuationCheckbox.id = 'sbj-continuation';
    continuationCheckbox.checked = SBJ._continuationEnabled;
    continuationCheckbox.style.cssText = 'cursor: pointer;';
    continuationCheckbox.onchange = (e) => {
      SBJ._continuationEnabled = e.target.checked;
      if (!e.target.checked) {
        SBJ._clearState(); // Clear saved state when disabled
      }
    };

    const continuationLabel = document.createElement('label');
    continuationLabel.htmlFor = 'sbj-continuation';
    continuationLabel.textContent = 'Continuation Cycle';
    continuationLabel.style.cssText = 'font-size: 11px; color: #94a3b8; cursor: pointer;';

    const reloadCounter = document.createElement('span');
    reloadCounter.textContent = 'Reloads: 0';
    reloadCounter.style.cssText = 'font-size: 11px; color: #f97316; font-weight: 700; min-width: 75px; text-align: center;';
    SBJ._reloadCountEl = reloadCounter;

    continuationContainer.append(continuationCheckbox, continuationLabel, reloadCounter);

    controlsRow.append(handCountContainer, wagerCountContainer, continuationContainer, btnStart, btnStop, btnOnce, btnLog);

    box.append(statusRow, controlsRow);
    document.documentElement.appendChild(box);
  }

  // Nuclear option: Kill all animations and transitions for maximum speed
  function nukeAnimations() {
    if (document.getElementById('sbj-no-animations')) return; // Already injected

    const style = document.createElement('style');
    style.id = 'sbj-no-animations';
    style.textContent = `
      * {
        animation: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[SBJ] Animations nuked for maximum speed');
  }

  // Auto-resume after reload if continuation is enabled
  async function autoResume() {
    if (!location.pathname.startsWith('/casino/games/blackjack')) return;

    // Try to load saved state
    const restored = SBJ._loadState();
    if (!restored || !SBJ._continuationEnabled) return;

    console.log('[SBJ] Continuation state restored, waiting to auto-start...');

    // Update all UI displays
    SBJ._updateHandCounter();
    SBJ._updateWagerCounter();
    SBJ._updateTotalWin();
    SBJ._updateReloadCounter();

    // Update checkbox to match restored state
    const checkbox = document.getElementById('sbj-continuation');
    if (checkbox) checkbox.checked = true;

    // Wait for page to be ready (play/deal button visible)
    let attempts = 0;
    while (attempts < 50) {
      await sleep(200);
      const playBtn = q(SELECTORS.playBtn);
      const dealBtn = q(SELECTORS.dealBtn);
      if (playBtn || dealBtn) {
        console.log('[SBJ] Page ready, auto-starting...');
        await sleep(1000); // Extra delay for stability
        SBJ.start();
        return;
      }
      attempts++;
    }

    console.log('[SBJ] Timeout waiting for page ready, auto-start aborted');
  }

  const ro = new MutationObserver(() => {
    if (location.pathname.startsWith('/casino/games/blackjack')) {
      nukeAnimations();
      mountPanel();
      autoResume();
    }
  });
  ro.observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('DOMContentLoaded', () => {
    if (location.pathname.startsWith('/casino/games/blackjack')) {
      nukeAnimations();
      mountPanel();
      autoResume();
    }
  });

  // --------------------------- TEST SUITE ---------------------------
  const TestSuite = {
    tests: [],
    results: [],

    // Test helper to assert conditions
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

    // Add a test case
    test(name, fn) {
      this.tests.push({ name, fn });
    },

    // Mock game state for testing
    mockGameState(config) {
      return {
        state: {
          player: config.playerHands || [],
          dealer: config.dealer ? [config.dealer] : []
        },
        bet: { amount: config.betAmount || 1 },
        betAmount: config.betAmount || 1,
        payout: config.payout || 0,
        profit: config.profit || 0
      };
    },

    // Reset tracking state for clean tests
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

    // Run all tests
    async runAll() {
      this.results = [];
      console.log('%c[TEST SUITE] Starting tests...', 'color:#00ff00; font-weight:bold');

      for (const test of this.tests) {
        try {
          this.resetTracking();
          await test.fn();
          this.results.push({ name: test.name, status: 'PASS', error: null });
          console.log(`%c✓ ${test.name}`, 'color:#00ff00');
        } catch (error) {
          this.results.push({ name: test.name, status: 'FAIL', error: error.message });
          console.error(`%c✗ ${test.name}`, 'color:#ff0000');
          console.error(`  ${error.message}`);
        }
      }

      const passed = this.results.filter(r => r.status === 'PASS').length;
      const failed = this.results.filter(r => r.status === 'FAIL').length;

      console.log(`%c[TEST SUITE] Complete: ${passed} passed, ${failed} failed`,
        failed > 0 ? 'color:#ff0000; font-weight:bold' : 'color:#00ff00; font-weight:bold');

      return this.results;
    }
  };

  // --------------------------- TEST CASES ---------------------------

  // Test 1: Basic win scenario
  TestSuite.test('Basic Win - Correct bet and win amount tracking', () => {
    const betAmount = 1.00;
    startNewHand(['K', '9'], '7', betAmount);

    // Simulate a stand and win
    logAction('stand', ['K', '9'], 19, false);

    // Mock the game state for finishing
    const mockState = TestSuite.mockGameState({
      betAmount: betAmount,
      playerHands: [{ value: 19, cards: [{rank:'K'},{rank:'9'}], actions: ['stand'] }],
      dealer: { value: 18, cards: [{rank:'7'},{rank:'K'},{rank:'A'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 19, 18);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
    TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total bet should be 1.00');
    TestSuite.assertClose(runningStats.totalWon, 2.00, 0.01, 'Total won should be ~2.00 (bet returned + profit)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.00, 0.01, 'Net profit should be ~1.00');
  });

  // Test 2: Basic loss scenario
  TestSuite.test('Basic Loss - Correct bet and loss tracking', () => {
    const betAmount = 1.00;
    startNewHand(['10', '6'], '10', betAmount);

    logAction('hit', ['10', '6', '9'], 25, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount,
      playerHands: [{ value: 25, cards: [{rank:'10'},{rank:'6'},{rank:'9'}], actions: ['bust'] }],
      dealer: { value: 20, cards: [{rank:'10'},{rank:'K'}] }
    });
    _lastBJRaw = mockState;

    finishHand('loss', 25, 20);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalLosses, 1, 'Should have 1 loss');
    TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total bet should be 1.00');
    TestSuite.assertEqual(runningStats.totalWon, 0, 'Total won should be 0');
    TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, -1.00, 'Net loss should be -1.00');
  });

  // Test 3: Push scenario
  TestSuite.test('Push - Bet returned correctly', () => {
    const betAmount = 1.00;
    startNewHand(['K', '7'], '10', betAmount);

    logAction('stand', ['K', '7'], 17, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount,
      playerHands: [{ value: 17, cards: [{rank:'K'},{rank:'7'}], actions: ['stand'] }],
      dealer: { value: 17, cards: [{rank:'10'},{rank:'7'}] }
    });
    _lastBJRaw = mockState;

    finishHand('push', 17, 17);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalPushes, 1, 'Should have 1 push');
    TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total bet should be 1.00');
    TestSuite.assertEqual(runningStats.totalWon, 1.00, 'Total won should be 1.00 (bet returned)');
    TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, 0, 'Net should be 0');
  });

  // Test 4: Double down win
  TestSuite.test('Double Down Win - Bet doubled correctly', () => {
    const betAmount = 1.00;
    startNewHand(['5', '6'], '6', betAmount);

    logAction('double', ['5', '6', '9'], 20, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2,
      playerHands: [{ value: 20, cards: [{rank:'5'},{rank:'6'},{rank:'9'}], actions: ['double'] }],
      dealer: { value: 19, cards: [{rank:'6'},{rank:'K'},{rank:'3'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 20, 19);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
    TestSuite.assertEqual(runningStats.totalBet, 2.00, 'Total bet should be 2.00 (doubled)');
    TestSuite.assertClose(runningStats.totalWon, 4.00, 0.01, 'Total won should be ~4.00');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 2.00, 0.01, 'Net profit should be ~2.00');
  });

  // Test 5: Split - both hands win
  TestSuite.test('Split - Both Hands Win', () => {
    const betAmount = 1.00;
    startNewHand(['8', '8'], '6', betAmount);

    logAction('split', ['8', '8'], 8, false);

    // Simulate both split hands winning
    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2, // Total bet for split
      playerHands: [
        { value: 19, cards: [{rank:'8'},{rank:'K'},{rank:'A'}], actions: ['stand'] },
        { value: 18, cards: [{rank:'8'},{rank:'10'}], actions: ['stand'] }
      ],
      dealer: { value: 17, cards: [{rank:'6'},{rank:'K'},{rank:'A'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 19, 17);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand (split counted as one)');
    TestSuite.assertEqual(runningStats.totalBet, 2.00, 'Total bet should be 2.00 (1.00 per hand)');
    TestSuite.assertClose(runningStats.totalWon, 4.00, 0.01, 'Total won should be ~4.00 (both hands win)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 2.00, 0.01, 'Net profit should be ~2.00');
  });

  // Test 6: Split - both hands lose
  TestSuite.test('Split - Both Hands Lose', () => {
    const betAmount = 1.00;
    startNewHand(['8', '8'], 'K', betAmount);

    logAction('split', ['8', '8'], 8, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2,
      playerHands: [
        { value: 18, cards: [{rank:'8'},{rank:'10'}], actions: ['stand'] },
        { value: 17, cards: [{rank:'8'},{rank:'9'}], actions: ['stand'] }
      ],
      dealer: { value: 20, cards: [{rank:'K'},{rank:'10'}] }
    });
    _lastBJRaw = mockState;

    finishHand('loss', 18, 20);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalBet, 2.00, 'Total bet should be 2.00');
    TestSuite.assertEqual(runningStats.totalWon, 0, 'Total won should be 0 (both hands lose)');
    TestSuite.assertEqual(runningStats.totalWon - runningStats.totalBet, -2.00, 'Net loss should be -2.00');
  });

  // Test 7: Split - one win, one loss
  TestSuite.test('Split - One Win, One Loss (Mixed)', () => {
    const betAmount = 1.00;
    startNewHand(['8', '8'], '7', betAmount);

    logAction('split', ['8', '8'], 8, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2,
      playerHands: [
        { value: 19, cards: [{rank:'8'},{rank:'K'},{rank:'A'}], actions: ['stand'] }, // Win
        { value: 16, cards: [{rank:'8'},{rank:'8'}], actions: ['stand'] }  // Lose
      ],
      dealer: { value: 17, cards: [{rank:'7'},{rank:'10'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 19, 17); // Overall result doesn't matter, per-hand calculation does

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalBet, 2.00, 'Total bet should be 2.00');
    TestSuite.assertClose(runningStats.totalWon, 2.00, 0.01, 'Total won should be ~2.00 (one hand wins 2.00, other loses)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 0.00, 0.01, 'Net should be ~0.00 (break even)');
  });

  // Test 8: Split - one win, one push
  TestSuite.test('Split - One Win, One Push', () => {
    const betAmount = 1.00;
    startNewHand(['9', '9'], '7', betAmount);

    logAction('split', ['9', '9'], 9, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2,
      playerHands: [
        { value: 19, cards: [{rank:'9'},{rank:'10'}], actions: ['stand'] }, // Win
        { value: 18, cards: [{rank:'9'},{rank:'9'}], actions: ['stand'] }  // Push (dealer has 18)
      ],
      dealer: { value: 18, cards: [{rank:'7'},{rank:'K'},{rank:'A'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 19, 18);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalBet, 2.00, 'Total bet should be 2.00');
    TestSuite.assertClose(runningStats.totalWon, 3.00, 0.01, 'Total won should be ~3.00 (one wins 2.00, one pushes 1.00)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.00, 0.01, 'Net profit should be ~1.00');
  });

  // Test 9: Split with double on one hand
  TestSuite.test('Split + Double on One Hand - Bets calculated correctly', () => {
    const betAmount = 1.00;
    startNewHand(['9', '9'], '6', betAmount);

    logAction('split', ['9', '9'], 9, false);
    // First hand doubles
    logAction('double', ['9', 'A', '9'], 19, false);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount * 2, // Base split bet
      playerHands: [
        { value: 19, cards: [{rank:'9'},{rank:'A'},{rank:'9'}], actions: ['double'] }, // Doubled to 2.00
        { value: 19, cards: [{rank:'9'},{rank:'10'}], actions: ['stand'] }  // Regular 1.00
      ],
      dealer: { value: 17, cards: [{rank:'6'},{rank:'K'},{rank:'A'}] }
    });
    _lastBJRaw = mockState;

    // Total bet should be 3.00 (1.00 + 2.00)
    // But our code tracks it as: original 1.00 * 2 for split = 2.00, then + 1.00 for double = 3.00
    finishHand('win', 19, 17);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalBet, 3.00, 'Total bet should be 3.00 (split + double on one)');
    TestSuite.assertClose(runningStats.totalWon, 6.00, 0.01, 'Total won should be ~6.00 (both hands win)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 3.00, 0.01, 'Net profit should be ~3.00');
  });

  // Test 10: Blackjack win
  TestSuite.test('Blackjack - 3:2 Payout', () => {
    const betAmount = 1.00;
    startNewHand(['A', 'K'], '7', betAmount);

    const mockState = TestSuite.mockGameState({
      betAmount: betAmount,
      playerHands: [{ value: 21, cards: [{rank:'A'},{rank:'K'}], actions: [] }],
      dealer: { value: 19, cards: [{rank:'7'},{rank:'Q'},{rank:'2'}] }
    });
    _lastBJRaw = mockState;

    finishHand('win', 21, 19);

    TestSuite.assertEqual(runningStats.totalHands, 1, 'Should have 1 hand');
    TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
    TestSuite.assertEqual(runningStats.totalBet, 1.00, 'Total bet should be 1.00');
    TestSuite.assertClose(runningStats.totalWon, 2.50, 0.01, 'Total won should be ~2.50 (3:2 blackjack payout)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 1.50, 0.01, 'Net profit should be ~1.50');
  });

  // Test 11: Multiple hands accumulation
  TestSuite.test('Multiple Hands - Cumulative Stats Correct', () => {
    // Hand 1: Win 1.00
    startNewHand(['K', '9'], '7', 1.00);
    logAction('stand', ['K', '9'], 19, false);
    let mockState = TestSuite.mockGameState({
      betAmount: 1.00,
      playerHands: [{ value: 19, cards: [{rank:'K'},{rank:'9'}], actions: ['stand'] }],
      dealer: { value: 18, cards: [{rank:'7'},{rank:'K'},{rank:'A'}] }
    });
    _lastBJRaw = mockState;
    finishHand('win', 19, 18);

    // Hand 2: Lose 1.00
    startNewHand(['10', '6'], '10', 1.00);
    logAction('hit', ['10', '6', '9'], 25, false);
    mockState = TestSuite.mockGameState({
      betAmount: 1.00,
      playerHands: [{ value: 25, cards: [{rank:'10'},{rank:'6'},{rank:'9'}], actions: ['bust'] }],
      dealer: { value: 20, cards: [{rank:'10'},{rank:'K'}] }
    });
    _lastBJRaw = mockState;
    finishHand('loss', 25, 20);

    // Hand 3: Push 1.00
    startNewHand(['K', '7'], '10', 1.00);
    logAction('stand', ['K', '7'], 17, false);
    mockState = TestSuite.mockGameState({
      betAmount: 1.00,
      playerHands: [{ value: 17, cards: [{rank:'K'},{rank:'7'}], actions: ['stand'] }],
      dealer: { value: 17, cards: [{rank:'10'},{rank:'7'}] }
    });
    _lastBJRaw = mockState;
    finishHand('push', 17, 17);

    TestSuite.assertEqual(runningStats.totalHands, 3, 'Should have 3 hands total');
    TestSuite.assertEqual(runningStats.totalWins, 1, 'Should have 1 win');
    TestSuite.assertEqual(runningStats.totalLosses, 1, 'Should have 1 loss');
    TestSuite.assertEqual(runningStats.totalPushes, 1, 'Should have 1 push');
    TestSuite.assertEqual(runningStats.totalBet, 3.00, 'Total bet should be 3.00');
    TestSuite.assertClose(runningStats.totalWon, 3.00, 0.01, 'Total won should be ~3.00 (2.00 + 0 + 1.00)');
    TestSuite.assertClose(runningStats.totalWon - runningStats.totalBet, 0.00, 0.01, 'Net should be 0.00 (break even)');
  });

  // Test 12: RTP Calculation
  TestSuite.test('RTP Calculation - Percentage Correct', () => {
    // Simulate 10 hands with known outcomes
    for (let i = 0; i < 5; i++) {
      // 5 wins
      startNewHand(['K', '9'], '7', 1.00);
      let mockState = TestSuite.mockGameState({
        betAmount: 1.00,
        playerHands: [{ value: 19, cards: [{rank:'K'},{rank:'9'}], actions: [] }],
        dealer: { value: 18, cards: [{rank:'7'},{rank:'K'},{rank:'A'}] }
      });
      _lastBJRaw = mockState;
      finishHand('win', 19, 18);
    }

    for (let i = 0; i < 5; i++) {
      // 5 losses
      startNewHand(['10', '6'], '10', 1.00);
      let mockState = TestSuite.mockGameState({
        betAmount: 1.00,
        playerHands: [{ value: 16, cards: [{rank:'10'},{rank:'6'}], actions: [] }],
        dealer: { value: 20, cards: [{rank:'10'},{rank:'K'}] }
      });
      _lastBJRaw = mockState;
      finishHand('loss', 16, 20);
    }

    // Total bet: 10.00, Total won: 10.00 (5 wins × 2.00)
    // RTP should be 100%
    const rtp = (runningStats.totalWon / runningStats.totalBet) * 100;

    TestSuite.assertEqual(runningStats.totalHands, 10, 'Should have 10 hands');
    TestSuite.assertEqual(runningStats.totalBet, 10.00, 'Total bet should be 10.00');
    TestSuite.assertEqual(runningStats.totalWon, 10.00, 'Total won should be 10.00');
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

  // Expose test suite
  SBJ.runTests = () => TestSuite.runAll();

  // --------------------------- Expose ---------------------------
  Object.defineProperty(window, 'SBJ', { value: SBJ });
  console.log('%c[SBJ] Ready. In console: SBJ.start(), SBJ.stop(), SBJ.playOnce(), SBJ.runTests()', 'color:#0f0');
})();