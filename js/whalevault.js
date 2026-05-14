// Content script interfacing the website and the extension
var whalevault = {
    current_id: 1,
    requests: {},
    handshake_callback: null,
    skc_mode: false,

    requestHandshake: function(appid, callback) {
        this.handshake_callback = callback;
        this.dispatchCustomEvent("wvHandshake", { appid });
    },
    promiseRequestHandshake: (appid) => new Promise((response) => window.whalevault.requestHandshake(appid, response)),

    requestPubKeys: function(appid, account, callback) {
        var addKeys = null;
        if  (typeof account === 'object') {
            addKeys = account;
            account = account.account;
        }
        var request = {
            type: "pubkeys",
            username: account,
            addKeys,
            appid
        };

        this.dispatchCustomEvent("wvRequest", request, callback);
    },
    promiseRequestPubKeys: (appid, account) => new Promise((response) => window.whalevault.requestPubKeys(appid, account, response)),

    requestEncryptMemo: function(appid, account, message, keyType, memoToPubKey, memoType = 'bts', reason, callback) {
        if (!account.includes(":")) account = "stm:" + account;
        if (reason == null || reason == "") reason = "memoEncode";
        var kt = keyType.toLowerCase();
        if (kt.startsWith('po') || kt.endsWith('p')) keyType = 'Posting'; else
          if (kt.startsWith('me') || kt.endsWith('m')) keyType = 'Memo'; else
            if (kt.startsWith('ac') || kt.endsWith('a')) keyType = 'Active';
console.log(reason)
        var request = {
            type: "encryptMemo",
            username: account,
            message: message,
            method: keyType,
            pubKey: memoToPubKey,
            memoType,
            reason: reason.substring(0,25).replace(/ /g,''),
            appid
        };

        this.dispatchCustomEvent("wvRequest", request, callback);
    },
    promiseRequestEncryptMemo: (appid, account, message, keyType, memoToPubKey, memoType, reason) => 
        new Promise((response) => window.whalevault.requestEncryptMemo(appid, account, message, keyType, memoToPubKey, memoType, reason, response)),

    requestDecryptMemo: function(appid, account, message, keyType, reason, callback) {
        if (!account.includes(":")) account = "stm:" + account;
        if (reason == null || reason == "") reason = "memoEncode";
        var kt = keyType.toLowerCase();
        if (kt.startsWith('po') || kt.endsWith('p')) keyType = 'Posting'; else
          if (kt.startsWith('me') || kt.endsWith('m')) keyType = 'Memo'; else
            if (kt.startsWith('ac') || kt.endsWith('a')) keyType = 'Active';
        var request = {
            type: "decryptMemo",
            username: account,
            message: message,
            method: keyType,
            reason: reason.substring(0,25).replace(/ /g,''),
            appid
        };

        this.dispatchCustomEvent("wvRequest", request, callback);
    },
    promiseRequestDecryptMemo: (appid, account, message, keyType, reason) => 
        new Promise((response) => window.whalevault.requestDecryptMemo(appid, account, message, keyType, reason, response)),

    // sigType == raw, hex, eos/sig_k1
    requestSignBuffer: function(appid, account, message, keyType, reason, sigType, callback) {
        if (!account.includes(":")) account = "stm:" + account;
        if (reason == null) reason = "";
        var kt = keyType.toLowerCase();
        if (kt.startsWith('po') || kt.endsWith('p')) keyType = 'Posting'; else
          if (kt.startsWith('me') || kt.endsWith('m')) keyType = 'Memo'; else
            if (kt.startsWith('ac') || kt.endsWith('a')) keyType = 'Active'; else
              if (kt.startsWith('ow') || kt.endsWith('r')) keyType = 'Owner';
console.log(reason)
        var request = {
            type: "signBuffer",
            username: account,
            message: message,
            method: keyType,
            reason: reason.substring(0,25).replace(/ /g,''),
            sigType,
            appid
        };

        this.dispatchCustomEvent("wvRequest", request, callback);
    },
    promiseRequestSignBuffer: (appid, account, message, keyType, reason, sigType) => 
        new Promise((response) => window.whalevault.requestSignBuffer(appid, account, message, keyType, reason, sigType, response)),

    // Send the customEvent
    dispatchCustomEvent: function(name, data, callback) {
        this.requests[this.current_id] = callback;
        data = Object.assign({
            request_id: this.current_id
        }, data);
        document.dispatchEvent(new CustomEvent(name, {
            detail: data
        }));
        this.current_id++;
    },

    onGetResponse: function(response) {
        if (response && response.request_id) {
            if (this.requests[response.request_id]) {
                this.requests[response.request_id](response);
                delete this.requests[response.request_id];
            }
        }
    },

    onGetHandshake: function(response) {
        if (this.handshake_callback)
            this.handshake_callback(response);
    }

}

window.addEventListener("message", function(event) {
    // only accept messages from extension
    if (event.source != window) return;
    if (event.data && event.data.type) {
        if (event.data.type == "wvHandshake" && event.data.response) {
            window.whalevault.onGetHandshake(event.data.response);
        } else
        if (event.data.type == "wvResponse" && event.data.response) {
            if (window.whalevault.skc_mode && event.data.response.data && event.data.response.data.username) {
                // required for some steem_keychain-based dapps such as dtube
                event.data.response.data.username = event.data.response.data.username.substring(4);
            }
            window.whalevault.onGetResponse(event.data.response);
        }
    }
}, false);

window.wv_set_polyfill = function(wallet_name, use_cid, use_url) {
    if (!wallet_name || window[wallet_name] || !use_cid || !use_url) return;
    window[wallet_name] = {
        alt_rpc: use_url,
        get_rpc: function(rpc) {
            if (rpc && rpc.startsWith('http')) return rpc; else return this.alt_rpc;
        },
        callback_error_handler: function(callback) {
            // parses error messages from chain, seems KeyChain apps expect this
            if (callback) {
                let orig_callback = callback;
                callback = function(response) {
                    if (response && (typeof response.message == 'object') && response.message.message) {
                        response.message = response.message.message;
                    }
                    orig_callback(response);
                }
            }
            return callback;
        },
        not_implemented: function(method, callback) {
            console.log('WhaleVault: '+wallet_name+'.'+method+' not fully implemented');
            if (callback) callback({success: true});
        },
        requestHandshake: function(callback) {
            window.whalevault.requestHandshake(wallet_name, callback);
        },
        requestSignBuffer: function(account_name, message, key_type, callback) {
            window.whalevault.skc_mode = true;
            window.whalevault.requestSignBuffer(wallet_name, use_cid+':'+account_name, message, key_type, use_cid[0]+'kc_signBuf', 'hex', callback);
        },
        requestBroadcast: function(account_name, operations, key_type, callback, rpc) {
            window.whalevault.skc_mode = true;
            callback = this.callback_error_handler(callback);
            const op_obj = {
                operations,
                url: this.get_rpc(rpc)
            };
            if (op_obj.operations.length == 1 && op_obj.operations[0][0] == 'transfer' && op_obj.operations[0][1].memo.startsWith('#')) {
                // handle encryption for memo
                let xfer_op = op_obj.operations[0][1];
                this.requestEncodeMessage(account_name, xfer_op.to, xfer_op.memo, 'memo', function(response) {
                    if (!response.success) callback(response); else {
                      xfer_op.memo = response.result;
                      window.whalevault.requestSignBuffer(wallet_name, use_cid+':'+account_name, op_obj, key_type, use_cid[0]+'kc_broadcast', 'hex', callback);
                    }
                }, rpc);
            } else
            window.whalevault.requestSignBuffer(wallet_name, use_cid+':'+account_name, op_obj, key_type, use_cid[0]+'kc_broadcast', 'hex', callback);
        },
        requestSignedCall: function(account_name, method, params, key_type, callback, rpc) {
            window.whalevault.skc_mode = true;
            callback = this.callback_error_handler(callback);
            const signed_call_obj = {
                jsonrpc: '2.0',
                id: window.whalevault.current_id,
                method,
                params,
                url: this.get_rpc(rpc)
            }
            window.whalevault.requestSignBuffer(wallet_name, use_cid+':'+account_name, signed_call_obj, key_type, use_cid[0]+'kc_signedCall', 'hex', callback);
        },
        requestCustomJson: function(account_name, custom_json_id, key_type, json, display_name, callback, rpc) {
            window.whalevault.skc_mode = true;
            callback = this.callback_error_handler(callback);
            const op_obj = {
                "operations": [
                    [
                      "custom_json",
                      {
                        required_auths: [],
                        required_posting_auths: [],
                        id: custom_json_id,
                        json
                      }
                    ]
                ],
                url: this.get_rpc(rpc)
            };
            if (key_type.toLowerCase() == 'active') op_obj.operations[0][1].required_auths.push(account_name); else
                op_obj.operations[0][1].required_posting_auths.push(account_name);
            window.whalevault.requestSignBuffer(wallet_name, use_cid+':'+account_name, op_obj, key_type, display_name.replace(/[\d.]/g,''), 'hex', callback);
        },
        requestVote: function(account_name, permlink, author, weight, callback, rpc) {
            this.requestBroadcast(account_name, [['vote',{voter:account_name,author,permlink,weight:Number(weight)}]], 'posting', callback, rpc);
        },
        requestPost: function(account_name, title, body, parent_perm, parent_account, json_metadata, permlink, comment_options, callback, rpc) {
            let txs = [['comment',{author:account_name,title,body,parent_permlink:parent_perm,parent_author:parent_account,json_metadata,permlink}]];
            if (typeof comment_options == 'string') {
                if (comment_options === '') comment_options = {}; else
                    comment_options = JSON.parse(comment_options);
            }
            if (Object.keys(comment_options).length > 0) txs.push(['comment_options', comment_options]);
            this.requestBroadcast(account_name, txs, 'posting', callback, rpc);
        },
        requestTransfer: function(account_name, to, amount, memo, currency, callback, enforce = false, rpc) {
            this.requestBroadcast(account_name, [['transfer',{from:account_name,to,amount:Number(amount).toFixed(3)+' '+currency,memo}]], 'active', callback, rpc);
        },
        requestAddAccountAuthority: function(account_name, authorizedUsername, role, weight, callback, rpc) {
            this.not_implemented(arguments.callee.name, callback);
        },
        requestRemoveAccountAuthority: function(account_name, authorizedUsername, role, callback, rpc) {
            this.not_implemented(arguments.callee.name, callback);
        },
        requestAddKeyAuthority: function(account_name, authorizedKey, role, weight, callback, rpc) {
            this.not_implemented(arguments.callee.name, callback);
        },
        requestRemoveKeyAuthority: function(account_name, authorizedKey, role, callback, rpc) {
            this.not_implemented(arguments.callee.name, callback);
        },
        requestDelegation: function(account_name, delegatee, amount, unit, callback, rpc) {
            let places = unit == 'VESTS' ? 6 : 3;
            amount = Number(amount).toFixed(places)+' '+unit;
            this.requestBroadcast(account_name, [['delegate_vesting_shares',{delegator:account_name,delegatee,vesting_shares:amount}]], 'active', callback, rpc);
        },
        requestWitnessVote: function(account_name, witness, vote, callback, rpc) {
            this.requestBroadcast(account_name, [['account_witness_vote',{account:account_name,witness,approve:vote}]], 'active', callback, rpc);
        },
        requestPowerUp: function(account_name, to, amount, callback, rpc) {
            this.requestBroadcast(account_name, [['transfer_to_vesting',{from:account_name,to,amount}]], 'active', callback, rpc);
        },
        requestPowerDown: function(account_name, amount, callback, rpc) {
            this.requestBroadcast(account_name, [['withdraw_vesting',{account:account_name,vesting_shares:amount}]], 'active', callback, rpc);
        },
        requestEncodeMessage: function(account_name, to, message, key, callback, rpc) {
            window.whalevault.skc_mode = true;
            fetch(this.get_rpc(rpc), { method:'POST', mode:'cors', cache:'no-cache', redirect:'follow', 
                                       body: '{"id":0,"jsonrpc":"2.0","method":"call","params":["condenser_api","get_accounts",[["'+to+'"]]]}'})
            .then(response => response.json())
            .then(response => {
                let toPubkey = null;
                if (response.result && response.result.length == 1) {
                    if (key.toLowerCase().startsWith("m")) toPubkey = response.result[0].memo_key; else
                      toPubkey = response.result[0].posting.key_auths[0][0];
                }
                window.whalevault.requestEncryptMemo(wallet_name, use_cid+':'+account_name, message, key, toPubkey, 'stm', use_cid[0]+'kc_encodeMsg', callback);
            });
        },
        requestVerifyMessage: function(account_name, message, key, callback, rpc) {
            window.whalevault.skc_mode = true;
            window.whalevault.requestDecryptMemo(wallet_name, use_cid+':'+account_name, message, key, use_cid[0]+'kc_verifyMsg', callback);
        }
    }
}

// if steem_keychain, hive_keychain, or blurt_keychain not available, offer a minimally-viable WhaleVault "polyfill"
// use *_keychain.alt_rpc to programatically change default rpc endpoint
setTimeout(function() {
    window.wv_set_polyfill('steem_keychain', 'stm', 'https://api.steemit.com');
    window.wv_set_polyfill('hive_keychain', 'hiv', 'https://api.openhive.network');
    window.wv_set_polyfill('blurt_keychain', 'blt', 'https://rpc.blurt.blog');
}, 500);
