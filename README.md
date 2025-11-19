# Stake Blackjack Bot

An automated blackjack bot for Stake.us that plays using optimal basic strategy with comprehensive testing and performance optimizations.

## Features

### 🎯 Perfect Basic Strategy
- Implements mathematically optimal blackjack basic strategy
- Handles hard hands, soft hands, splits, and doubles correctly
- Safety guards prevent catastrophic mistakes

### ⚡ High-Speed Gameplay
- 2-3x faster than manual play
- Optimized wait times and state detection
- Clicks buttons as soon as they become available

### 📊 Advanced Tracking
- Real-time hand history with last 20 hands
- Running statistics: wins, losses, pushes
- Money-based RTP calculation (total won / total bet)
- Accurate bet tracking including splits and doubles

### 🎮 User Controls
- **Start/Stop** - Control bot execution
- **Play Once** - Test single hands
- **Hand Limit** - Set target number of hands (0 = unlimited)
- **History Window** - Draggable window showing detailed hand logs
- **Run Tests** - Execute 31+ comprehensive tests to verify logic

### 🧪 Test-Driven Development
- 31 comprehensive unit tests covering all scenarios
- Tests for splits, doubles, basic strategy, and edge cases
- Standalone test runner for verification

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new userscript
3. Copy the contents of `Stake Blackjack bot.js`
4. Save and enable the script
5. Navigate to https://stake.us/casino/games/blackjack

## Usage

### Basic Operation
1. The control panel appears in the bottom-right corner
2. Set optional hand limit in the "Hands:" input (0 = unlimited)
3. Click **Start** to begin automated play
4. Click **Stop** to pause
5. Click **History** to view detailed hand logs

### Testing
Run the test suite to verify the bot logic:
- Click **Run Tests** button in the UI
- Or run in console: `SBJ.runTests()`
- Or execute standalone: `node test-standalone.js`

## Test Coverage

The bot includes 31+ tests covering:

### Basic Scenarios
- Wins, losses, pushes
- Bet tracking accuracy
- RTP calculation

### Doubling
- Double down wins, losses, pushes
- Bet doubling verification
- Multiple doubles in splits

### Splitting
- Both hands win/lose
- Mixed outcomes (one win, one loss)
- One win, one push
- Doubles after splits
- Multiple splits with doubles

### Basic Strategy
- Hard 17+ always stands
- Hard 12-16 stand vs 2-6, hit vs 7-A
- Soft 19+ always stands
- Soft 18 stands vs 2-8, hits vs 9-A
- Safety guards prevent bad plays

### Edge Cases
- Multi-card hands
- Soft hands becoming hard
- Dealer bust scenarios
- Blackjack payouts (3:2)

## Technical Details

### Files
- `Stake Blackjack bot.js` - Main userscript
- `test-standalone.js` - Standalone Node.js test suite
- `README.md` - This file

### Key Functions
- `decideFromMatrix()` - Determines optimal play from basic strategy matrix
- `computeSoftFromRanks()` - Calculates soft/hard hand status
- `finishHand()` - Tracks results and calculates payouts
- `readServer()` - Interprets game state from API responses

### Network Monitoring
The bot intercepts API responses to:
- Capture real-time game state
- Detect card changes
- Calculate accurate bet amounts
- Track hand progression

## Known Issues & Limitations

- Only works on Stake.us blackjack
- Requires active browser window
- Does not implement card counting
- Does not adjust bet sizes (uses current bet)

## Performance

### Speed Improvements
- Network wait: 2500ms → 1000ms
- Progress wait: 1500ms → 800ms
- Game loop: 80ms → 30ms
- Between hands: ~1.5s → ~120ms

### Accuracy
- All 31 tests passing
- Verified split calculations
- Verified double calculations
- Verified basic strategy decisions

## Development

### Running Tests
```bash
# Standalone tests
node test-standalone.js

# Browser console
SBJ.runTests()
```

### Adding Tests
Add new tests to `test-standalone.js`:
```javascript
TestSuite.test('Test Name', () => {
  // Test code here
  TestSuite.assertEqual(actual, expected, 'description');
});
```

## Bugs Fixed (v2.0)

1. **Split Calculation** - Now correctly evaluates each hand separately
2. **Soft 18 Strategy** - Now hits vs dealer 9/10/A as per optimal strategy
3. **Safety Guard** - Changed soft guard from ≥18 to ≥19

## License

MIT License - Use at your own risk

## Disclaimer

This bot is for educational purposes. Automated play may violate Stake.us terms of service. Use responsibly.

---

**Version:** 2.0
**Last Updated:** November 2025
**Tests:** 31 passing ✅
