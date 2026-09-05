importScripts('license.js', 'license-config.js');

const License = createLicense(LICENSE_CONFIG);

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/**
 * The gate that matters.
 *
 * Anything in the options page is a suggestion — the user controls that page and
 * can edit it in devtools. Do the real check here, in the service worker, right
 * where the paid work would actually happen. A UI check on top of this is fine;
 * a UI check *instead* of this is a paywall you can click through.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DO_PRO_THING') {
    (async () => {
      if (!(await License.isPro())) {
        sendResponse({ ok: false, error: 'This is a paid feature', needPro: true });
        return;
      }
      sendResponse({ ok: true, result: 'pro work done' });
    })();
    return true;   // keep the message channel open for the async reply
  }
});
