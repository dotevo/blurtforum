import { Parser } from './parser';
import { BFUtils } from './utils';
import type { Post, RawPost, Beneficiary, GlobalProps } from '../types';

export const PostProcessor = {
  /**
   * Normalizes a raw post from the blockchain into a consistent domain model.
   * Extracts media, groups mirrors, and calculates payouts.
   */
  normalizePost(
    p: RawPost | any,
    context?: {
      currentUser?: string | null;
      followingSet?: Set<string>;
      readStatusMap?: Record<string, number>;
      canMute?: boolean;
      globalProps?: GlobalProps | null;
    }
  ): Post {
    let tags: string[] = [];
    try {
      const meta = typeof p.json_metadata === 'string' ? JSON.parse(p.json_metadata || '{}') : p.json_metadata;
      if (meta && (meta as Record<string, unknown>).tags) {
        tags = (meta as Record<string, string[]>).tags;
      }
    } catch { /* ignore */ }

    const pending = BFUtils.parsePayout(p.pending_payout_value);
    const total = BFUtils.parsePayout(p.total_payout_value) + BFUtils.parsePayout((p as any).curator_payout_value);
    const bridgePayout = typeof p.payout === 'number' ? p.payout : BFUtils.parsePayout(p.payout);
    
    const lastActAuthor = p.last_activity_author || p.author;
    const activityTs = new Date((p.last_activity || p.created).endsWith('Z') ? (p.last_activity || p.created) : (p.last_activity || p.created) + 'Z').getTime();
    
    // Read status
    let isRead = false;
    if (context?.readStatusMap) {
      const lastReadTs = context.readStatusMap[`${p.author}/${p.permlink}`] || 0;
      isRead = !!(lastReadTs >= activityTs || (context.currentUser && lastActAuthor === context.currentUser));
    }

    const createdDate = new Date((p.created.endsWith('Z') ? p.created : p.created + 'Z'));
    const ageDays = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    let isPaid = total > 0 || ageDays > 7.5;
    if (p.cashout_time?.startsWith('1970')) isPaid = true;

    const post: Post = {
      author: p.author,
      permlink: p.permlink,
      title: p.title || '(no title)',
      body: p.body,
      created: p.created,
      url: p.url,
      category: p.category,
      parent_author: p.parent_author || '',
      parent_permlink: p.parent_permlink || '',
      lastActivity: p.last_activity || p.created,
      lastAuthor: lastActAuthor,
      pendingPayout: pending,
      totalPayout: total,
      payout: bridgePayout || (pending + total),
      vote_count: p.active_votes ? p.active_votes.length : (p.net_votes || 0),
      active_votes: p.active_votes || [],
      net_rshares: parseFloat(String(p.net_rshares || 0)),
      beneficiaries: (p.beneficiaries || []) as Beneficiary[],
      json_metadata: p.json_metadata,
      media: null,
      tracks: [],
      isUnread: !isRead,
      isRead: isRead,
      isFollowing: !!(context?.currentUser && context?.followingSet?.has(p.author)),
      isMuted: !!(p.stats?.is_muted || p.stats?.hide),
      isPaid,
      isCollapsed: !!(p.body && p.body.startsWith('Supporting original content by @')),
      replyCount: p.children || p.reply_count || 0,
      tags,
      lastActivityTs: activityTs,
    };

    // Extract all media with structural context
    const allMedia = Parser.extractAllMedia(p.body);
    
    // Grouping Strategy
    const tracks: any[] = [];
    const groupMap: Record<string, any> = {};

    allMedia.forEach((m: any) => {
      const groupKey = m.group || 'default';
      
      // Mirror Rule: same group AND type not already present in this track
      if (groupMap[groupKey] && !groupMap[groupKey].sources.some((s: any) => s.type === m.type)) {
        groupMap[groupKey].sources.push({
          type: m.type,
          id: m.id,
          src: m.src,
          host: m.host,
          thumb: m.cover,
          group: m.group,
          typeIndex: m.typeIndex
        });
      } else {
        // Distinct Track: either new group or duplicate type in same group
        const typeIndex = m.typeIndex || 1;
        const subId = m.group ? (Number(typeIndex) > 1 ? `${m.group}:${typeIndex}` : m.group) : `idx:${m.type}:${typeIndex}`;
        
        const newTrack = {
          author: post.author,
          permlink: post.permlink,
          subId: subId,
          title: post.title,
          sources: [{
            type: m.type,
            id: m.id,
            src: m.src,
            host: m.host,
            thumb: m.cover,
            group: m.group,
            typeIndex: Number(typeIndex)
          }],
          activeSourceIndex: -1,
          pending: m.pending,
          cover: m.cover
        };
        tracks.push(newTrack);
        
        // Update groupMap so next item in same header can try to mirror this track
        groupMap[groupKey] = newTrack;
      }
    });

    post.tracks = tracks;
    post.media = tracks[0] || null;

    // Cover fallback
    if (post.media && !post.media.cover && p.json_metadata) {
      try {
        const meta = typeof p.json_metadata === 'string' ? JSON.parse(p.json_metadata) : p.json_metadata;
        if (meta.image && Array.isArray(meta.image) && meta.image.length > 0) {
          post.media.cover = meta.image[0];
        }
      } catch { /* ignore */ }
    }
    
    return post;
  }
};
