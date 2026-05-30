const { test, expect } = require('@playwright/test');
const path = require('path');

const indexUrl = `file://${path.resolve(__dirname, '../index.html')}`;

test.describe('Player History Logic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
  });

  test('should track history and allow playPrev from history', async ({ page }) => {
    // 1. Inject some tracks into the queue and autoQueue for testing
    await page.evaluate(() => {
      const player = window.BFPlayer;
      player.state.autoQueue = [
        { id: 't1', title: 'Track 1', author: 'a1', type: 'audio', src: 's1' },
        { id: 't2', title: 'Track 2', author: 'a2', type: 'audio', src: 's2' },
        { id: 't3', title: 'Track 3', author: 'a3', type: 'audio', src: 's3' }
      ];
    });

    // 2. Play Track 1
    await page.evaluate(() => {
      window.BFPlayer.playTrack(window.BFPlayer.state.autoQueue[0]);
    });

    // 3. Play Track 2 (Track 1 should go to history)
    await page.evaluate(() => {
      window.BFPlayer.playTrack(window.BFPlayer.state.autoQueue[1]);
    });

    // 4. Check history
    const historyLength = await page.evaluate(() => window.BFPlayer.state.history ? window.BFPlayer.state.history.length : 0);
    // This will fail initially because history is not implemented
    expect(historyLength).toBe(1);

    const historyTopTitle = await page.evaluate(() => window.BFPlayer.state.history[0].title);
    expect(historyTopTitle).toBe('Track 1');

    // 5. Play Prev (should play Track 1 from history)
    await page.evaluate(() => {
      window.BFPlayer.playPrev();
    });

    const currentTrackTitle = await page.evaluate(() => window.BFPlayer.state.currentTrack.title);
    expect(currentTrackTitle).toBe('Track 1');
  });
});
