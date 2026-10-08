import { reactive } from 'vue';
import type { AuthUser } from '../../types';
import type { CertificateBroadcast, ChatBroadcast, ChatMessage, HistoryRequest, HistoryResponse, PresenceUpdate, ShoutboxScope, Translation, TranslationBroadcast, TranslationClaim, TranslationRequest, WireMessage } from './types';
import type { SignalingTransport, TransportStatus } from './transport/types';
import { PeerJsTransport } from './transport/peerjs-transport';
import { ShoutboxStore } from './store';
import { signChatBody, verifyChatBody, signTranslationBody, verifyTranslationBody } from './identity';
import { getOrCreateSession, hasReadySession, importSessionPublicKey, verifyCertificate } from './session';
import { expandEmojiShortcodes } from './emoji';
import { TranslationStore } from './translation-store';
import type { TranslationEngine } from './translation-providers';

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
// How long requestTranslation() waits for some peer to answer with an
// already-cached translation before the caller falls back to running the
// text through a provider itself. Short enough that a reader isn't stuck
// staring at a spinner if nobody has it, long enough for a same-room peer
// (which, per the star topology, is at most one relay hop away) to reply.
const TRANSLATION_REQUEST_TIMEOUT_MS = 3_000;
// If some OTHER peer announces a translation_claim for the exact key we're
// waiting on (see TranslationClaim's doc comment in types.ts), we give
// them this much extra time to actually deliver before giving up and
// doing it ourselves — avoids several peers redundantly hitting the
// translation provider for the same text at once ("thundering herd").
const TRANSLATION_CLAIM_GRACE_MS = 6_000;
// One last, randomized micro-wait right before we'd otherwise give up —
// claimSeen is checked again when THIS fires too. Covers the case where
// two peers' original timeouts expire within the same instant: neither
// had claimed anything yet, so without this both would immediately
// declare a claim and translate at once. Jittering who "wins" that last
// moment means whichever fires first gets to claim it, and the other
// sees that claim during its own (slightly longer) wait and defers.
const TRANSLATION_FINAL_JITTER_RANGE_MS: [number, number] = [150, 500];

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
  /** Extra scopes to keep syncing in the background even while nobody has
   *  them open — e.g. other communities the logged-in user subscribes to
   *  (see setWatchedScopes()). Always unioned with 'global' and
   *  currentScope wherever history is requested (watchedScopes()), so
   *  callers don't need to re-include those themselves. */
  private extraScopes: ShoutboxScope[] = [];
  /** Keyed by `${contentId}::${targetLang}` — resolved by ingestTranslation()
   *  the moment a verified answer arrives, or by its own timeout, whichever
   *  comes first. Deduped: a second requestTranslation() call for the same
   *  key while one is already in flight just gets the same promise, rather
   *  than re-broadcasting a redundant request. */
  private pendingTranslationRequests = new Map<string, {
    waiters: Array<(t: Translation | null) => void>;
    timer: ReturnType<typeof setTimeout>;
    /** Set by handleWireMessage when a translation_claim arrives for this
     *  exact key, whichever of the timers below happens to be running at
     *  the time — consulted each time one of them fires. */
    claimSeen: boolean;
    /** We only grant the CLAIM_GRACE extension once per request, so a
     *  peer that claims and then never delivers can't stall us forever
     *  (a second claim for the same key, if it even happens, is ignored). */
    grantedGrace: boolean;
  }>();

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

  /** Registers extra scopes to keep syncing in the background regardless
   *  of which one is currently active — e.g. ShoutboxWidget.vue calls this
   *  with the user's other subscribed communities, so a tab can appear
   *  for one (see the component's `visibleExtraScopes`) as soon as it
   *  actually has anything in it, rather than only ever finding out by
   *  accident. Immediately hydrates each newly-added scope from whatever
   *  is already cached locally (a previous session's history), so nothing
   *  waits on a network round-trip just to show what we already have. */
  setWatchedScopes(scopes: ShoutboxScope[]): void {
    this.extraScopes = scopes;
    for (const s of scopes) if (!(s in this.messages)) this.hydrateFromStore(s);
  }

  private watchedScopes(): ShoutboxScope[] {
    return Array.from(new Set<ShoutboxScope>(['global', this.currentScope.value, ...this.extraScopes]));
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
   * re-invokes send() automatically once unlocked, rather than failing.
   *
   * `onSent` fires exactly once, right before resolving `true` — on
   * whichever attempt actually succeeds, immediate or the PIN-unlock
   * retry. It exists because the retry above is a fire-and-forget call
   * the original caller has no way to still be awaiting (that original
   * `await send(...)` already resolved to `false` the moment the PIN
   * modal appeared) — so any success-only side effect the *component*
   * needs (here: clearing the input box) has to be threaded through
   * explicitly like this rather than living in the caller's own
   * `if (ok) ...` after the first `await`, or it simply never runs for
   * the PIN-retry path. See ShoutboxWidget.vue's submit(). */
  async send(body: string, onSent?: () => void): Promise<boolean> {
    const trimmed = expandEmojiShortcodes(body).trim();
    if (!trimmed || !this.deps) return false;

    const user = this.deps.auth.user;
    if (!user) { warn('cannot send — not logged in'); return false; }

    // Only gate on checkLock() when a fresh posting-key signature would
    // actually be needed (no still-valid certificate already in hand) —
    // see hasReadySession()'s comment for why an unconditional checkLock()
    // here would prompt for a PIN on every single message once the local
    // key re-locks on reload, even though the ~48h certificate it would
    // sign is still perfectly valid and about to be reused as-is.
    if (!hasReadySession(this.deps.auth) && this.deps.checkLock(() => { void this.send(body, onSent); })) return false; // PIN modal now showing, will retry after unlock

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
      onSent?.();
      return true;
    } finally {
      this.sending.value = false;
    }
  }

  /** Asks the room "does anyone already have a translation of this
   *  content into this language?" and waits briefly for a verified
   *  answer. Resolves `null` on timeout or if nothing verifiable turns
   *  up — callers (see useTranslation.ts) treat that as "nobody has it,
   *  translate it yourself." Pure network lookup: callers are expected to
   *  have already checked their own local cache (TranslationStore) first. */
  requestTranslation(contentId: string, targetLang: string): Promise<Translation | null> {
    const key = `${contentId}::${targetLang}`;
    const existing = this.pendingTranslationRequests.get(key);
    if (existing) return new Promise((resolve) => existing.waiters.push(resolve));

    return new Promise((resolve) => {
      this.pendingTranslationRequests.set(key, {
        waiters: [resolve],
        timer: null as unknown as ReturnType<typeof setTimeout>,
        claimSeen: false,
        grantedGrace: false,
      });
      this.armTranslationTimeout(key, TRANSLATION_REQUEST_TIMEOUT_MS);
      const req: TranslationRequest = { kind: 'translation_request', contentId, targetLang };
      this.transport.broadcast(req);
    });
  }

  /** Tells the room "I'm about to translate this myself" — see
   *  TranslationClaim's doc comment in types.ts. Callers (useTranslation.ts)
   *  call this right before running the text through a provider, once
   *  requestTranslation() above has already come back empty-handed. */
  announceTranslationClaim(contentId: string, targetLang: string): void {
    const claim: TranslationClaim = { kind: 'translation_claim', contentId, targetLang, by: this.transport.peerId ?? 'unknown' };
    this.transport.broadcast(claim);
  }

  /** One tier of requestTranslation()'s wait. Re-arms itself with a longer
   *  wait if a claim showed up in the meantime (once), or with one final
   *  short randomized wait if nothing has shown up at all yet (also once) —
   *  see TRANSLATION_CLAIM_GRACE_MS / TRANSLATION_FINAL_JITTER_RANGE_MS's
   *  comments above for why each exists. `isFinalJitter` marks that second
   *  case so we don't loop forever adding more jitter tiers. */
  private armTranslationTimeout(key: string, ms: number, isFinalJitter = false): void {
    const entry = this.pendingTranslationRequests.get(key);
    if (!entry) return;
    entry.timer = setTimeout(() => {
      const e = this.pendingTranslationRequests.get(key);
      if (!e) return;
      if (e.claimSeen && !e.grantedGrace) {
        e.grantedGrace = true;
        this.armTranslationTimeout(key, TRANSLATION_CLAIM_GRACE_MS);
        return;
      }
      if (!isFinalJitter) {
        const [lo, hi] = TRANSLATION_FINAL_JITTER_RANGE_MS;
        this.armTranslationTimeout(key, lo + Math.random() * (hi - lo), true);
        return;
      }
      this.finalizeTranslationRequest(key, null);
    }, ms);
  }

  private finalizeTranslationRequest(key: string, result: Translation | null): void {
    const entry = this.pendingTranslationRequests.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingTranslationRequests.delete(key);
    entry.waiters.forEach((w) => w(result));
  }

  /** Signs, stores locally, and shares a freshly machine-translated body —
   *  same requires-login + checkLock dance as send() (see that method's
   *  header comment), because a translation is just as much an
   *  attributed, moderatable piece of content as a chat message: an
   *  unsigned "translation" would be a trivial way to inject altered text
   *  under someone else's apparent words. Returns false (and shares
   *  nothing) if not logged in — callers still may display the text
   *  locally for this viewer only in that case, see useTranslation.ts. */
  async publishTranslation(contentId: string, targetLang: string, engine: TranslationEngine, body: string): Promise<boolean> {
    if (!this.deps) return false;
    const user = this.deps.auth.user;
    if (!user) { warn('cannot publish translation — not logged in'); return false; }

    return new Promise<boolean>((resolve) => {
      // Same reasoning as send() above: this runs automatically (no
      // explicit "share this" click from the user — autoShow triggers it
      // on every post that isn't cached anywhere yet), so an unconditional
      // checkLock() here would mean a PIN prompt on nearly every page
      // visit, not just once per ~48h certificate. Only actually gate on
      // it when a fresh signature is genuinely required.
      if (!hasReadySession(this.deps!.auth) && this.deps!.checkLock(() => { void this.publishTranslation(contentId, targetLang, engine, body).then(resolve); })) return; // PIN modal now showing

      (async () => {
        const session = await getOrCreateSession(this.deps!.auth);
        if (!session) { warn('cannot publish translation — could not establish a signed session'); resolve(false); return; }

        const translator = user.username;
        const nonce = makeNonce();
        const { ts, sig } = await signTranslationBody(session.privateKey, contentId, targetLang, engine, translator, body, nonce);
        const translation: Translation = { id: nonce, contentId, targetLang, engine, translator, body, ts, sig, certId: session.cert.id };

        ShoutboxStore.addCertificate(session.cert);
        await TranslationStore.put(translation); // cache our own result locally too, same as a chat message's optimistic local echo

        this.transport.broadcast({ kind: 'certificate', cert: session.cert } as CertificateBroadcast);
        this.transport.broadcast({ kind: 'translation', translation } as TranslationBroadcast);
        resolve(true);
      })();
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private onConnected(): void {
    this.broadcastPresence();
    this.requestHistory(this.watchedScopes());
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
      this.requestHistory(this.watchedScopes(), HISTORY_RESYNC_OVERLAP_MS);
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

      case 'translation_request': {
        // Answer only if we actually have this exact (content, language)
        // cached locally — unlike history_request, there's no "give me
        // everything newer than X" fan-out here, just a direct lookup.
        const cached = await TranslationStore.get(msg.contentId, msg.targetLang);
        if (!cached) return;
        const certs = ShoutboxStore.getCertificates(new Set([cached.certId]));
        for (const c of certs) this.transport.broadcast({ kind: 'certificate', cert: c } as CertificateBroadcast);
        this.transport.broadcast({ kind: 'translation', translation: cached } as TranslationBroadcast);
        return;
      }

      case 'translation': {
        await this.ingestTranslation(msg.translation);
        return;
      }

      case 'translation_claim': {
        const key = `${msg.contentId}::${msg.targetLang}`;
        const entry = this.pendingTranslationRequests.get(key);
        if (entry) entry.claimSeen = true; // consulted next time this key's timer fires — see armTranslationTimeout
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

  /** Same verification chain as ingestChatMessage (certificate's
   *  posting-key signature, then the session-key signature over the
   *  translation-specific payload domain, then the certificate's
   *  validity window) — a translation is attributed and moderatable
   *  exactly like a chat message is, see this module's header comment.
   *  Resolves any requestTranslation() callers waiting on this exact
   *  (content, language) key ONLY on a successful verification; a failed
   *  one is silently dropped and the waiter just falls through to its own
   *  timeout, in case a different, legitimate peer still answers. */
  private async ingestTranslation(t: Translation): Promise<void> {
    if (!this.deps) return;
    const key = `${t.contentId}::${t.targetLang}`;

    const already = await TranslationStore.get(t.contentId, t.targetLang);
    if (already && already.id === t.id) return;

    const cert = ShoutboxStore.getCertificate(t.certId);
    if (!cert) { warn('dropping translation from', t.translator, '— certificate', t.certId, 'not known locally yet'); return; }

    const certOk = await verifyCertificate(this.deps.getClient(), cert);
    if (!certOk) { warn('dropping translation from', t.translator, '— its certificate does not verify'); return; }

    if (cert.account !== t.translator) { warn('dropping translation — certificate account does not match claimed translator'); return; }

    const sessionPubKey = await importSessionPublicKey(cert);
    const ok = await verifyTranslationBody(sessionPubKey, t.contentId, t.targetLang, t.engine, t.translator, t.body, t.ts, t.id, t.sig, cert.issuedAt, cert.expiresAt);
    if (!ok) { warn('dropped translation with invalid session signature from', t.translator); return; }

    await TranslationStore.put(t);
    this.finalizeTranslationRequest(key, t);
  }
}

export const Shoutbox = new ShoutboxCore();
