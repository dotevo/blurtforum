import { Blockchain } from './blockchain';
import type { BFPlayerAPI, MediaTrack } from '../types';

/**
 * Player Plugin that fetches and updates Blurt-specific metadata
 * (payout, votes) when a track is loaded or changed.
 */
export const BlurtPlayerPlugin = (client: any, auth: any) => ({
  name: 'BlurtMetadata',

  install(player: BFPlayerAPI) {
    console.log('BlurtMetadataPlugin installed');
  },

  /**
   * Called automatically by BFPlayer when state.currentTrack changes
   */
  async onTrackChange(track: MediaTrack) {
    if (!track || !track.author || !track.permlink) return;

    try {
      // Fetch fresh content from blockchain
      const raw = await client.condenser.getContent(track.author, track.permlink);
      if (!raw || !raw.author) return;

      const normalized = Blockchain.normalizePost(raw);

      // Update track properties reactively
      track.payout = normalized.payout;
      track.voteCount = normalized.vote_count;
      
      if (auth.user) {
        track.voted = normalized.active_votes.some(v => v.voter === auth.user.username && v.percent > 0);
      }
      
      // If the track was pending metadata resolution (e.g. cover/title)
      if (track.pending) {
        track.title = normalized.title;
        track.cover = normalized.media?.cover || track.cover;
        track.pending = false;
      }
    } catch (e) {
      console.warn('BlurtMetadataPlugin: failed to fetch metadata', e);
    }
  }
});
