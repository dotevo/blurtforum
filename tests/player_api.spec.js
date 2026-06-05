const { test, expect } = require('@playwright/test');
const path = require('path');

const indexUrl = `file://${path.resolve(__dirname, '../index.html')}`;

test.describe('Player Plugin and Event System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
  });

  test('should emit trackChange event', async ({ page }) => {
    const emitted = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let receivedTrack = null;
        window.BFPlayer.on('trackChange', (track) => {
          receivedTrack = track;
          resolve(receivedTrack);
        });
        window.BFPlayer.playTrack({ id: 'test-event', title: 'Test', author: 'test', type: 'audio', src: 'test.mp3' });
      });
    });

    expect(emitted.id).toBe('test-event');
  });

  test('should register and install a plugin', async ({ page }) => {
    const pluginInstalled = await page.evaluate(() => {
      let installed = false;
      const myPlugin = {
        name: 'test-plugin',
        install(player) {
          installed = true;
        }
      };
      window.BFPlayer.registerPlugin(myPlugin);
      return installed;
    });

    expect(pluginInstalled).toBe(true);
  });

  test('should auto-subscribe to trackChange if plugin has onTrackChange method', async ({ page }) => {
    const trackFromPlugin = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const myPlugin = {
          name: 'track-observer',
          onTrackChange(track) {
            resolve(track);
          }
        };
        window.BFPlayer.registerPlugin(myPlugin);
        window.BFPlayer.playTrack({ id: 'test-auto', title: 'Auto', author: 'test', type: 'audio', src: 'test.mp3' });
      });
    });

    expect(trackFromPlugin.id).toBe('test-auto');
  });
});
