import { checkFilled, checkLength, validate } from '/common/checks.js';
import { h, icon, segmented as segmentedControl, select } from '/common/ui.js';
import { api } from './api.js';
import { colorOf } from './colors.js';
import { showInfo } from './feedback.js';
import { SOURCES } from './help.js';
import { EVM_CHAINS, EXCHANGES, chainStack, exchangeStack, isExchange, kindLogo, walletStack } from './logos.js';
import { $, actions, state } from './state.js';

export function setError(id, message) {
  const el = $(id);
  el.textContent = message ?? '';
  el.hidden = !message;
}

for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export async function submitDialog(form, errorId, request) {
  const buttons = [...form.querySelectorAll('button')];
  setError(errorId, null);
  buttons.forEach((b) => (b.disabled = true));
  try {
    await request();
    form.closest('dialog').close();
    return true;
  } catch (err) {
    setError(errorId, err.message);
    return false;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

const NETWORKS = [
  ['evm', /^0x[0-9a-fA-F]{40}$/, 'EVM', 'all chains at once'],
  ['ton', /^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/, 'TON', 'GRAM and verified jettons'],
  ['solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Solana', null],
];

const addForm = $('add-form');
let addKind = 'wallet';
const KEY_HELP = {
  binance: {
    lead: 'Create a key with only ',
    mark: 'Enable Reading',
    rest: ' ticked, and leave IP access unrestricted.',
    source: SOURCES.binanceKeys,
  },
  bybit: {
    lead: 'Create a system-generated key with ',
    mark: 'Read-Only',
    rest: ' permissions, and tick every box it offers so Funding and Earn are read too.',
    source: SOURCES.bybitKeys,
  },
  okx: {
    lead: 'Create a key with only the ',
    mark: 'Read',
    rest: ' permission, and leave its IP address empty. Enter the passphrase you chose for the key.',
    source: SOURCES.okxKeys,
  },
  gate: {
    lead: 'Create an APIv4 key on the main account and set Spot Trading, Perpetual Futures, Margin Trading (Unified Account), Earn, Wallets and Account to ',
    mark: 'Read Only',
    rest: '. Leave Withdraw off. Account lets the key be checked, and Margin Trading lets a unified account be read.',
    source: SOURCES.gateKeys,
  },
  bingx: {
    lead: 'Create a key with only ',
    mark: 'Read',
    rest: ' ticked, and leave the IP address empty.',
    source: SOURCES.bingxKeys,
  },
};
const NEEDS_PASSPHRASE = new Set(['okx']);

let exchangeChoice = null;

function buildExchangeChoice(value = 'binance') {
  exchangeChoice = select({
    label: 'Exchange',
    options: Object.entries(EXCHANGES).map(([kind, label]) => ({ value: kind, label, media: () => kindLogo(kind) })),
    value,
    onChange: setExchange,
  });
  $('exchange-select').replaceChildren(exchangeChoice);
}
buildExchangeChoice();

function setExchange(kind) {
  const help = KEY_HELP[kind];
  $('exchange-hint').replaceChildren(
    help.lead,
    h('b', {}, help.mark),
    help.rest,
    ' The secret is stored encrypted. ',
    h(
      'a',
      { href: help.source.href, target: '_blank', rel: 'noopener noreferrer' },
      `How to create an API key on ${EXCHANGES[kind]}`,
      icon('external-link'),
    ),
  );
  renderIpNote(state.data?.ipRequired[kind]);
  $('passphrase-field').hidden = !NEEDS_PASSPHRASE.has(kind);
  if (addKind === 'exchange') addForm.label.placeholder = `Optional, for example ${EXCHANGES[kind]} main`;
}
setExchange(exchangeChoice.value);

function renderIpNote(reason) {
  const box = $('exchange-ip');
  box.hidden = !reason;
  const address = state.data?.serverAddress;
  if (!reason) return box.replaceChildren();
  if (!address) {
    return box.replaceChildren(
      h('p', {}, reason, ' Bind it to the public IP address of the server Stashboard runs on to keep it working.'),
    );
  }
  const value = h('code', { class: 'ip-address num' }, address);
  const copy = h(
    'button',
    {
      class: 'button',
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(address);
          copy.replaceChildren(icon('check'), 'Copied');
        } catch {
          getSelection().selectAllChildren(value);
        }
      },
    },
    icon('copy'),
    'Copy',
  );
  box.replaceChildren(
    h('p', {}, reason, " Bind it to this server's address to keep it working."),
    h('div', { class: 'ip-row' }, value, copy),
  );
}

function setAddKind(kind) {
  addKind = kind;
  $('add-kind').replaceChildren(
    segmentedControl({
      label: 'What to add',
      options: [
        ['wallet', 'Wallet', walletStack()],
        ['exchange', 'Exchange', exchangeStack()],
      ],
      value: kind,
      onChange: setAddKind,
    }),
  );
  $('wallet-fields').hidden = kind !== 'wallet';
  $('exchange-fields').hidden = kind !== 'exchange';
  $('add-submit').textContent = kind === 'wallet' ? 'Add wallet' : 'Add exchange';
  addForm.label.placeholder =
    kind === 'wallet'
      ? 'Optional, for example Ledger'
      : `Optional, for example ${EXCHANGES[exchangeChoice.value]} main`;
  setError('add-error', null);
  (kind === 'wallet' ? addForm.address : addForm.apiKey).focus();
}

function showDetected() {
  const address = addForm.address.value.trim();
  const found = NETWORKS.find(([, pattern]) => pattern.test(address));
  $('address-logo').replaceChildren(found ? kindLogo(found[0]) : icon('wallet'));
  if (!found) {
    $('detected').replaceChildren(
      ...(address
        ? [h('span', {}, 'This does not look like an EVM, Solana or TON address yet.')]
        : [walletStack(), h('span', {}, 'The network is recognised from the address.')]),
    );
    return;
  }
  $('detected').replaceChildren(
    ...[
      found[0] === 'evm' && chainStack(Object.keys(EVM_CHAINS)),
      h('span', {}, h('b', {}, found[2]), found[3] && `: ${found[3]}`),
    ].filter(Boolean),
  );
}

export function renderAddLogos() {
  for (const slot of document.querySelectorAll('[data-logos]')) {
    slot.replaceChildren(...[slot.dataset.logos === 'wallet' ? walletStack() : exchangeStack()].filter(Boolean));
  }
}

addForm.address.addEventListener('input', showDetected);

let replacing = null;

function setReplacing(account) {
  replacing = account;
  $('add-kind').hidden = Boolean(account);
  $('exchange-field').hidden = Boolean(account);
  $('label-field').hidden = Boolean(account);
  $('replace-text').hidden = !account;
  $('add-title').textContent = account ? `New key for ${account.label}` : 'Add wallet or exchange';
  if (!account) return;
  $('replace-text').textContent = `Use a key of the same ${EXCHANGES[account.kind]} account. Its history stays.`;
  $('add-submit').textContent = 'Replace key';
}

export function openAdd(kind = 'wallet') {
  addForm.reset();
  buildExchangeChoice();
  setExchange(exchangeChoice.value);
  showDetected();
  setReplacing(null);
  $('add-dialog').showModal();
  setAddKind(kind);
}

export function openReplaceKey(account) {
  addForm.reset();
  buildExchangeChoice(account.kind);
  setExchange(account.kind);
  $('add-dialog').showModal();
  setAddKind('exchange');
  setReplacing(account);
}

for (const trigger of document.querySelectorAll('[data-open-add]')) {
  trigger.addEventListener('click', () => openAdd(trigger.dataset.openAdd || 'wallet'));
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = addForm.label.value.trim();
  const exchange = exchangeChoice.value;
  const passphrase = (value) => (value ? null : 'Enter the passphrase you set when you created the key.');
  const checks =
    addKind === 'wallet'
      ? [['address', checkFilled('Enter a wallet address.')]]
      : [
          ['apiKey', checkFilled('Paste the API key.')],
          ['apiSecret', checkFilled('Paste the secret key.')],
          ...(NEEDS_PASSPHRASE.has(exchange) ? [['passphrase', passphrase]] : []),
        ];
  if (!validate(addForm, [...checks, ['label', checkLength(40, 'a name')]], (m) => setError('add-error', m))) return;
  let warning = null;
  const added = await submitDialog(addForm, 'add-error', async () => {
    if (addKind === 'wallet') {
      await api('/api/wallets', {
        method: 'POST',
        body: JSON.stringify({ address: addForm.address.value.trim(), label }),
      });
      return;
    }
    const keys = {
      apiKey: addForm.apiKey.value.trim(),
      apiSecret: addForm.apiSecret.value.trim(),
      ...(NEEDS_PASSPHRASE.has(exchange) ? { passphrase: addForm.passphrase.value } : {}),
    };
    const result = replacing
      ? await api(`/api/accounts/${replacing.id}/key`, { method: 'PUT', body: JSON.stringify(keys) })
      : await api('/api/exchanges', { method: 'POST', body: JSON.stringify({ exchange, ...keys, label }) });
    warning = result.warning;
  });
  addForm.apiSecret.value = '';
  addForm.passphrase.value = '';
  if (!added) return;
  await actions.load();
  if (warning) showInfo(warning);
});

let removing = null;

export function openRemove(account) {
  removing = account;
  const exchange = isExchange(account.kind);
  setError('remove-error', null);
  $('remove-title').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-submit').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-text').replaceChildren(
    h('b', {}, account.label),
    ` (${account.address}). `,
    exchange
      ? 'Its history and API key are deleted. Nothing changes on the exchange.'
      : 'Its history is deleted. Nothing changes on chain.',
  );
  $('remove-dialog').showModal();
}

$('remove-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const removed = await submitDialog(event.currentTarget, 'remove-error', () =>
    api(`/api/accounts/${removing.id}`, { method: 'DELETE' }),
  );
  if (removed) await actions.load();
});

let categorising = null;

const CATEGORY_SOURCE = {
  manual: 'You chose this category.',
  auto: 'This category was looked up on CoinGecko.',
};

export function openCategory(asset) {
  categorising = asset;
  setError('category-error', null);
  $('category-title').textContent = `Category for ${asset.key}`;
  $('category-text').textContent =
    CATEGORY_SOURCE[asset.source] ??
    (asset.category === 'Other'
      ? 'No category was found for this asset.'
      : 'This category comes from the built-in rules.');
  $('category-choices').replaceChildren(
    ...state.data.categories.map((name) =>
      h(
        'label',
        {},
        h('input', { type: 'radio', name: 'category', value: name, checked: name === asset.category }),
        h('span', { class: 'swatch', style: { background: colorOf('category', name) } }),
        name,
      ),
    ),
  );
  $('category-auto').hidden = asset.source !== 'manual';
  $('category-dialog').showModal();
}

async function saveCategory(category) {
  const saved = await submitDialog($('category-form'), 'category-error', () =>
    api(`/api/assets/${encodeURIComponent(categorising.key)}/category`, {
      method: 'PUT',
      body: JSON.stringify({ category }),
    }),
  );
  if (saved) await actions.load();
}

$('category-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveCategory(new FormData(event.currentTarget).get('category'));
});
$('category-auto').addEventListener('click', () => saveCategory(null));
