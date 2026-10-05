import { b64FromBuffer, bufferFromB64 } from './codec';

/**
 * modules/shoutbox/identity.ts
 *
 * Message-level signing/verification using a SESSION key (see session.ts)
 * — deliberately knows nothing about Blurt, posting keys, or the chain at
 * all. That's all session.ts's job (minting/verifying the certificate
 * that vouches for a session key in the first place). This file just
 * answers: "is this (scope, author, body, ts, nonce) tuple validly signed
 * by this specific session public key, and is it fresh?" — the same
 * question regardless of whether the session key was ultimately backed by
 * a local Blurt key or a WhaleVault-signed certificate.
 *
 * The message's own `id` doubles as the signature nonce, exactly as
 * before — no separate id-vs-nonce bookkeeping.
 */

const LOG = '[ShoutboxIdentity]';
function warn(...args: unknown[]): void { console.warn(LOG, ...args); }

// Replay protection: a (author, nonce) pair is only accepted once, ever,
// within this process's lifetime. This is DELIBERATELY separate from (and
// in addition to) each message's certificate validity window — the
// window says "this signature could only have been produced during this
// span of time"; this cache says "and we've specifically not already
// accepted this exact one before."
const seenNonces = new Set<string>(); // `${author}:${nonce}`

function chatMessagePayload(scope: string, author: string, body: string, ts: number, nonce: string): string {
  return `shoutbox:chat:v1:${scope}:${author}:${ts}:${nonce}:${body}`;
}

export interface SignedChatFields {
  ts: number;
  sig: string; // base64
}

/** Signs with the session's ECDSA private key — a plain in-browser
 * operation, no popup, no PIN, no network. `nonce` is the caller's
 * chosen message id (see shoutbox.ts's send()). */
export async function signChatBody(
  sessionPrivateKey: CryptoKey,
  scope: string,
  author: string,
  body: string,
  nonce: string
): Promise<SignedChatFields> {
  const ts = Date.now();
  const payload = chatMessagePayload(scope, author, body, ts, nonce);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sessionPrivateKey, new TextEncoder().encode(payload));
  return { ts, sig: b64FromBuffer(sigBuf) };
}

/**
 * `certWindowStart`/`certWindowEnd` are the authorizing certificate's
 * `issuedAt`/`expiresAt` — a message's `ts` must fall inside that window,
 * otherwise a session key could be used to backdate/postdate messages
 * outside the span it was actually authorized for. Callers are expected
 * to have already verified the certificate itself (session.ts's
 * verifyCertificate()) before calling this.
 */
export async function verifyChatBody(
  sessionPublicKey: CryptoKey,
  scope: string,
  author: string,
  body: string,
  ts: number,
  nonce: string,
  sigB64: string,
  certWindowStart: number,
  certWindowEnd: number
): Promise<boolean> {
  if (ts < certWindowStart || ts > certWindowEnd) {
    warn('rejecting message from', author, '— timestamp outside its certificate\'s validity window');
    return false;
  }

  const seenKey = `${author}:${nonce}`;
  if (seenNonces.has(seenKey)) {
    warn('rejecting message from', author, '— nonce already seen (replay)');
    return false;
  }

  try {
    const payload = chatMessagePayload(scope, author, body, ts, nonce);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      sessionPublicKey,
      bufferFromB64(sigB64),
      new TextEncoder().encode(payload)
    );
    if (ok) seenNonces.add(seenKey);
    else warn('rejecting message from', author, '— session-key signature does not verify');
    return ok;
  } catch (e) {
    warn('verification threw for', author, e);
    return false;
  }
}

// ─── Translations ───────────────────────────────────────────────────────
// Same signing scheme as chat messages, but under its own payload prefix
// (`shoutbox:translation:v1:` vs `shoutbox:chat:v1:`) and its own replay
// cache, so a signature produced for one domain can never be mistaken for
// — or replayed as — a valid signature in the other, even though both are
// ultimately backed by the same per-account session key/certificate.
const seenTranslationNonces = new Set<string>(); // `${translator}:${nonce}`

function translationPayload(contentId: string, targetLang: string, engine: string, translator: string, body: string, ts: number, nonce: string): string {
  return `shoutbox:translation:v1:${contentId}:${targetLang}:${engine}:${translator}:${ts}:${nonce}:${body}`;
}

export async function signTranslationBody(
  sessionPrivateKey: CryptoKey,
  contentId: string,
  targetLang: string,
  engine: string,
  translator: string,
  body: string,
  nonce: string
): Promise<SignedChatFields> {
  const ts = Date.now();
  const payload = translationPayload(contentId, targetLang, engine, translator, body, ts, nonce);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sessionPrivateKey, new TextEncoder().encode(payload));
  return { ts, sig: b64FromBuffer(sigBuf) };
}

export async function verifyTranslationBody(
  sessionPublicKey: CryptoKey,
  contentId: string,
  targetLang: string,
  engine: string,
  translator: string,
  body: string,
  ts: number,
  nonce: string,
  sigB64: string,
  certWindowStart: number,
  certWindowEnd: number
): Promise<boolean> {
  if (ts < certWindowStart || ts > certWindowEnd) {
    warn('rejecting translation from', translator, '— timestamp outside its certificate\'s validity window');
    return false;
  }

  const seenKey = `${translator}:${nonce}`;
  if (seenTranslationNonces.has(seenKey)) {
    warn('rejecting translation from', translator, '— nonce already seen (replay)');
    return false;
  }

  try {
    const payload = translationPayload(contentId, targetLang, engine, translator, body, ts, nonce);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      sessionPublicKey,
      bufferFromB64(sigB64),
      new TextEncoder().encode(payload)
    );
    if (ok) seenTranslationNonces.add(seenKey);
    else warn('rejecting translation from', translator, '— session-key signature does not verify');
    return ok;
  } catch (e) {
    warn('translation verification threw for', translator, e);
    return false;
  }
}
