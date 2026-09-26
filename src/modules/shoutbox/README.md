# module/shoutbox

A backend-free, key-verified presence chat: "global" room + one room per
community, running entirely over WebRTC data channels with no server of
our own. Knows nothing about the player, forum, or wallet — it only needs
an `auth` object (current logged-in user), a `getClient()` accessor for
the current RPC client, and the app's `checkLock` (same convention used
everywhere else for signing actions). Fully independent module; safe to
delete without touching anything else.

**Sending a message requires being logged in.** There is no anonymous or
"unverified" send path — see "Sessions" below for why that's not the same
thing as "every message re-touches WhaleVault."

## Files

- `types.ts` — wire protocol types (`ChatMessage`, `SessionCertificate`, `WireMessage`, …).
- `codec.ts` — tiny base64 <-> ArrayBuffer helpers shared by session.ts/identity.ts.
- `emoji.ts` — small hardcoded emoji picker list + `:shortcode:` expansion (no CDN, no network).
- `render.ts` — turns a message body into text/post-reference segments for
  safe (no `v-html`) rendering — see "Smart post links" below.
- `session.ts` — mints/stores/verifies the one-time-per-window delegation
  certificate from a real Blurt posting key to a throwaway session key.
  The **only** file that ever touches WhaleVault or the chain's posting-key
  signature machinery.
- `identity.ts` — signs/verifies individual chat messages using a session
  key. Pure ECDSA, no chain, no WhaleVault — knows nothing about Blurt at all.
- `store.ts` — localStorage-backed rolling history + certificate cache, per scope.
- `transport/types.ts` — `SignalingTransport` interface.
- `transport/peerjs-transport.ts` — the only implementation right now:
  PeerJS's public cloud broker, star topology with host election.
- `shoutbox.ts` — reactive singleton wiring the above together; this is
  what the UI actually talks to.
- `components/ShoutboxWidget.vue` — drop-in UI.

## Why no backend, and what that costs

Two peers need *some* third party to exchange WebRTC offer/answer/ICE
candidates before they can talk directly (WebRTC has no discovery of its
own). We use PeerJS's free public broker (`0.peerjs.com`) purely for that
handshake — once connected, all chat/presence traffic flows directly
peer-to-peer, the broker sees none of it.

What this buys: zero infrastructure to run or pay for.
What it costs:
- **Single point of failure for *new* connections.** If the public broker
  is down or rate-limiting, nobody new can join (people already connected
  keep working). See `transport/peerjs-transport.ts`'s header comment.
- **No moderation authority.** There's no server to ban an account from.
  The only lever right now is client-side: don't render messages from a
  locally-blocklisted author (not yet implemented — see "Not included here").
- **History is a local cache, not a guarantee.** See "History" below.

## Emoji

The composer has a small hardcoded emoji picker (`emoji.ts`) and expands a
handful of familiar `:shortcode:` sequences (`:fire:` → 🔥, `:+1:` → 👍,
…) on send. Expansion happens in `shoutbox.ts`'s `send()`, before
signing — so the signed content and the displayed content are always
byte-identical; a receiver never has to re-run any expansion logic.
Unknown shortcodes are left as-is (no error, no partial substitution).
No emoji library, no CDN — the whole list is a plain array.

## Smart post links

Typing `@author/permlink` (or pasting a URL that contains that path
segment, from any Blurt-family frontend) in a message renders it as a
clickable reference — click it and, if the host app wired up
`openPostRef` (see `ShoutboxWidget.vue` props), it navigates in-app to
that post. A 🔗 button in the composer inserts a reference to whatever
post the host app says is currently open (`currentPost` prop), so sharing
"look what I'm reading" is one click.

Rendering (`render.ts`) deliberately never builds an HTML string: message
bodies are attribution-verified (see "Sessions" above) but not
content-verified, so turning them into a segment list and letting Vue's
own template engine render each piece keeps every character of untrusted
text going through Vue's normal escaping. There's no HTML-construction
step here for something to sneak through, unlike a `v-html` + sanitizer
approach would require.

## Sessions: one popup, not one-per-message

**The problem this solves:** signing every single chat message with the
account's real posting key would mean a WhaleVault popup on every send —
unusable. Signing with the local key silently (no popup) was possible for
local-key accounts, but not for WhaleVault accounts, and treating the two
account types differently felt like the wrong foundation.

**The mechanism** (`session.ts`): generate a throwaway ECDSA (P-256) key
pair, entirely in the browser. Get the real posting key to sign **one**
short certificate — `"account X delegates to session pubkey Y, valid from
A to B"` — this is the one moment WhaleVault shows a popup (or a locked
local key needs its PIN), handled through the same `checkLock()`
convention as every other signing action in the app
(`usePostForm.ts`/`useImageUpload.ts`). Every message after that is
signed with the session key: a plain in-browser ECDSA operation, no
popup, no PIN, no network call.

**Why the certificate payload is safe to sign even without a
server-issued challenge:** the payload embeds the session's own
freshly-generated public key. Nobody could have a pre-existing signature
lying around over this exact payload, because the payload contains
something that didn't exist until that moment — the session's random new
key. That's the role a server nonce plays in a normal challenge-response
scheme; here the freshly-minted session public key plays it instead. A
domain prefix (`blurtforum-shoutbox-session-delegation:v1:`) additionally
guarantees this signature can't be confused with a signature over
anything else this or any other app might ask the same key to sign.

**Trust chain for verifying any message:** certificate's posting-key
signature (verified against the chain, cached forever per certificate id
— a cache hit can never mean something different since the id is a hash
of the cert's own contents) → session key's signature over the message →
message's timestamp falls inside that certificate's validity window. Any
break in that chain drops the message. This is exactly as strong as
signing every message with the posting key directly would be — just
without re-touching WhaleVault or the chain per message.

**localStorage trade-off, stated plainly:** the session private key
persists to localStorage (not a non-extractable WebCrypto key) so a page
refresh doesn't force a new popup. Cost: a future XSS bug in this app
could steal a *live* session key and impersonate the account **in
shoutbox chat only** — no blockchain funds or posting rights are
reachable through it — until the certificate expires. `CERT_VALIDITY_MS`
in `session.ts` (currently 48h) is the size of that worst-case window;
kept deliberately short rather than "forever" for exactly this reason.

## History: gossip + local cache, not a database

There is no canonical message log anywhere. What each browser has is
whatever it happened to receive while connected, kept in `localStorage`
(`store.ts`), capped per scope (200 messages) and per total scopes
retained (64, oldest-touched evicted first). Certificates are cached
separately (up to 500, oldest-issued evicted first).

**Every scope is stored, not just the one you're viewing.** If you're
sitting in the Global tab, messages from `community:blurt-179874` that
pass through your connection (because you're relayed through the same
host as everyone else, or because you *are* the host) are still persisted
locally — the UI just doesn't render them until you switch tabs. With
2-3 people online total, a lone visitor to a specific community's tab
would otherwise see near-permanent history loss on every refresh, because
there's rarely anyone else *in that exact scope* to have kept a copy.
Storing scope-blind means anyone connected at all is a potential source
of recovery for any scope's history, not just people who happened to have
that specific tab open.

On connect (and on switching scopes), a peer sends a `history_request`
for the scopes it cares about; **any currently-connected peer that has a
matching message answers** (not just the host — see `shoutbox.ts`'s
`history_request` handler for why that changed from an earlier, host-only
version). Answers are capped at 50 messages per scope per response, and
redundant/overlapping answers from multiple peers are expected — they're
deduped by message id before any signature verification happens, so
answering "too much" costs nobody anything beyond a little redundant
bandwidth at this app's current handful-of-users scale.

**History sync also re-runs periodically, not just once on connect**
(`HISTORY_RESYNC_MS`, currently 45s, with a couple minutes of intentional
overlap on each re-ask — see `startHistoryResync()`). This is what makes
the "any connected peer, not just the host, can backfill you" property
above actually reliable in practice rather than a one-shot best-effort at
the moment you happen to connect: a flaky reconnect, a message that
arrived while your certificate for its author hadn't shown up yet (see
"Not included here" below), or simply not yet being connected to the peer
who has it, all get a second (and third, and fourth, …) chance to resolve
themselves without anyone needing to notice and manually refresh.

**A `history_response` always bundles a message together with the
certificate that authorizes it** (`HistoryResponse.certificates`) — a
message whose certificate never arrives is permanently unverifiable and
gets dropped on receipt (see `shoutbox.ts`'s `ingestChatMessage()`), so
the two travel together rather than relying on the certificate having
been separately gossiped earlier and still being cached somewhere.

If literally nobody else has ever been online in a given scope, its
history simply doesn't exist yet, anywhere — there is no floor lower than
"the humans who were there wrote it down." That's an honest limitation of
having no server, not a bug to route around quietly.

## Presence ("who's online")

Every connected peer broadcasts a small heartbeat every 8s (and
immediately on `setViewingPost()`, see below): `{ peerId, username,
scope, ts, viewingPost }`. Peers not heard from in >20s are dropped from
the local online list. **The local peer upserts itself into this same map
directly** rather than relying on its own broadcast looping back — a lone
user should always see "1 online" (themselves), not "0", which an earlier
version of this module got wrong. **Presence updates are not
signature-verified** — spoofing a fake username or fake "currently
reading" claim is a much lower-stakes annoyance than spoofing message
authorship, and verifying every heartbeat from every peer would multiply
posting-key lookups for no real security benefit. Revisit if presence is
ever used for anything higher-stakes than "who's around right now".

`viewingPost` carries only `{ author, permlink, title? }` for whatever
forum post the host app says is currently open (via `setViewingPost()`,
called by `ShoutboxWidget.vue` whenever its `currentPost` prop changes) —
**deliberately never anything about the media player.** That split was an
explicit design decision: someone might be fine broadcasting "I'm reading
this post" but not "I'm listening to this track", so the two stay
separate rather than one being folded into the other. Extending this to
cover player state would mean deciding that trade-off, not just wiring up
more data.

The **"Online" tab** (`ShoutboxWidget.vue`) lists everyone currently
known, across every scope — not filtered to whichever chat tab is
active, since "who's around at all" is usually the more useful question
at this forum's current size. Each row shows a username (or "anonymous"
for a connected-but-not-logged-in peer — presence isn't gated by login,
only *sending* is) and, if they have one open, a clickable link to the
post they're reading (reusing the same `openPostRef` as the smart post
links in chat).

`Shoutbox.onlineCount(scope?)` / `onlineUsernames(scope?)` remain
scope-filtered (used by the collapsed pill, which is meant to reflect
"people in the tab you're about to open"); `Shoutbox.allPeers()` is the
unfiltered version behind the Online tab. None of this relies on the
transport reporting a raw connection count — a client in a star topology
can't see sibling clients directly anyway (see
`transport/peerjs-transport.ts`); the presence layer above the transport
is the actual source of truth for "who's here," and survives host
handovers for free.

## Positioning: tracks the media player

`ShoutboxWidget.vue` imports the player's reactive state directly
(`modules/player/player.ts`'s exported `state` singleton — the same
object `MediaPlayer.vue` itself reads) and computes how much vertical
space the player currently occupies (bar / expanded panel / minimized
pill / hidden), keeping the dock's `bottom` offset a fixed gap above
whatever that is. **This is the one deliberate exception to this
module's "fully independent, safe to delete" claim** — a small, one-way,
read-only dependency on the player, taken on purpose because a chat dock
that gets covered by the media bar isn't usable. Deleting this module
still doesn't touch the player; the dependency only runs the other
direction.

## Swapping the transport

`shoutbox.ts` only depends on the `SignalingTransport` interface
(`transport/types.ts`), never on PeerJS directly. To try a different
public network (Gun.js relays, Nostr relays, …), implement that interface
and change the one line in `shoutbox.ts`:

```ts
constructor(transport: SignalingTransport = new PeerJsTransport()) {
```

Nothing in `session.ts`, `identity.ts`, `store.ts`, or the
message-handling logic in `shoutbox.ts` needs to know or care.

## Not included here (known gaps, not oversights)

- **Per-account blocklist / mute.** Would be a small client-side filter in
  `shoutbox.ts`'s `ingestChatMessage()`, stored in `localStorage`
  alongside the message history. Not built yet.
- **Rate limiting / anti-flood.** Nothing currently stops a signed account
  from sending as fast as it can type. A simple client-side "ignore
  messages from account X more often than every N seconds" throttle,
  enforced by every receiver (not just the host), would be the next thing
  to add before this is exposed to a larger audience.
- **Community-level moderation tied to on-chain roles.** Could piggyback
  on however `community.ts` already reads community mod lists, filtering
  messages from banned accounts — deliberately left out of this first cut
  to keep the module's surface area small and independently reviewable.
- **Certificate broadcast is currently sent with EVERY message**, not just
  once per session — simplest way to guarantee any currently-connected
  peer can verify immediately, at the cost of ~150 redundant bytes per
  message. If that ever matters, the fix is: broadcast the certificate
  once right after `getOrCreateSession()` mints/loads it in `send()`,
  and rely on `history_response` bundling for anyone who missed that.
- **A message whose certificate hasn't arrived yet (live, not history) is
  dropped, not queued/retried** once the certificate does show up. Rare
  in practice (the certificate broadcast above currently rides along with
  every message), but worth knowing if that optimization above is ever made.
- **Post references aren't checked to actually exist** until someone
  clicks one — `render.ts` only checks the *shape* (`@user/permlink`),
  not whether that post is real. Clicking a bogus one just means
  `openTopic`'s own fetch comes back empty, same as navigating there any
  other way in the app.
- **The `.shoutbox-msg` "unverified" badge from an earlier draft of this
  module is gone** — with login required to send (see above), every
  message that survives verification always has a real signature; there
  is no partially-trusted display state left to show a badge for.
