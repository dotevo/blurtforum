/**
 * WhaleVault browser extension interface and polyfill for steem/hive/blurt keychains.
 * Provides a unified signing interface across wallet extensions.
 */

type WVCallback = (response: WVResponse) => void;

interface WVResponse {
  success: boolean;
  result?: string;
  message?: string;
  request_id?: number;
  data?: { username?: string };
  type?: string;
  response?: WVResponse;
}

interface WVRequest {
  type: string;
  username?: string;
  message?: unknown;
  method?: string;
  appid?: string;
  reason?: string;
  sigType?: string;
  pubKey?: string;
  memoType?: string;
  addKeys?: unknown;
  request_id?: number;
  [key: string]: unknown;
}

export interface WVObject {
  current_id: number;
  requests: Record<number, WVCallback | undefined>;
  handshake_callback: WVCallback | null;
  skc_mode: boolean;
  requestHandshake(appid: string, callback: WVCallback): void;
  promiseRequestHandshake(appid: string): Promise<WVResponse>;
  requestPubKeys(appid: string, account: string | { account: string; [k: string]: unknown }, callback: WVCallback): void;
  promiseRequestPubKeys(appid: string, account: string): Promise<WVResponse>;
  requestEncryptMemo(appid: string, account: string, message: string, keyType: string, memoToPubKey: string, memoType: string, reason: string, callback: WVCallback): void;
  promiseRequestEncryptMemo(appid: string, account: string, message: string, keyType: string, memoToPubKey: string, memoType: string, reason: string): Promise<WVResponse>;
  requestDecryptMemo(appid: string, account: string, message: string, keyType: string, reason: string, callback: WVCallback): void;
  promiseRequestDecryptMemo(appid: string, account: string, message: string, keyType: string, reason: string): Promise<WVResponse>;
  requestSignBuffer(appid: string, account: string, message: unknown, keyType: string, reason: string, sigType: string, callback: WVCallback): void;
  promiseRequestSignBuffer(appid: string, account: string, message: unknown, keyType: string, reason: string, sigType: string): Promise<WVResponse>;
  dispatchCustomEvent(name: string, data: WVRequest, callback?: WVCallback): void;
  onGetResponse(response: WVResponse): void;
  onGetHandshake(response: WVResponse): void;
}

declare global {
  interface Window {
    whalevault?: WVObject;
    wv_set_polyfill?: (walletName: string, useCid: string, useUrl: string) => void;
    steem_keychain?: Record<string, unknown>;
    hive_keychain?: Record<string, unknown>;
    blurt_keychain?: Record<string, unknown>;
  }
}

const normaliseKeyType = (kt: string): string => {
  const lower = kt.toLowerCase();
  if (lower.startsWith('po') || lower.endsWith('p')) return 'Posting';
  if (lower.startsWith('me') || lower.endsWith('m')) return 'Memo';
  if (lower.startsWith('ac') || lower.endsWith('a')) return 'Active';
  if (lower.startsWith('ow') || lower.endsWith('r')) return 'Owner';
  return kt;
};

export const whalevault: WVObject = {
  current_id: 1,
  requests: {},
  handshake_callback: null,
  skc_mode: false,

  requestHandshake(appid, callback) {
    this.handshake_callback = callback;
    this.dispatchCustomEvent('wvHandshake', { type: 'wvHandshake', appid });
  },
  promiseRequestHandshake: (appid) => new Promise(resolve => window.whalevault!.requestHandshake(appid, resolve)),

  requestPubKeys(appid, account, callback) {
    let addKeys: unknown = null;
    let acc = account;
    if (typeof account === 'object') { addKeys = account; acc = (account as { account: string }).account; }
    this.dispatchCustomEvent('wvRequest', { type: 'pubkeys', username: acc as string, addKeys, appid }, callback);
  },
  promiseRequestPubKeys: (appid, account) => new Promise(resolve => window.whalevault!.requestPubKeys(appid, account, resolve)),

  requestEncryptMemo(appid, account, message, keyType, memoToPubKey, memoType = 'bts', reason, callback) {
    if (!account.includes(':')) account = 'stm:' + account;
    if (!reason) reason = 'memoEncode';
    const request: WVRequest = {
      type: 'encryptMemo', username: account, message, method: normaliseKeyType(keyType),
      pubKey: memoToPubKey, memoType, reason: reason.substring(0, 25).replace(/ /g, ''), appid,
    };
    this.dispatchCustomEvent('wvRequest', request, callback);
  },
  promiseRequestEncryptMemo: (appid, account, message, keyType, memoToPubKey, memoType, reason) =>
    new Promise(resolve => window.whalevault!.requestEncryptMemo(appid, account, message, keyType, memoToPubKey, memoType, reason, resolve)),

  requestDecryptMemo(appid, account, message, keyType, reason, callback) {
    if (!account.includes(':')) account = 'stm:' + account;
    if (!reason) reason = 'memoEncode';
    const request: WVRequest = {
      type: 'decryptMemo', username: account, message, method: normaliseKeyType(keyType),
      reason: reason.substring(0, 25).replace(/ /g, ''), appid,
    };
    this.dispatchCustomEvent('wvRequest', request, callback);
  },
  promiseRequestDecryptMemo: (appid, account, message, keyType, reason) =>
    new Promise(resolve => window.whalevault!.requestDecryptMemo(appid, account, message, keyType, reason, resolve)),

  requestSignBuffer(appid, account, message, keyType, reason, sigType, callback) {
    if (!account.includes(':')) account = 'stm:' + account;
    if (!reason) reason = '';
    const request: WVRequest = {
      type: 'signBuffer', username: account, message, method: normaliseKeyType(keyType),
      reason: reason.substring(0, 25).replace(/ /g, ''), sigType, appid,
    };
    this.dispatchCustomEvent('wvRequest', request, callback);
  },
  promiseRequestSignBuffer: (appid, account, message, keyType, reason, sigType) =>
    new Promise(resolve => window.whalevault!.requestSignBuffer(appid, account, message, keyType, reason, sigType, resolve)),

  dispatchCustomEvent(name, data, callback) {
    this.requests[this.current_id] = callback;
    const eventData = { ...data, request_id: this.current_id };
    document.dispatchEvent(new CustomEvent(name, { detail: eventData }));
    this.current_id++;
  },

  onGetResponse(response) {
    if (response?.request_id && this.requests[response.request_id]) {
      this.requests[response.request_id]!(response);
      delete this.requests[response.request_id];
    }
  },

  onGetHandshake(response) {
    if (this.handshake_callback) this.handshake_callback(response);
  },
};

window.addEventListener('message', (event: MessageEvent<WVResponse>) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.type === 'wvHandshake' && data.response) {
    window.whalevault!.onGetHandshake(data.response);
  } else if (data?.type === 'wvResponse' && data.response) {
    if (window.whalevault!.skc_mode && data.response.data?.username) {
      data.response.data.username = data.response.data.username.substring(4);
    }
    window.whalevault!.onGetResponse(data.response);
  }
});

window.whalevault = whalevault;

// ── Polyfill factory ─────────────────────────────────────────────────────────

window.wv_set_polyfill = (walletName: string, useCid: string, useUrl: string): void => {
  if (!walletName || (window as Record<string, unknown>)[walletName] || !useCid || !useUrl) return;

  const getRpc = (rpc?: string): string => (rpc?.startsWith('http') ? rpc : useUrl);

  const callbackErrorHandler = <T extends (r: WVResponse) => void>(callback?: T): T | undefined => {
    if (!callback) return callback;
    return ((response: WVResponse) => {
      if (response && typeof response.message === 'object' && (response.message as { message?: string }).message) {
        response.message = (response.message as { message: string }).message;
      }
      callback(response);
    }) as T;
  };

  (window as Record<string, unknown>)[walletName] = {
    alt_rpc: useUrl,
    requestHandshake: (cb: WVCallback) => whalevault.requestHandshake(walletName, cb),
    requestSignBuffer: (account: string, message: unknown, keyType: string, cb: WVCallback) => {
      whalevault.skc_mode = true;
      whalevault.requestSignBuffer(walletName, useCid + ':' + account, message, keyType, useCid[0] + 'kc_signBuf', 'hex', cb);
    },
    requestBroadcast: (account: string, operations: unknown[], keyType: string, cb: WVCallback, rpc?: string) => {
      whalevault.skc_mode = true;
      const safeCallback = callbackErrorHandler(cb)!;
      const opObj = { operations, url: getRpc(rpc) };
      const ops = operations as Array<[string, Record<string, string>]>;
      if (ops.length === 1 && ops[0][0] === 'transfer' && ops[0][1].memo?.startsWith('#')) {
        const xferOp = ops[0][1];
        ((window as Record<string, unknown>)[walletName] as Record<string, Function>).requestEncodeMessage(
          account, xferOp.to, xferOp.memo, 'memo', (res: WVResponse) => {
            if (!res.success) { safeCallback(res); return; }
            xferOp.memo = res.result!;
            whalevault.requestSignBuffer(walletName, useCid + ':' + account, opObj, keyType, useCid[0] + 'kc_broadcast', 'hex', safeCallback);
          }, rpc
        );
      } else {
        whalevault.requestSignBuffer(walletName, useCid + ':' + account, opObj, keyType, useCid[0] + 'kc_broadcast', 'hex', safeCallback);
      }
    },
    requestVote: (account: string, permlink: string, author: string, weight: number, cb: WVCallback, rpc?: string) => {
      ((window as Record<string, unknown>)[walletName] as Record<string, Function>).requestBroadcast(
        account, [['vote', { voter: account, author, permlink, weight: Number(weight) }]], 'posting', cb, rpc
      );
    },
    requestEncodeMessage: (account: string, to: string, message: string, key: string, cb: WVCallback, rpc?: string) => {
      whalevault.skc_mode = true;
      fetch(getRpc(rpc), {
        method: 'POST', mode: 'cors', cache: 'no-cache', redirect: 'follow',
        body: `{"id":0,"jsonrpc":"2.0","method":"call","params":["condenser_api","get_accounts",[["${to}"]]]}`,
      })
        .then(r => r.json())
        .then((response: { result?: Array<{ memo_key: string; posting: { key_auths: [string][] } }> }) => {
          let toPubkey: string | null = null;
          if (response.result?.length === 1) {
            toPubkey = key.toLowerCase().startsWith('m')
              ? response.result[0].memo_key
              : response.result[0].posting.key_auths[0][0];
          }
          whalevault.requestEncryptMemo(walletName, useCid + ':' + account, message, key, toPubkey!, 'stm', useCid[0] + 'kc_encodeMsg', cb);
        });
    },
    not_implemented: (method: string, cb?: WVCallback) => {
      console.log('WhaleVault: ' + walletName + '.' + method + ' not fully implemented');
      if (cb) cb({ success: true });
    },
  };
};

// Register polyfills after 500ms (same as original)
setTimeout(() => {
  window.wv_set_polyfill!('steem_keychain', 'stm', 'https://api.steemit.com');
  window.wv_set_polyfill!('hive_keychain', 'hiv', 'https://api.openhive.network');
  window.wv_set_polyfill!('blurt_keychain', 'blt', 'https://rpc.blurt.blog');
}, 500);

export type WVPublicInterface = WVObject;
