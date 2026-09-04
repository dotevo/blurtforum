/**
 * module/player — generic media player types.
 * No knowledge of Blurt, blockchain, posts, or forums lives here.
 * Anything app-specific (payout, votes, author/permlink as required fields)
 * belongs in a plugin's own metadata, attached via MediaTrack.meta / MediaTrack.badge.
 */

import type { Component } from 'vue';
import type { WebtorrentStats, SeedManifestEntry } from './webtorrent-pool';

export interface MediaEntryMirror {
  type: 'audio' | 'youtube' | 'peertube' | 'webtorrent' | 'suno';
  /** For type 'webtorrent', this holds the full magnet URI (must include xt=urn:btih:). */
  id: string;
  src?: string;
  host?: string;
  thumb?: string;
  group?: string;
  typeIndex?: number;
}

export interface MediaTrack {
  /** Identity fields used to match/dedupe tracks. Generic in shape (just strings), but the player core treats them as opaque identity — it has no notion of "author" or "post" beyond equality checks. */
  author: string;
  permlink: string;
  subId?: string;
  title: string;
  sources: MediaEntryMirror[];
  activeSourceIndex: number;
  cover?: string;
  pending?: boolean;
  _errorHandled?: boolean;
  /** App-specific data a plugin needs to carry alongside the track (e.g. { payout, voteCount, voted }). Opaque to the player core; the UI never reads it directly — plugins render their own UI via the track-actions slot. */
  meta?: Record<string, unknown>;
}

export type PlayMode = 'sequential' | 'shuffle' | 'repeat-all' | 'repeat-one';

export interface PlayerState {
  enabled: boolean;
  active: boolean;
  playing: boolean;
  loading: boolean;
  minimized: boolean;
  expanded: boolean;
  expandedHeight: number;
  /** Width in px of the tabs sidebar within the expanded panel (video takes the rest). User-draggable, session-only like expandedHeight. */
  tabsWidth: number;
  /** Built-in ids are 'video' | 'queue' | 'playlists' | 'settings'; a plugin
   *  registering a tab via registerExpandedTab() can set this to its own id. */
  expandedTab: string;
  /** Fullscreen presentation of the same expanded panel/video — no separate
   *  player instance, purely a display-mode flag the UI reacts to. Not
   *  persisted: like `expanded`/`minimized`, it's session-only. */
  cinema: boolean;
  /** Player is fully hidden (no docked bar, no panel) — used by cinema mode's
   *  browse screen so nothing shows until a track actually starts playing.
   *  Distinct from `active` (which just means the player feature is enabled
   *  for the session, not "something is playing"). Same family as
   *  expanded/minimized/cinema: a display-mode flag, not persisted. A future
   *  picture-in-picture mode would be another flag alongside this one. */
  hidden: boolean;
  /** Which browse view CinemaIndex (the cinema-mode grid screen) should
   *  show: category rows, or the user's playlists as rows instead. Lives
   *  here (not local to CinemaIndex) so the left rail's Playlists entry can
   *  switch it without needing any direct reference to the CinemaIndex
   *  component instance. */
  cinemaBrowseView: 'categories' | 'playlists';
  /** Whether cinema mode's floating chrome (top bar, side icons, bottom bar,
   *  and anything a source component teleports in via showCinemaControls())
   *  is currently visible. Single shared flag so every contributor uses the
   *  same auto-hide timer instead of each running its own -- see
   *  showCinemaControls() in player.ts. */
  cinemaControlsVisible: boolean;
  currentTrack: MediaTrack | null;
  queue: MediaTrack[];
  autoQueue: MediaTrack[];
  history: MediaTrack[];
  progress: number;
  duration: number;
  volume: number;
  experimental: boolean;
  isAutoStarting: boolean;
  playMode: PlayMode;
  /** When true, manual skip (playNext called without isAuto) is ignored. Plugins toggle this via lockSkip/unlockSkip. */
  skipLocked: boolean;
  /** Global WebTorrent upload switch (see webtorrent-pool.ts). Mirrors localStorage so it survives reloads. */
  seedingEnabled: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  tracks: (MediaTrack & { addedAt?: number })[];
}

export interface PlaylistState {
  playlists: Playlist[];
}

export type PlayerEvent =
  | 'trackChange' | 'play' | 'pause' | 'next' | 'prev'
  | 'ended' | 'volumeChange' | 'error';

export interface PlayerPlugin {
  name: string;
  install?: (player: BFPlayerAPI) => void;
  onTrackChange?: (track: MediaTrack) => void;
}

/** Where a track-action UI contribution is allowed to render. */
export type TrackActionZone = 'mini' | 'expanded' | 'cinema' | 'both';

/**
 * A single plugin's contribution to the player's track-actions area.
 * `component` is any Vue component; it receives `track`, `player`, plus
 * whatever static `props` were registered alongside it, plus any listeners
 * passed down to the host slot (e.g. openTopic/submitVote) via fallthrough.
 * The player core never inspects what these components render — it only
 * decides *whether* to mount them, based on `zone`.
 */
export interface TrackActionContribution {
  id: string;
  zone: TrackActionZone;
  component: any;
  /** Extra static props merged in alongside `track`/`player` (e.g. a plugin's own `client`). */
  props?: Record<string, unknown>;
}

/**
 * A single plugin's contribution to the expanded panel's tab bar (alongside
 * the built-in video/queue/playlists/settings tabs). `component` receives
 * `track` (the current MediaTrack, may be null) and `player`, plus whatever
 * static `props` were registered. The player core has no idea what a given
 * tab renders — e.g. a Blurt plugin contributing a "Comments" tab that reads
 * `track.author`/`track.permlink` to fetch replies is entirely its own
 * business; the core only knows there's an id/label/icon and a component to
 * mount when that tab is selected.
 */
export interface PlayerTabContribution {
  id: string;
  label: string;
  icon: string;
  component: any;
  props?: Record<string, unknown>;
  /** Re-evaluated by MediaPlayer.vue on every render, same idiom as RailItemContribution.visible below -- lets a contribution hide itself reactively (e.g. the TV-only device-profiles "showComments" toggle hiding the Comments tab) without the generic tab host needing to know why. Defaults to always-visible when omitted. */
  visible?: () => boolean;
}

/**
 * A contribution to cinema mode's left-side rail (see CinemaRail.vue) --
 * distinct from PlayerTabContribution above, which contributes into the
 * player's own expanded-panel tab bar. Rail items live in the app-level
 * left nav instead, alongside Home/theme/profile. `onClick` decides what
 * happens (typically: open the player's own matching tab, e.g. Playlists),
 * so the rail doesn't need to know anything about what it's showing.
 * `visible`/`badge` are re-evaluated reactively by CinemaRail on every
 * render, so e.g. a "Playlists" entry can appear only once the user
 * actually has one, without needing to register/unregister dynamically.
 */
export interface RailItemContribution {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  visible?: () => boolean;
  badge?: () => number | string | null;
}

/**
 * A single source's contribution of a simple, stateless button to the
 * player's own cinema-mode chrome — e.g. WebTorrent's "torrent info" /
 * "download whole torrent" buttons. Deliberately narrow: just an icon,
 * label, click handler, and optional live active/badge state. Anything
 * richer (a dropdown, a custom progress bar) is a PlayerWidgetContribution
 * instead (see below).
 *
 * The contributing source only declares *which* source type(s) it applies
 * to (`sourceTypes`) — never anything about display mode. `getPlayerButtons()`
 * does the filtering against both the zone asked for AND whatever's actually
 * playing right now, so a source never has to check `state.cinema` (or any
 * other display-mode flag) itself, and never has to know where in the DOM
 * its button ends up or how it's styled — that's entirely the player's call.
 */
export interface PlayerButtonContribution {
  id: string;
  /** Which MediaEntryMirror['type'] value(s) this button applies to, or 'all' sources. */
  sourceTypes: MediaEntryMirror['type'][] | 'all';
  /** Where this is allowed to render. Currently the only option: joins the left-hand transport cluster (play/pause/prev/next/volume) in cinema mode's bottom bar -- kept there, not on the right, so it stays reachable via D-pad navigation without crossing the row, and stays clear of the track-actions slot / slide-out panel toggles. The docked/expanded views are source-specific enough (see WebtorrentVideo.vue) that they render their own controls directly instead. */
  zone: 'cinema';
  icon: string;
  label: string;
  onClick: () => void;
  /** Re-evaluated by the player on every render (e.g. "full download in progress" highlight). */
  active?: () => boolean;
  /** Re-evaluated by the player on every render (e.g. a live download percentage). Return null/'' to hide the badge for now. */
  badge?: () => string | null;
}

/**
 * A single source's contribution of a whole Vue component into the player's
 * own cinema-mode chrome — for anything a plain icon/button can't express
 * (e.g. WebTorrent's piece-map bar, or its subtitle/audio-track picker).
 *
 * Unlike the old Teleport-based approach this replaces, the player mounts
 * `component` directly in its own template, at the given `zone` — it is
 * never physically moved from one DOM location to another. That matters
 * for two reasons: (1) the contributing source never needs to know
 * anything about cinema mode, any DOM id, or how to move itself there —
 * it just describes what it wants shown and where; (2) the widget's own
 * internal positioning (e.g. `position: fixed`) is never at the mercy of
 * some unrelated ancestor element's `transform`/`filter`/`backdrop-filter`
 * establishing a new containing block underneath it, which is exactly what
 * broke the subtitle/audio dropdown under the old Teleport target (see
 * WebtorrentAudioSubtitleMenu.vue's own comment for the full story).
 *
 * `props` is a function, re-invoked by the player on every render, so the
 * contribution can hand the mounted component fresh reactive values instead
 * of a snapshot frozen at registration time.
 */
export interface PlayerWidgetContribution {
  id: string;
  /** Which MediaEntryMirror['type'] value(s) this widget applies to, or 'all' sources. */
  sourceTypes: MediaEntryMirror['type'][] | 'all';
  /** 'cinema-left' joins the left-hand transport cluster (play/pause/prev/next/volume) -- kept there rather than on the right so it stays reachable via D-pad navigation without crossing the row, and stays clear of the track-actions slot / slide-out panel toggles that live on the right. 'cinema-progress' is the full-width strip just above the main seek bar. */
  zone: 'cinema-left' | 'cinema-progress';
  component: Component;
  props?: () => Record<string, unknown>;
}

/**
 * A single plugin's contribution to a webtorrent peer-list row. `component`
 * receives `peerId`, `infoHash`, `addr`, `t`, plus whatever static `props`
 * were registered alongside it. The player core has no idea what any given
 * contribution renders (or whether it renders anything at all for a given
 * peer) — e.g. a Blurt-identity badge that only shows up for peers whose
 * wire extension handshake it recognizes, and renders nothing for anyone
 * else. Unlike track actions there's no `zone`: peer rows only exist in one
 * place (the webtorrent peer list), so every registered contribution is
 * simply mounted once per row.
 */
export interface PeerActionContribution {
  id: string;
  component: any;
  props?: Record<string, unknown>;
}

/**
 * Namespaced, protocol-specific surface for webtorrent-only capabilities —
 * requested explicitly so plugin code reads as `player.webtorrent.foo(...)`
 * rather than flat `player.foo(...)`, matching how the player also supports
 * other protocols (YouTube, PeerTube, plain audio) that have nothing to do
 * with any of this. The methods below are the SAME functions as their flat
 * BFPlayerAPI counterparts (kept for now, unremoved, to avoid breaking
 * anything already calling them the old way) — this is purely an additional,
 * clearer entry point, not a different implementation.
 */
export interface WebtorrentAPI {
  /** Turns global upload on/off (e.g. a mobile "don't seed" switch). Mirrored in state.seedingEnabled. */
  setSeedingEnabled: (enabled: boolean) => void;
  /** Max bytes the persistent seed cache is allowed to use; oldest-active torrents are evicted first once exceeded. */
  setMaxSeedStorageBytes: (bytes: number) => void;
  getMaxSeedStorageBytes: () => number;
  /** Lifetime upload/download totals, per torrent and overall — survive reloads and individual torrents being evicted. */
  getWebtorrentStats: () => WebtorrentStats;
  /** Everything currently persisted (on disk), for a "what am I seeding" settings view. */
  getWebtorrentManifest: () => SeedManifestEntry[];
  getWebtorrentStorageEstimate: () => Promise<{ usage: number; quota: number } | null>;
  /** Deletes all locally seeded data — a "clear my seed data" privacy control. */
  clearWebtorrentData: () => Promise<void>;
  /** Manually (re)attach playback to a specific file index in the currently-loaded torrent — lets the UI offer a per-file "Play" action instead of only the automatic best-file pick. */
  playWebtorrentFile: (fileIndex: number) => void;

  /**
   * Registers a bittorrent-protocol (BEP-10) extension factory — exactly
   * what you'd pass to `wire.use(factory)` yourself. Applied to every wire
   * on every torrent, current (retroactively) and future. The player has no
   * opinion on what the extension does — e.g. a plugin implementing its own
   * peer-identity handshake protocol.
   */
  registerWireExtension: (factory: (wire: any) => any) => void;
  /** Registers a plugin's own Vue component into every webtorrent peer-list row (see PeerActionContribution). Idempotent by id. */
  registerPeerAction: (contribution: PeerActionContribution) => void;
  /** Contributions currently registered. Used by the generic peer-list renderer in WebtorrentInfoModal.vue. */
  getPeerActions: () => PeerActionContribution[];
}

export interface BFPlayerAPI {
  state: PlayerState;
  playlistState: PlaylistState;
  playTrack: (track: MediaTrack, isManual?: boolean, manualIdx?: number, fromHistory?: boolean) => Promise<void>;
  playNext: (isAuto?: boolean) => void;
  playPrev: () => void;
  togglePlay: () => void;
  seek: (pct: number) => void;
  /** Adds a track to the manual queue. position 'start' inserts at the front (e.g. to inject sponsored content before the next auto-pick), default 'end'. */
  addToQueue: (track: MediaTrack, position?: 'start' | 'end') => void;
  scanView: (container?: Element | null) => void;
  registerTrack: (incoming: any) => void;
  unregisterTrack: (trackId: string, type: string, idHint?: string, subId?: string) => void;
  setClient: (client: any) => void;
  clearTracks: () => void;
  setAutoQueue: (tracks: MediaTrack[]) => void;
  initResize: (e: MouseEvent | TouchEvent) => void;
  /** Drag handle between the video and the tabs sidebar in the expanded panel. */
  initTabsResize: (e: MouseEvent | TouchEvent) => void;
  scrollToCurrent: () => void;
  toggleExperimental: (val: boolean) => void;
  togglePlayMode: () => void;
  on: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  off: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  registerPlugin: (plugin: PlayerPlugin) => void;
  /** Registers a plugin's own Vue component into the track-actions area (see TrackActionContribution). Idempotent by id. */
  registerTrackAction: (contribution: TrackActionContribution) => void;
  /** Contributions currently registered for a given zone (includes 'both'-zone ones). Used by the generic TrackActions.vue host. */
  getTrackActions: (zone: Exclude<TrackActionZone, 'both'>) => TrackActionContribution[];
  /** Registers a plugin's own tab (+ component) into the expanded panel's tab bar. Idempotent by id. */
  registerExpandedTab: (contribution: PlayerTabContribution) => void;
  /** Tabs currently registered, in registration order. Used by MediaPlayer.vue to render extra tab buttons/bodies generically. */
  getExpandedTabs: () => PlayerTabContribution[];
  /** Registers a contribution into cinema mode's left rail (see RailItemContribution). Idempotent by id. */
  registerRailItem: (contribution: RailItemContribution) => void;
  /** Rail items currently registered, in registration order. Used by CinemaRail.vue. */
  getRailItems: () => RailItemContribution[];
  /** Registers a source's own simple button into cinema mode's bottom bar (see PlayerButtonContribution). Idempotent by id. */
  registerPlayerButton: (contribution: PlayerButtonContribution) => void;
  /** Removes a previously-registered button — sources that come and go with a component's lifecycle (e.g. a video-source component) should pair this with their own onUnmounted. */
  unregisterPlayerButton: (id: string) => void;
  /** Button contributions currently registered for `zone`, filtered to whatever source type is actually playing right now. Used by MediaPlayer.vue's cinema chrome. */
  getPlayerButtons: (zone: PlayerButtonContribution['zone']) => PlayerButtonContribution[];
  /** Registers a source's own Vue component into cinema mode's chrome (see PlayerWidgetContribution). Idempotent by id. */
  registerPlayerWidget: (contribution: PlayerWidgetContribution) => void;
  /** Removes a previously-registered widget — pair with onUnmounted, same as unregisterPlayerButton. */
  unregisterPlayerWidget: (id: string) => void;
  /** Widget contributions currently registered for `zone`, filtered to whatever source type is actually playing right now. Used by MediaPlayer.vue's cinema chrome. */
  getPlayerWidgets: (zone: PlayerWidgetContribution['zone']) => PlayerWidgetContribution[];
  /** Call on any user activity (mousemove/click/keydown/touch) while cinema
   *  mode is active -- shows the floating chrome and resets the auto-hide
   *  timer. Any source contributing its own cinema controls (via
   *  registerPlayerButton/registerPlayerWidget above) should call this
   *  instead of running its own timer, so everything hides/shows together. */
  showCinemaControls: () => void;
  /** Temporarily blocks manual skip (e.g. while a sponsored track must play). Plugins are responsible for calling unlockSkip(). */
  lockSkip: () => void;
  unlockSkip: () => void;
  createPlaylist: (name: string, color?: string) => Playlist | null;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, newName: string) => void;
  addTrackToPlaylist: (playlistId: string, track: MediaTrack) => boolean;
//  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, author: string, permlink: string, subId?: string) => void;
  playPlaylist: (playlistId: string, startIndex?: number) => void;

  // ─── WebTorrent (see webtorrent-pool.ts for the actual implementation) ───
  /** Turns global upload on/off (e.g. a mobile "don't seed" switch). Mirrored in state.seedingEnabled. */
  setSeedingEnabled: (enabled: boolean) => void;
  /** Max bytes the persistent seed cache is allowed to use; oldest-active torrents are evicted first once exceeded. */
  setMaxSeedStorageBytes: (bytes: number) => void;
  getMaxSeedStorageBytes: () => number;
  /** Lifetime upload/download totals, per torrent and overall — survive reloads and individual torrents being evicted. */
  getWebtorrentStats: () => WebtorrentStats;
  /** Everything currently persisted (on disk), for a "what am I seeding" settings view. */
  getWebtorrentManifest: () => SeedManifestEntry[];
  getWebtorrentStorageEstimate: () => Promise<{ usage: number; quota: number } | null>;
  /** Deletes all locally seeded data — a "clear my seed data" privacy control. */
  clearWebtorrentData: () => Promise<void>;
  /** Manually (re)attach playback to a specific file index in the currently-loaded torrent — lets the UI offer a per-file "Play" action instead of only the automatic best-file pick. */
  playWebtorrentFile: (fileIndex: number) => void;

  /** Same webtorrent-only capabilities as the flat methods above (kept for now), namespaced — see WebtorrentAPI. Prefer this for new code. */
  webtorrent: WebtorrentAPI;
}