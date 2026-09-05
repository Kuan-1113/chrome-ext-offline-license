/**
 * Offline license verification for Chrome extensions (Manifest V3).
 *
 * A license key is signed by your private key and verified in the browser
 * against an embedded public key. There is no license server, so the
 * extension needs no host permissions and no network access at all —
 * which means a privacy claim like "your files never leave your computer"
 * survives the introduction of paid features.
 *
 * Key format:  <prefix><random>.<base64url signature>
 *   payload    = prefix + 12 random URL-safe chars   e.g. "app1:7Gk2Qd91MzWv"
 *   signature  = ECDSA P-256 / SHA-256 over the UTF-8 bytes of the payload,
 *                as raw r||s (64 bytes), base64url encoded
 *
 * Works in both service workers and extension pages (no DOM dependency).
 *
 * Usage:
 *   const License = createLicense({
 *     publicJwk: { kty: 'EC', crv: 'P-256', x: '...', y: '...', ext: true, key_ops: ['verify'] },
 *     prefix: 'app1:'
 *   });
 *   await License.activate(userInput);   // -> { ok: true } | { ok: false, error }
 *   await License.isPro();               // -> boolean
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createLicense = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
  var SIGN = { name: 'ECDSA', hash: { name: 'SHA-256' } };

  function escapeForRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function base64urlToBytes(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function createLicense(options) {
    if (!options || !options.publicJwk) throw new Error('createLicense: publicJwk is required');
    if (!options.prefix) throw new Error('createLicense: prefix is required');

    var publicJwk  = options.publicJwk;
    var storageKey = options.storageKey || 'licenseKey';
    var storage    = options.storage ||
      (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null);
    if (!storage) throw new Error('createLicense: no storage available');

    // Built once from the prefix. Note we escape the prefix rather than
    // interpolating it raw — a prefix containing "." would otherwise match
    // any character and quietly widen what counts as a valid payload.
    var payloadRe = new RegExp('^' + escapeForRegExp(options.prefix) + '[A-Za-z0-9_-]{8,64}$');

    var keyPromise = null;
    function getPublicKey() {
      if (!keyPromise) {
        keyPromise = crypto.subtle.importKey('jwk', publicJwk, ALGO, true, ['verify']);
      }
      return keyPromise;
    }

    /**
     * Is this string a license we signed?
     *
     * Whitespace is stripped first: keys are long enough that email clients
     * wrap them, and users paste the wrap. Rejecting those is a support
     * ticket, not security.
     */
    async function verify(raw) {
      try {
        var key = String(raw == null ? '' : raw).replace(/\s+/g, '');
        var dot = key.lastIndexOf('.');
        if (dot < 1) return false;

        var payload = key.slice(0, dot);
        if (!payloadRe.test(payload)) return false;

        var sig = base64urlToBytes(key.slice(dot + 1));
        if (sig.length !== 64) return false;   // P-256 raw r||s is always 64 bytes

        return await crypto.subtle.verify(
          SIGN, await getPublicKey(), sig, new TextEncoder().encode(payload));
      } catch (e) {
        return false;
      }
    }

    /**
     * Re-verifies the stored key every time rather than trusting a saved
     * "isPro" flag. Extension storage is writable by anyone who can open
     * devtools on the extension, so a boolean there means nothing.
     */
    async function isPro() {
      var got = await storage.get(storageKey);
      var stored = got && got[storageKey];
      if (!stored) return false;
      return verify(stored);
    }

    async function activate(raw) {
      var key = String(raw == null ? '' : raw).replace(/\s+/g, '');
      if (!(await verify(key))) return { ok: false, error: 'invalid license key' };
      var patch = {};
      patch[storageKey] = key;
      await storage.set(patch);
      return { ok: true };
    }

    async function deactivate() {
      await storage.remove(storageKey);
    }

    return { verify: verify, isPro: isPro, activate: activate, deactivate: deactivate };
  }

  return createLicense;
});
