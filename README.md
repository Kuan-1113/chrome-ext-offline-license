# Offline license keys for Chrome extensions — no server, no network permission

Sell paid features in a Manifest V3 extension without running a license server,
without asking for host permissions, and without adding a single network request.

Signing happens on your machine. Verification happens in the user's browser,
against a public key embedded in your extension. Nothing talks to anything.

```
you (offline)                        user's browser (offline)
┌──────────────────┐                 ┌────────────────────────────┐
│ private key      │                 │ public key (in the bundle) │
│   ↓ sign         │  key by email   │   ↓ crypto.subtle.verify   │
│ app1:7Gk2….MEUC… │ ──────────────► │ pro features unlocked      │
└──────────────────┘                 └────────────────────────────┘
        no server anywhere in this diagram
```

---

## Why bother, instead of just calling a license API?

Because for a whole category of extension, **the network permission is the product.**

If your listing says "your files never leave your computer", a user can verify
that in five seconds — `chrome://extensions` → Details → Permissions. The moment
you add a license server you need host permissions, and that row stops reading
"no special permissions". You have traded your only defensible claim for a
subscription check.

This repo is the way to keep the claim and still get paid.

Secondary benefits, in case the privacy argument doesn't apply to you:

- **No server to run.** No hosting bill, no uptime obligation, no 3am outage that
  locks out paying customers.
- **Works offline.** Planes, air-gapped machines, flaky hotel wifi.
- **No account.** No email/password, no GDPR data map, no password resets.
- **No latency.** Verification is a local signature check, under a millisecond.

---

## How it works

A license key is two parts joined by a dot:

```
app1:7Gk2Qd91MzWv . MEUCIQD…base64url…
└──── payload ───┘ └─── signature ───┘
```

- **payload** — your prefix plus 12 random characters. It carries no data; it
  only has to be unique and signable.
- **signature** — ECDSA P-256 / SHA-256 over the payload's UTF-8 bytes, as raw
  `r||s` (64 bytes), base64url encoded.

Verification is one `crypto.subtle.verify` call. If it returns true, the key was
signed by your private key. That is the whole security model.

---

## Quick start

### 1. Make a keypair (once, ever)

```bash
pip install cryptography
python tools/keygen.py init
```

Writes `tools/keys/private-key.pem` and `tools/keys/public-key.json`.

> **Back up the private key now, offline.** Lose it and you can never issue
> another valid license for this extension. Leak it and anyone can mint their
> own — and because verification is offline, **you cannot revoke them.**

### 2. Mint some keys

```bash
python tools/keygen.py issue app1: 200
```

Writes a CSV. The keys are deliberately not printed to the terminal — they are
bearer tokens, and terminals end up in scrollback and screenshots.

### 3. Wire it into the extension

Copy `src/license.js` into your extension and paste in your public key:

```js
const License = createLicense({
  publicJwk: { kty: 'EC', crv: 'P-256', x: '…', y: '…', ext: true, key_ops: ['verify'] },
  prefix: 'app1:'
});

// when the user pastes a key
const res = await License.activate(input.value);
if (!res.ok) showError(res.error);

// wherever you gate a feature — do this in the background service worker,
// not only in the UI
if (!(await License.isPro())) return { error: 'This is a paid feature' };
```

`manifest.json` needs nothing added. No permissions, no CSP changes, no
`web_accessible_resources`.

See `example/` for a minimal extension that does all of the above.

### 4. Deliver keys after purchase

Out of scope for this repo — see [What this repo is not](#what-this-repo-is-not).
The short version: keep the minted CSV in a spreadsheet, and have your payment
provider's webhook hand out the first unused row.

---

## Security model, stated honestly

**What this stops:** people inventing their own keys. Forging one means breaking
ECDSA P-256, which is not happening.

**What this does not stop:** a buyer publishing their key. There is no server, so
there is nothing to count activations, nothing to revoke, and nothing to detect
sharing with. **A leaked key works forever, everywhere.**

That is the actual trade, and you should make it deliberately:

| | Offline (this repo) | Server-side licensing |
|---|---|---|
| Revoke a leaked key | ✗ impossible | ✓ |
| Per-seat limits | ✗ impossible | ✓ |
| Needs network permission | ✗ none | ✓ required |
| Server to run | ✗ none | ✓ |
| Works offline | ✓ | ✗ |

If revocation matters more to you than the permission list, use a server. If the
permission list *is* your pitch, use this.

Two things that make the trade cheaper than it looks:

1. **Reuse across machines is a feature, not a leak.** Tell buyers they can use
   their key on every computer they own. It removes your most common support
   ticket, and it costs you nothing you weren't already giving away.
2. **Gate on the server worker, not the UI.** A check in your options page is a
   suggestion. Do the real check where the privileged action happens.

---

## Pitfalls

Each of these cost real time, and none of them produce a useful error message.

**DER vs raw signatures.** Python's `cryptography` returns a DER-encoded
signature. Web Crypto expects raw `r||s`, fixed 32 bytes each for P-256. Hand it
DER and `verify()` returns `false` — no exception, no warning, no hint. Convert
with `decode_dss_signature` (`tools/keygen.py` does).

**Flipping the last base64url character may not break the signature.** 64 bytes
needs 86 base64 characters, but 86 characters can hold 516 bits. The last
character has 2 bits nobody reads, so two different-looking keys can decode to
identical signature bytes. Harmless — but it makes a naive tamper test pass when
you expect it to fail. Test by flipping a character in the *middle*.

**Don't trust a saved `isPro` flag.** Anything in `chrome.storage` is editable by
anyone who can open devtools on your extension. Re-verify the stored key each
time; the check is sub-millisecond, so there is no reason to cache the result.

**Strip whitespace before verifying.** Keys are ~104 characters, email clients
wrap them, and users paste the wrap. Rejecting those is a support ticket, not
security. `license.js` strips all whitespace first.

**Building the payload regex from a template string.** If you assemble the
pattern dynamically, escape the prefix. An unescaped `.` in a prefix matches any
character and quietly widens what counts as valid.

---

## What this repo is not

This is the cryptographic core: minting keys, and verifying them in the browser.
It is complete and tested, and it is the part that is easy to get subtly wrong.

It does **not** include the fulfilment plumbing — the part that is not hard, just
long:

- a webhook that turns "someone paid" into "someone received a key"
- idempotency, so a retried webhook re-sends the *same* key instead of burning a
  second one
- a spreadsheet as the key ledger, with low-stock alerts before you run dry
- routing one webhook endpoint across multiple products
- a licence-entry UI that activates on paste
- an HTML delivery email that people can actually copy a 104-character key out of

If you'd rather not spend the day, the complete kit is here:
**[Offline License Kit for Chrome Extensions](https://7568880033463.gumroad.com/l/pyaegk)** — $29, one-time

Everything in this repository is MIT licensed and stays that way. The kit is
convenience, not a lock.

---

## Testing

```bash
python tools/keygen.py init
python tools/keygen.py issue app1: 3
python -m http.server 8765
# open http://127.0.0.1:8765/tools/_selftest.html
```

14 assertions covering valid keys, tampered payloads, tampered signatures,
signatures swapped between keys, wrong prefixes, whitespace tolerance, and
storage tampering. They run against real Web Crypto in a real browser, because
that is the only environment the result has to be true in.

---

## 繁體中文

**這是什麼:** 讓 Chrome 擴充在**完全不連網**的前提下賣付費功能。你用私鑰在自己電腦上簽授權碼,
擴充內嵌公鑰在本機驗簽,全程沒有伺服器。

**為什麼要這樣做:** 如果你的賣點是「你的檔案不會離開這台電腦」,那**網路權限本身就是產品的一部分**。
使用者可以在 `chrome://extensions` 花五秒鐘驗證。一旦加了授權伺服器,你就得要網路權限,
那一行不再寫著「不需要特殊權限」—— 你用唯一守得住的賣點換到了一個訂閱檢查。

**代價要講清楚:** 沒有伺服器 = 沒辦法撤銷。買家把碼貼上網,那組碼就永遠有效、到處有效,
而且你偵測不到。要能撤銷就得有伺服器。這個取捨要自己想清楚再選。

**一個讓代價變小的做法:** 把「可以在你所有電腦上重複使用」當成功能寫在信裡。
反正你本來就擋不住,不如換掉最常見的那張客服單。

`tools/keygen.py` 產鑰匙跟簽碼,`src/license.js` 放進擴充驗簽,`example/` 是能跑的最小範例。

---

MIT
