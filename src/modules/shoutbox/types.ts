/**
 * modules/shoutbox/types.ts
 *
 * Wire protocol + data types for the presence/chat "shoutbox" module. This
 * module knows nothing about how peers actually reach each other (see
 * transport/types.ts) — everything here is transport-agnostic.
 */

/** 'global' is always available. Community scopes are free-form strings tied
 * to a Blurt community account name, e.g. 'community:blurt-179874'. */
export type ShoutboxScope = 'global' | `community:${string}`;

/**
 * A one-time delegation from a real Blurt account to a throwaway,
 * locally-generated ECDSA session key — see session.ts. Signed ONCE by
 * the account's posting key (the only moment this module ever prompts a
 * WhaleVault popup or needs an unlocked local key); every individual chat
 * message afterwards is signed by the cheap session key instead, entirely
 * offline, with no further prompts until the certificate expires.
 */
export interface SessionCertificate {
  /** sha256 hex of the exact signed payload — doubles as this cert's wire id. */
  id: string;
  account: string;
  /** base64-encoded raw EC point (P-256) of the session's public key. */
  sessionPubKey: string;
  issuedAt: number;
  expiresAt: number;
  /** Hex signature by `account`'s Blurt POSTING key over the canonical
   * cert payload — see session.ts's certPayload(). Verified against the
   * chain exactly like any other posting-key signature in this app. */
  sig: string;
}

export interface ChatMessage {
  /** Also the signature nonce for replay protection — see identity.ts. */
  id: string;
  scope: ShoutboxScope;
  author: string;
  body: string;
  ts: number;
  /** base64 ECDSA signature by the session key referenced in certId — NOT
   * the account's real Blurt key. Always present: sending is only
   * possible while logged in (see shoutbox.ts's send()), so there is no
   * "unverified, no signature at all" message state anymore. */
  sig: string;
  /** Which SessionCertificate authorizes the session key that produced `sig`. */
  certId: string;
}

export interface PresenceUpdate {
  kind: 'presence';
  peerId: string;
  username: string | null;
  scope: ShoutboxScope;
  ts: number;
  /** What forum post/topic this peer currently has open, if any — powers
   * the "who's online" tab. Deliberately does NOT carry anything about
   * what's playing in the media player: that's a separate kind of
   * "what are you doing" that wasn't asked for and has its own privacy
   * shape (someone might be fine sharing "I'm reading this post" but not
   * "I'm listening to this track"). Keep these separate if that's ever
   * wanted — don't fold it into this field. */
  viewingPost: { author: string; permlink: string; title?: string } | null;
}

export interface ChatBroadcast {
  kind: 'chat';
  message: ChatMessage;
}

export interface CertificateBroadcast {
  kind: 'certificate';
  cert: SessionCertificate;
}

export interface HistoryRequest {
  kind: 'history_request';
  /** Empty = "send me whatever you've got". */
  scopes: ShoutboxScope[];
  /** Only messages newer than this are worth sending back. */
  since?: number;
}

export interface HistoryResponse {
  kind: 'history_response';
  messages: ChatMessage[];
  /** Every certificate referenced by `messages`, bundled in the SAME
   * response — a message whose certificate never arrives is unverifiable
   * and gets dropped (see shoutbox.ts's ingestChatMessage), so history
   * sync always ships both together rather than relying on the
   * certificate having been separately gossiped earlier. */
  certificates: SessionCertificate[];
}

/**
 * Machine-translated text for a post or comment, shared over the SAME
 * P2P room chat already uses (see shoutbox.ts) rather than a second
 * PeerJS connection — one peer runs it through MyMemory/Google once, and
 * everyone else who looks at that content afterwards gets it for free.
 *
 * Signed and certificate-backed exactly like a ChatMessage (same session
 * key, same SessionCertificate), so a translation is just as strongly
 * attributed to a real Blurt account as a chat message is — this matters
 * because an unattributed "translation" is a realistic way to slip
 * fake/altered text under someone else's apparent words. The signing
 * domain is kept separate from chat (see identity.ts's payload prefix) so
 * a valid chat signature can never be replayed as a valid translation
 * signature or vice versa.
 */
export interface Translation {
  /** Also the signature nonce — same convention as ChatMessage.id. */
  id: string;
  /** `${author}:${permlink}` of the post or comment being translated. */
  contentId: string;
  targetLang: string;
  engine: 'mymemory' | 'google';
  /** Blurt account that produced (and is vouching for) this translation. */
  translator: string;
  body: string;
  ts: number;
  sig: string;
  certId: string;
}

export interface TranslationBroadcast {
  kind: 'translation';
  translation: Translation;
}

export interface TranslationRequest {
  kind: 'translation_request';
  contentId: string;
  targetLang: string;
}

export type WireMessage =
  | PresenceUpdate
  | ChatBroadcast
  | CertificateBroadcast
  | HistoryRequest
  | HistoryResponse
  | TranslationBroadcast
  | TranslationRequest;
