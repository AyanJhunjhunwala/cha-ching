import { connect } from '../session.js';
import { SPORTS } from '../sports.js';
import { saveCreds, clearCreds } from '../store.js';
import { h, logo, svgIcon, toast } from './dom.js';

const listLabels = (labels) => (labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0]);

/**
 * Sign-in with a Kalshi API key: key ID + private key (paste or import file).
 * @param {{onConnected:(session:object)=>void, initial?:object, error?:string}} opts
 */
export function renderAuth(root, { onConnected, initial = {}, error = '' }) {
  let env = initial.env ?? 'live';

  const keyIdInput = h('input', {
    id: 'key-id',
    class: 'input mono',
    placeholder: 'e.g. a952bcbe-ec3b-4b5b-b8f9-11dae589608c',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: initial.keyId ?? '',
  });
  const pemInput = h('textarea', {
    id: 'private-key',
    class: 'input mono key-area',
    placeholder: '-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    rows: 5,
  });
  pemInput.value = initial.pem ?? '';

  const fileInput = h('input', {
    type: 'file',
    accept: '.pem,.key,.txt,text/plain,application/x-pem-file',
    class: 'visually-hidden',
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      pemInput.value = (await file.text()).trim();
      fileInput.value = '';
      setError('');
    },
  });

  const remember = h('input', { type: 'checkbox', id: 'remember', checked: initial.remember ?? true });
  const errorEl = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Connect to Kalshi');

  const envButtons = ['live', 'demo'].map((value) =>
    h('button', {
      type: 'button',
      class: 'seg-btn',
      'aria-pressed': String(env === value),
      onclick: () => {
        env = value;
        envButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.env === env)));
      },
      'data-env': value,
    }, value === 'live' ? 'Live money' : 'Demo'),
  );

  function setError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }
  setError(error);

  async function onSubmit(event) {
    event.preventDefault();
    const keyId = keyIdInput.value.trim();
    const pem = pemInput.value.trim();
    if (!keyId) return setError('Enter your API key ID.');
    if (!pem) return setError('Paste or import your private key.');

    setError('');
    submit.disabled = true;
    submit.textContent = 'Connecting…';
    try {
      const session = await connect({ keyId, pem, env });
      if (remember.checked) {
        const saved = await saveCreds({ keyId, pem, env });
        if (saved === false) toast("Signed in, but this device can't store your key securely, so you'll need to sign in again next time.", 'error');
      } else {
        await clearCreds();
      }
      onConnected(session);
    } catch (err) {
      setError(err.message || 'Could not connect.');
      submit.disabled = false;
      submit.textContent = 'Connect to Kalshi';
    }
  }

  root.append(
    h('main', { class: 'screen auth' },
      h('header', { class: 'auth-hero' },
        logo(56),
        h('h1', null, 'Cha-Ching'),
        h('p', { class: 'muted' }, `Trade live ${listLabels(SPORTS.map((s) => s.label))} games on Kalshi.`),
      ),
      h('form', { class: 'card auth-card', onsubmit: onSubmit, novalidate: true },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Environment' }, envButtons),
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'API key ID'),
          keyIdInput,
        ),
        h('div', { class: 'field' },
          h('div', { class: 'field-row' },
            h('label', { class: 'field-label', for: 'private-key' }, 'Private key'),
            h('button', { type: 'button', class: 'link-btn', onclick: () => fileInput.click() }, svgIcon('key'), 'Import file'),
          ),
          pemInput,
          fileInput,
        ),
        h('label', { class: 'check' }, remember, h('span', null, 'Remember on this device')),
        errorEl,
        submit,
      ),
      h('footer', { class: 'auth-help muted' },
        h('p', null, 'Create a key at kalshi.com → Account & security → API keys. Kalshi shows the private key once, so save the file it gives you.'),
        h('p', null, 'Your key never leaves this device. Requests are signed on your phone and sent straight to Kalshi.'),
      ),
    ),
  );
  (initial.keyId ? pemInput : keyIdInput).focus({ preventScroll: true });
}
