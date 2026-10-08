import CryptoJS from 'crypto-js/core';
import 'crypto-js/lib-typedarrays';
import 'crypto-js/sha256';
import 'crypto-js/enc-hex';
import * as dblurt from '@beblurt/dblurt';
import type { AuthUser } from '../../types';
import { Blockchain } from '../blockchain';
import { b64FromBuffer, bufferFromB64 } from './codec';
import type { SessionCertificate } from './types';

/**
 * modules/shoutbox/session.ts
 *
 * Lets someone sign many shoutbox messages while only being asked to sign
 * ONE thing with their real Blurt (posting) key per validity window — the
 * WhaleVault-popup-on-every-message problem this whole design exists to
 * avoid.
 *
 * The mechanism: generate a throwaway ECDSA (P-256) key pair locally, get
 * the real posting key to sign a short certificate delegating to it
 * ("account X authorizes session pubkey Y, valid from A to B"), then use
 * the throwaway key — an ordinary in-browser key, no popup involved — to
 * sign every individual chat message from then on. A message is trusted
 * exactly as much as full posting-key-per-message signing would trust it:
 * verifying it still requires walking the *whole* chain (cert's
 * posting-key signature → message's session-key signature), just without
 * re-touching WhaleVault or the chain for every single message.
 *
 * WHY THE CERTIFICATE PAYLOAD IS SAFE TO SIGN, EVEN THOUGH IT'S NOT A
 * SERVER-ISSUED CHALLENGE (there's no server): the payload embeds the
 * session's own freshly-generated public key. Nobody could have a
 * pre-existing signature over this exact payload lying around from some
 * unrelated context, because the payload contains something that didn't
 * exist until this function generated it a moment ago. That's what a
 * server nonce/challenge is FOR in a normal challenge-response scheme —
 * here the freshly-minted session public key plays the same role. The
 * `blurtforum-shoutbox-session-delegation:v1:` domain prefix additionally
 * guarantees this signature can never be confused with a signature over
 * anything else this app (or any other app) might ask the same key to sign.
 *
 * SECURITY NOTE ON localStorage: unlike the ephemeral in-memory-only
 * design originally sketched, the session private key here IS persisted
 * to localStorage (exportable key, not a WebCrypto non-extractable key) —
 * a deliberate trade for surviving a page refresh without a new popup.
 * The cost: a future XSS bug in this app could steal a live session key
 * and impersonate the account in shoutbox chat (ONLY in shoutbox chat —
 * no blockchain funds or posting rights are reachable through this key)
 * until the certificate expires. CERT_VALIDITY_MS below is the size of
 * that worst-case window; keep it short-ish on purpose.
 */

const LOG = '[ShoutboxSession]';
function warn(...args: unknown[]): void { console.warn(LOG, ...args); }

/** Worst-case exposure window if a session private key ever leaked from
 * localStorage (e.g. via an XSS bug) — keep deliberately short. Also
 * governs how often a WhaleVault user sees the one-time popup. */
const CERT_VALIDITY_MS = 48 * 60 * 60 * 1000; // 48h
/** Mint a fresh cert proactively if less than this remains, rather than
 * waiting for hard expiry mid-session. */
const MIN_REMAINING_MS = 10 * 60 * 1000; // 10min

const STORAGE_PREFIX = 'bf_shoutbox_session_v1:';

interface StoredSession {
  cert: SessionCertificate;
  privateKeyJwk: JsonWebKey;
}

export interface ActiveSession {
  cert: SessionCertificate;
  privateKey: CryptoKey;
}

const memoryCache = new Map<string, ActiveSession>(); // account -> session

// ─── Certificate payload + id ──────────────────────────────────────────────

function certPayload(account: string, sessionPubKey: string, issuedAt: number, expiresAt: number): string {
  return `blurtforum-shoutbox-session-delegation:v1:${account}:${sessionPubKey}:${issuedAt}:${expiresAt}`;
}

function payloadId(payload: string): string {
  return CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);
}

// ─── Session key pair (ECDSA P-256, exportable — see localStorage note above) ─

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}

async function exportPublicKeyB64(pub: CryptoKey): Promise<string> {
  return b64FromBuffer(await crypto.subtle.exportKey('raw', pub));
}

async function importSessionPublicKeyFromB64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bufferFromB64(b64), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

// ─── localStorage persistence, keyed per account (multi-account aware) ────

function loadStored(account: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + account);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch (e) {
    warn('failed to load stored session for', account, e);
    return null;
  }
}

function persistStored(account: string, stored: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + account, JSON.stringify(stored));
  } catch (e) {
    warn('failed to persist session for', account, '(quota?)', e);
  }
}

// ─── The ONE interactive signing moment in this whole module ──────────────
// Mirrors useImageUpload.ts's uploadImageFile() exactly: local unlocked key
// signs a pre-hashed buffer inline (no prompt beyond an already-handled PIN
// unlock — callers are expected to wrap the whole flow in the same
// checkLock() convention used everywhere else, e.g. usePostForm.ts);
// WhaleVault gets the RAW payload bytes via requestSignBuffer(), which
// hashes internally — WhaleVault shows its own confirmation popup here,
// exactly like it does for an image upload. This is deliberately a
// DIFFERENT function from blurt-sign-message.ts's signBlurtMessage(),
// which intentionally REFUSES to prompt WhaleVault (see its header
// comment) because it's built for silent background signing. Minting a
// session certificate is the opposite case that comment explicitly called
// out: a rare, user-initiated action where showing one popup is correct.
async function signCertificatePayloadInteractive(auth: { user: AuthUser | null }, payload: string): Promise<string | null> {
  const user = auth.user;
  if (!user) return null;
  const payloadBytes = new TextEncoder().encode(payload);

  try {
    if (user.type === 'key') {
      if (user.locked || !user.key) {
        warn('local key is present but locked — caller should checkLock() the whole send flow before reaching here');
        return null;
      }
      const wordArray = CryptoJS.lib.WordArray.create(payloadBytes as unknown as number[]);
      const hashHex = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
      const hashBytes = new Uint8Array(hashHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const privKey = dblurt.PrivateKey.from(user.key);
      return privKey.sign(hashBytes as any).toString();
    }

    // WhaleVault — interactive by design here. Sends the RAW payload bytes
    // (not pre-hashed), matching useImageUpload.ts's `combined` buffer —
    // WhaleVault's requestSignBuffer hashes internally.
    return await new Promise<string | null>((resolve) => {
      if (!window.blurt_keychain) { warn('WhaleVault not available'); resolve(null); return; }
      const bufferObject = { type: 'Buffer', data: Array.from(payloadBytes) };
      (window.blurt_keychain as Record<string, Function>).requestSignBuffer(
        user.username,
        JSON.stringify(bufferObject),
        'posting',
        (res: { success: boolean; result?: string; message?: string }) => {
          if (!res?.success) { warn('WhaleVault declined or failed:', res?.message); resolve(null); return; }
          let result = res.result ?? '';
          result = result.split(':')[0];
          if (result.startsWith('SIG_K1_')) {
            try { result = dblurt.Signature.fromString(result).toString(); } catch { /* keep raw form */ }
          }
          resolve(result);
        }
      );
    });
  } catch (e) {
    warn('certificate signing threw for', user.username, e);
    return null;
  }
}

/**
 * Returns a ready-to-use session (cert + importable private key) for the
 * currently logged-in account — reusing an existing valid one from memory
 * or localStorage wherever possible, only falling back to minting a new
 * one (the one moment that can show a popup / require an unlocked key)
 * when nothing usable is left. Resolves null if minting was needed but
 * declined/unavailable (caller should treat that as "couldn't send").
 */
/** True if a still-valid session (memory or localStorage) already exists
 *  for this account — i.e. getOrCreateSession() below would resolve
 *  WITHOUT needing a fresh posting-key signature. Callers use this to
 *  decide whether checkLock()'s PIN prompt is actually warranted before
 *  showing it: a popup is correct the one time per ~48h a new certificate
 *  genuinely has to be minted, but showing it again for every action in
 *  between — just because the local key happens to be in its locked
 *  state after a page reload — would be asking for a signature that
 *  isn't actually needed. Deliberately mirrors getOrCreateSession()'s own
 *  freshness check exactly, and must be kept in sync with it. */
export function hasReadySession(auth: { user: AuthUser | null }): boolean {
  const user = auth.user;
  if (!user) return false;
  const account = user.username;
  const freshEnoughAt = Date.now() + MIN_REMAINING_MS;

  const cached = memoryCache.get(account);
  if (cached && cached.cert.expiresAt > freshEnoughAt) return true;

  const stored = loadStored(account);
  return !!(stored && stored.cert.expiresAt > freshEnoughAt);
}

export async function getOrCreateSession(auth: { user: AuthUser | null }): Promise<ActiveSession | null> {
  const user = auth.user;
  if (!user) return null;
  const account = user.username;
  const freshEnoughAt = Date.now() + MIN_REMAINING_MS;

  const cached = memoryCache.get(account);
  if (cached && cached.cert.expiresAt > freshEnoughAt) return cached;

  const stored = loadStored(account);
  if (stored && stored.cert.expiresAt > freshEnoughAt) {
    try {
      const privateKey = await crypto.subtle.importKey(
        'jwk', stored.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
      );
      const session: ActiveSession = { cert: stored.cert, privateKey };
      memoryCache.set(account, session);
      return session;
    } catch (e) {
      warn('failed to import stored session key for', account, '— minting a new one instead', e);
    }
  }

  const keyPair = await generateKeyPair();
  const sessionPubKey = await exportPublicKeyB64(keyPair.publicKey);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CERT_VALIDITY_MS;
  const payload = certPayload(account, sessionPubKey, issuedAt, expiresAt);

  const sig = await signCertificatePayloadInteractive(auth, payload);
  if (!sig) { warn('could not obtain a certificate signature for', account); return null; }

  const cert: SessionCertificate = { id: payloadId(payload), account, sessionPubKey, issuedAt, expiresAt, sig };
  const privateKeyJwk = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey;
  persistStored(account, { cert, privateKeyJwk });

  const session: ActiveSession = { cert, privateKey: keyPair.privateKey };
  memoryCache.set(account, session);
  return session;
}

// ─── Certificate verification (the receiving side — anyone reading chat) ──

const PUBKEY_CACHE_TTL_MS = 10 * 60 * 1000; // same TTL as blurt-peer-handshake.ts
const pubKeyCache = new Map<string, { key: string | null; fetchedAt: number }>();

async function getPostingPublicKey(client: unknown, account: string): Promise<string | null> {
  const cached = pubKeyCache.get(account);
  if (cached && Date.now() - cached.fetchedAt < PUBKEY_CACHE_TTL_MS) return cached.key;
  try {
    const acc = await Blockchain.getAccount(client, account);
    const key: string | null = acc?.posting?.key_auths?.[0]?.[0] ?? null;
    pubKeyCache.set(account, { key, fetchedAt: Date.now() });
    return key;
  } catch (e) {
    warn('failed to fetch posting key for', account, e);
    return null;
  }
}

// A certificate's validity, once checked, never changes — safe to cache
// forever per certId (the id is a hash of the cert's own contents, so a
// cache hit can never be "the same id, different meaning").
const certVerifyCache = new Map<string, boolean>();

/** Verifies a certificate's posting-key signature AND that its own `id`
 * genuinely matches its contents (protects against a relay tampering with
 * a certificate's fields while leaving some other cert's id attached). */
export async function verifyCertificate(client: unknown, cert: SessionCertificate): Promise<boolean> {
  const cached = certVerifyCache.get(cert.id);
  if (cached !== undefined) return cached;

  const fail = (reason: string): false => { warn('certificate rejected —', reason, `(account: ${cert.account})`); certVerifyCache.set(cert.id, false); return false; };

  if (!(cert.expiresAt > cert.issuedAt)) return fail('expiresAt <= issuedAt');

  const payload = certPayload(cert.account, cert.sessionPubKey, cert.issuedAt, cert.expiresAt);
  if (payloadId(payload) !== cert.id) return fail('id does not match its own contents');

  const pubKey = await getPostingPublicKey(client, cert.account);
  if (!pubKey) return fail('no posting key found on chain for this account');

  const ok = Blockchain.verifySignature(payload, cert.sig, pubKey);
  if (!ok) return fail('signature does not verify against posting key');

  certVerifyCache.set(cert.id, true);
  return true;
}

const sessionPubKeyImportCache = new Map<string, CryptoKey>();

/** Import (and cache) a certificate's session public key for verifying
 * individual chat messages. Callers should have already called
 * verifyCertificate() and gotten true — this function does not itself
 * re-check the certificate's posting-key signature. */
export async function importSessionPublicKey(cert: SessionCertificate): Promise<CryptoKey> {
  const cached = sessionPubKeyImportCache.get(cert.id);
  if (cached) return cached;
  const key = await importSessionPublicKeyFromB64(cert.sessionPubKey);
  sessionPubKeyImportCache.set(cert.id, key);
  return key;
}
