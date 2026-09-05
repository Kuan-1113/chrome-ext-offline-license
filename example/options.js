const License = createLicense(LICENSE_CONFIG);
const $ = (id) => document.getElementById(id);

async function paint() {
  const pro = await License.isPro();
  $('plan').textContent = pro ? 'Pro' : 'Free';
  $('plan').classList.toggle('pro', pro);
  $('free').hidden = pro;
  $('pro').hidden = !pro;
}

async function activate() {
  const msg = $('msg');
  const res = await License.activate($('key').value);
  msg.className = 'msg ' + (res.ok ? 'good' : 'bad');
  msg.textContent = res.ok
    ? 'Activated.'
    : res.error + ' — make sure you copied the whole key, including the dot.';
  await paint();
}

$('activate').onclick = activate;

// Activate on paste. The key is ~104 characters; making someone paste it and
// *then* hunt for a button is a step you can simply delete. The paste event
// fires before the value lands, hence the next-tick hop.
$('key').addEventListener('paste', () => setTimeout(activate, 0));
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });

$('remove').onclick = async () => {
  await License.deactivate();
  $('key').value = '';
  $('msg').textContent = '';
  await paint();
};

// Note this asks the service worker rather than checking License.isPro() here.
// The page can be edited by the user; the worker's answer is the one that counts.
$('try').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: 'DO_PRO_THING' });
  $('result').className = 'msg ' + (res.ok ? 'good' : 'bad');
  $('result').textContent = res.ok ? res.result : res.error;
};

paint();
