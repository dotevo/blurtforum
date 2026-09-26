import { reactive } from 'vue';
import type { AuthUser } from '../../types';
import type { CertificateBroadcast, ChatBroadcast, ChatMessage, HistoryRequest, HistoryResponse, PresenceUpdate, ShoutboxScope, WireMessage } from './types';
import type { SignalingTransport, TransportStatus } from './transport/types';
import { PeerJsTransport } from './transport/peerjs-transport';
import { ShoutboxStore } from './store';
import { signChatBody, verifyChatBody } from './identity';
import { getOrCreateSession, importSessionPublicKey, verifyCertificate } from './session';
import { expandEmojiShortcodes } from './emoji';

/**
 * modules/shoutbox/shoutbox.ts
 *
 * Orchestrates transport + session + identity + store into one reactive
 * singleton the UI (components/ShoutboxWidget.vue) can consume directly.
 *
 * SENDING REQUIRES BEING LOGGED IN, FULL STOP. There is no "unverified,
 * sent while logged out" message state anymore — every ChatMessage that
 * gets broadcast always carries a valid session-key signature backed by a
 * real certificate (see session.ts). send() refuses outright if
 * deps.auth.user is null; the UI additionally disables the input for the
 * same reason (see ShoutboxWidget.vue) so this is enforced in two places,
 * not just trusted at the network boundary.
 *
 * Presence deliberately does NOT depend on the transport exposing a raw
 * connection count (see peerjs-transport.ts's header comment on why a
 * client can't see sibling clients directly in a star topology). Instead,
 * every peer broadcasts its own heartbeat (username + which scope they're
 * currently looking at), relayed exactly like a chat message, and each
 * peer maintains its own local "who's still around" map with a
 * stale-after timeout. Presence heartbeats are NOT signature-verified —
 * see the trade-off explained where PresenceUpdate is handled below.
 */

const LOG = '[Shoutbox]';
function warn(...args: unknown[]): void { console.warn(LOG, ...args); }

const HEARTBEAT_MS = 8_000;
const PRESENCE_STALE_MS = 20_000; // > 2x heartbeat interval
const HISTORY_RESPONSE_LIMIT = 50; // per scope, per response
// How often we re-ask the room for anything we might be missing, on top of
// the one-shot request onConnected() already sends. See "History sync is
// self-healing" below for why this exists at all.
const HISTORY_RESYNC_MS = 45_000;
// Each resync re-asks slightly further back than our own latest known
// message, not exactly from it — catches stragglers that legitimately
// have an older timestamp than something we already have (arrived out of
// order, or were dropped earlier because their certificate wasn't known
// yet at the time, see ingestChatMessage). Harmless overlap: anything we
// already have is skipped by ingestChatMessage's id check before it even
// re-verifies a signature.
const HISTORY_RESYNC_OVERLAP_MS = 2 * 60_000;

function makeNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ShoutboxDeps {
  auth: { user: AuthUser | null };
  /** Returns whatever dblurt.Client instance is currently active — same
   * shape as useRpc()'s dataClient.value, passed in rather than imported
   * so this module never has to know how RPC node selection works. */
  getClient: () => unknown;
  /** Same checkLock convention used throughout the app (useApp.ts /
   * usePostForm.ts / useImageUpload.ts): shows the PIN modal and
   * re-queues the given function if the local key is locked, returns
   * false immediately if there's nothing to unlock (already unlocked, or
   * a WhaleVault account). send() wraps itself in this exactly like
   * submitPost()/uploadImageFile() do. */
  checkLock: (fn: () => any) => boolean;
}

interface PeerInfo {
  peerId: string;
  username: string | null;
  scope: ShoutboxScope;
  lastSeen: number;
  viewingPost: { author: string; permlink: string; title?: string } | null;
}

class ShoutboxCore {
  private transport: SignalingTransport;
  private deps: ShoutboxDeps | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private historyResyncTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Array<() => void> = [];

  readonly status = reactive<{ value: TransportStatus }>({ value: 'disconnected' });
  readonly messages = reactive<Record<string, ChatMessage[]>>({});
  readonly peers = reactive<Map<string, PeerInfo>>(new Map());
  readonly currentScope = reactive<{ value: ShoutboxScope }>({ value: 'global' });
  readonly sending = reactive<{ value: boolean }>({ value: false });
  private viewingPost: { author: string; permlink: string; title?: string } | null = null;

  constructor(transport: SignalingTransport = new PeerJsTransport()) {
    this.transport = transport;
  }

  init(deps: ShoutboxDeps): void {
    this.deps = deps;
  }

  async start(initialScope: ShoutboxScope = 'global'): Promise<void> {
    this.currentScope.value = initialScope;
    this.hydrateFromStore('global');
    this.hydrateFromStore(initialScope);

    this.unsubs.push(
      this.transport.onStatusChange((s) => {
        this.status.value = s;
        if (s === 'connected') this.onConnected();
      })
    );
    this.unsubs.push(this.transport.onMessage((msg, fromPeerId) => { void this.handleWireMessage(msg, fromPeerId); }));

    await this.transport.connect();
    this.startHeartbeat();
    this.startHistoryResync();
  }

  stop(): void {
    this.stopHeartbeat();
    this.stopHistoryResync();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.transport.disconnect();
    this.peers.clear();
  }

  setScope(scope: ShoutboxScope): void {
    if (this.currentScope.value === scope) return;
    this.currentScope.value = scope;
    this.hydrateFromStore(scope);
    this.broadcastPresence();
    this.requestHistory([scope]);
  }

  messagesFor(scope: ShoutboxScope): ChatMessage[] {
    return this.messages[scope] ?? [];
  }

  onlineCount(scope?: ShoutboxScope): number {
    this.pruneStalePeers();
    const all = Array.from(this.peers.values());
    const filtered = scope ? all.filter((p) => p.scope === scope) : all;
    return this.dedupeByIdentity(filtered).length;
  }

  onlineUsernames(scope?: ShoutboxScope): string[] {
    this.pruneStalePeers();
    const all = Array.from(this.peers.values());
    const filtered = scope ? all.filter((p) => p.scope === scope) : all;
    return Array.from(new Set(filtered.map((p) => p.username).filter((u): u is string => !!u)));
  }

  /** Same logged-in account often shows up as several `peers` entries at
   * once — a second browser tab, or a reconnect after a dropped
   * connection (each gets its own fresh peerId) — since presence is
   * tracked per-connection, not per-account. This collapses those down
   * to a single entry (keeping whichever is most recently seen), so "N
   * online" and the online list both reflect actual people rather than
   * connections.
   *
   * Anonymous peers (no signed-in username) are deliberately left
   * un-merged: two anonymous connections might be the same visitor with
   * two tabs, or might be two different anonymous visitors — unlike a
   * logged-in username, there's no signal here we can trust either way,
   * so merging them would just be trading one inaccuracy for another
   * (silently hiding real distinct visitors). */
  private dedupeByIdentity(peers: PeerInfo[]): PeerInfo[] {
    const byUsername = new Map<string, PeerInfo>();
    const anonymous: PeerInfo[] = [];
    for (const p of peers) {
      if (!p.username) { anonymous.push(p); continue; }
      const existing = byUsername.get(p.username);
      if (!existing || p.lastSeen > existing.lastSeen) byUsername.set(p.username, p);
    }
    return [...byUsername.values(), ...anonymous];
  }

  /** Everyone currently online, across every scope — not filtered by
   * whichever tab is active. Used by the "who's online" tab, which is
   * deliberately a single unified list rather than per-scope, since
   * "who's around at all right now" is usually the more useful question
   * on a forum this size. */
  allPeers(): PeerInfo[] {
    this.pruneStalePeers();
    const deduped = this.dedupeByIdentity(Array.from(this.peers.values()));
    return deduped.sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''));
  }

  /** Tell the room what post/topic is currently open, if any — included
   * in the next presence heartbeat (and sent immediately, rather than
   * waiting up to HEARTBEAT_MS, so switching topics updates the "who's
   * online" list promptly). Pass null when nothing specific is open. */
  setViewingPost(post: { author: string; permlink: string; title?: string } | null): void {
    this.viewingPost = post;
    this.broadcastPresence();
  }

  /** Refuses outright (returns false) if not logged in — see this class's
   * header comment. Otherwise wraps itself in checkLock() exactly like
   * every other signing action in the app (submitPost, uploadImageFile,
   * …): if a local key is PIN-locked, this shows the PIN modal and
   * re-invokes send() automatically once unlocked, rather than failing. */
  async send(body: string): Promise<boolean> {
    const trimmed = expandEmojiShortcodes(body).trim();
    if (!trimmed || !this.deps) return false;

    const user = this.deps.auth.user;
    if (!user) { warn('cannot send — not logged in'); return false; }

    if (this.deps.checkLock(() => { void this.send(body); })) return false; // PIN modal now showing, will retry after unlock

    this.sending.value = true;
    try {
      const session = await getOrCreateSession(this.deps.auth);
      if (!session) {
        warn('cannot send — could not establish a signed session (certificate signing declined or unavailable)');
        return false;
      }

      const scope = this.currentScope.value;
      const author = user.username;
      const nonce = makeNonce();
      const { ts, sig } = await signChatBody(session.privateKey, scope, author, trimmed, nonce);
      const message: ChatMessage = { id: nonce, scope, author, body: trimmed, ts, sig, certId: session.cert.id };

      ShoutboxStore.addCertificate(session.cert); // so OUR OWN history sync answers can serve it too
      this.applyMessage(scope, message); // optimistic local echo, deduped by id if the relay bounces it back

      // Certificate travels alongside every message (not just once) —
      // simplest way to guarantee any currently-connected peer can verify
      // immediately, at the cost of a little redundant traffic (~150
      // bytes) per message. See README for the leaner alternative if this
      // ever needs optimizing.
      this.transport.broadcast({ kind: 'certificate', cert: session.cert } as CertificateBroadcast);
      this.transport.broadcast({ kind: 'chat', message } as ChatBroadcast);
      return true;
    } finally {
      this.sending.value = false;
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private onConnected(): void {
    this.broadcastPresence();
    this.requestHistory(['global', this.currentScope.value]);
  }

  /** History sync is self-healing, not one-shot: onConnected() above asks
   *  once right after connecting, but in a star topology relayed through a
   *  single broker-elected host (see transport/peerjs-transport.ts), any
   *  individual connection can flake or a message can arrive while we're
   *  mid-reconnect and get missed. Rather than trying to detect and retry
   *  each such failure individually, we just re-ask periodically — cheap
   *  (broadcast() is a no-op with 0 known peers, and a "nothing new"
   *  answer costs nobody anything, see the history_request handler below)
   *  and self-correcting regardless of *why* something was missed. */
  private startHistoryResync(): void {
    this.stopHistoryResync();
    this.historyResyncTimer = setInterval(() => {
      this.requestHistory(['global', this.currentScope.value], HISTORY_RESYNC_OVERLAP_MS);
    }, HISTORY_RESYNC_MS);
  }

  private stopHistoryResync(): void {
    if (this.historyResyncTimer !== null) { clearInterval(this.historyResyncTimer); this.historyResyncTimer = null; }
  }

  private requestHistory(scopes: ShoutboxScope[], overlapMs = 0): void {
    const since = Math.min(...scopes.map((s) => ShoutboxStore.latestTimestamp(s)));
    const floor = Number.isFinite(since) ? Math.max(0, since - overlapMs) : 0;
    const req: HistoryRequest = { kind: 'history_request', scopes, since: floor };
    this.transport.broadcast(req);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.broadcastPresence();
      this.pruneStalePeers();
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private broadcastPresence(): void {
    if (!this.transport.peerId) return;
    const upd: PresenceUpdate = {
      kind: 'presence',
      peerId: this.transport.peerId,
      username: this.deps?.auth.user?.username ?? null,
      scope: this.currentScope.value,
      ts: Date.now(),
      viewingPost: this.viewingPost,
    };
    // Upsert ourselves directly rather than relying on the transport
    // looping our own broadcast back — "N online" should always include
    // "me", the same way it would for anyone else watching.
    this.peers.set(upd.peerId, { peerId: upd.peerId, username: upd.username, scope: upd.scope, lastSeen: upd.ts, viewingPost: upd.viewingPost });
    this.transport.broadcast(upd);
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > PRESENCE_STALE_MS) this.peers.delete(id);
    }
  }

  private hydrateFromStore(scope: ShoutboxScope): void {
    this.messages[scope] = ShoutboxStore.getAll(scope);
  }

  private applyMessage(scope: ShoutboxScope, message: ChatMessage): void {
    this.messages[scope] = ShoutboxStore.merge(scope, [message]);
  }

  private async handleWireMessage(msg: WireMessage, _fromPeerId: string): Promise<void> {
    switch (msg.kind) {
      case 'presence': {
        if (msg.peerId === this.transport.peerId) return; // we already upserted ourselves in broadcastPresence()
        // NOT signature-verified: spoofing a username (or a fake
        // "viewing this post") in the online list is a low-stakes
        // annoyance, and verifying every ~8s heartbeat from every peer
        // would multiply posting-key lookups for no real security
        // benefit. Revisit if presence is ever used for anything
        // higher-stakes than "who's around right now".
        this.peers.set(msg.peerId, { peerId: msg.peerId, username: msg.username, scope: msg.scope, lastSeen: Date.now(), viewingPost: msg.viewingPost });
        return;
      }

      case 'certificate': {
        ShoutboxStore.addCertificate(msg.cert); // verified lazily, the first time a message actually needs it
        return;
      }

      case 'chat': {
        await this.ingestChatMessage(msg.message);
        return;
      }

      case 'history_request': {
        // Every connected peer answers now, not just the host. Used to be
        // host-only ("it's the only peer guaranteed to have seen
        // everything that passed through the room") — but host is elected
        // purely by whoever's browser tab happened to claim the room id
        // first (see transport/peerjs-transport.ts), with zero regard for
        // who actually has the richest local cache. In practice that meant
        // a peer sitting on months of history could be connected right
        // next to someone who has none, and that history would never be
        // shared, simply because the peer with it wasn't the one who won
        // the race to be host this session. Now anyone who has messages
        // matching the request answers, so a newcomer gets backfilled by
        // whoever in the (small) room actually has the data — mesh-like
        // resilience without needing a real mesh transport. Multiple
        // overlapping answers from several peers at once is expected and
        // cheap: ingestChatMessage() below dedupes by message id before
        // doing any signature verification, so redundant answers are
        // silently discarded, not reprocessed.
        const scopes = msg.scopes.length ? msg.scopes : ShoutboxStore.getKnownScopes();
        const since = msg.since ?? 0;
        const out: ChatMessage[] = [];
        for (const s of scopes) {
          out.push(...ShoutboxStore.getAll(s as ShoutboxScope).filter((m) => m.ts > since).slice(-HISTORY_RESPONSE_LIMIT));
        }
        if (out.length === 0) return;
        const certificates = ShoutboxStore.getCertificates(new Set(out.map((m) => m.certId)));
        const resp: HistoryResponse = { kind: 'history_response', messages: out, certificates };
        this.transport.broadcast(resp);
        return;
      }

      case 'history_response': {
        for (const c of msg.certificates) ShoutboxStore.addCertificate(c);
        for (const m of msg.messages) await this.ingestChatMessage(m);
        return;
      }
    }
  }

  /** Full verification chain: certificate's posting-key signature, then
   * the message's session-key signature, then that the message's
   * timestamp actually falls inside that certificate's validity window.
   * Any failure at any step drops the message silently (logged as a
   * warning) — there is no partial-trust state. */
  private async ingestChatMessage(m: ChatMessage): Promise<void> {
    if (ShoutboxStore.getAll(m.scope).some((x) => x.id === m.id)) return; // already have it, no need to re-verify
    if (!this.deps) return;

    const cert = ShoutboxStore.getCertificate(m.certId);
    if (!cert) { warn('dropping message from', m.author, '— certificate', m.certId, 'not known locally yet'); return; }

    const certOk = await verifyCertificate(this.deps.getClient(), cert);
    if (!certOk) { warn('dropping message from', m.author, '— its certificate does not verify'); return; }

    if (cert.account !== m.author) { warn('dropping message — certificate account does not match claimed author'); return; }

    const sessionPubKey = await importSessionPublicKey(cert);
    const ok = await verifyChatBody(sessionPubKey, m.scope, m.author, m.body, m.ts, m.id, m.sig, cert.issuedAt, cert.expiresAt);
    if (!ok) { warn('dropped message with invalid session signature from', m.author); return; }

    this.applyMessage(m.scope, m);
  }
}

export const Shoutbox = new ShoutboxCore();
