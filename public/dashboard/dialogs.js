import { h, icon, segmented as segmentedControl, select } from '/common/ui.js';
import { api } from './api.js';
import { colorOf } from './colors.js';
import { showInfo } from './feedback.js';
import { SOURCES } from './help.js';
import { kindLogo } from './logos.js';
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

export const NETWORKS = [
  [
    'evm',
    /^0x[0-9a-fA-F]{40}$/,
    'EVM address. Ethereum, Base, Arbitrum, BNB Chain and the other EVM chains are read at once.',
  ],
  ['ton', /^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/, 'TON address.'],
  ['solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Solana address.'],
];

export const addForm = $('add-form');
export let addKind = 'wallet';
export const exchangeChoice = select({
  label: 'Exchange',
  options: [{ value: 'binance', label: 'Binance' }],
  value: 'binance',
});
$('exchange-select').append(exchangeChoice);
$('exchange-hint').replaceChildren(
  'Create a key with only ',
  h('b', {}, 'Enable Reading'),
  " ticked and restrict it to this server's IP address. The key is checked before it is saved, and the secret is stored encrypted on this server. ",
  h(
    'a',
    { href: SOURCES.binanceKeys.href, target: '_blank', rel: 'noopener noreferrer' },
    'How to create an API key',
    icon('external-link'),
  ),
);

export function setAddKind(kind) {
  addKind = kind;
  $('add-kind').replaceChildren(
    segmentedControl({
      label: 'What to add',
      options: [
        ['wallet', 'Wallet'],
        ['exchange', 'Exchange'],
      ],
      value: kind,
      onChange: setAddKind,
    }),
  );
  $('wallet-fields').hidden = kind !== 'wallet';
  $('exchange-fields').hidden = kind !== 'exchange';
  $('add-submit').textContent = kind === 'wallet' ? 'Add wallet' : 'Add exchange';
  addForm.label.placeholder = kind === 'wallet' ? 'Optional, for example Ledger' : 'Optional, for example Binance main';
  setError('add-error', null);
  (kind === 'wallet' ? addForm.address : addForm.apiKey).focus();
}

export function showDetected() {
  const address = addForm.address.value.trim();
  const found = NETWORKS.find(([, pattern]) => pattern.test(address));
  $('detected').replaceChildren(
    ...(found
      ? [kindLogo(found[0]), h('span', {}, found[2])]
      : [
          address
            ? 'This does not look like an EVM, Solana or TON address yet.'
            : 'The network is recognised from the address.',
        ]),
  );
}

addForm.address.addEventListener('input', showDetected);

export function openAdd(kind = 'wallet') {
  addForm.reset();
  showDetected();
  $('add-dialog').showModal();
  setAddKind(kind);
}

for (const trigger of document.querySelectorAll('[data-open-add]')) {
  trigger.addEventListener('click', () => openAdd(trigger.dataset.openAdd || 'wallet'));
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = addForm.label.value.trim();
  let warning = null;
  const added = await submitDialog(addForm, 'add-error', async () => {
    if (addKind === 'wallet') {
      if (!addForm.address.value.trim()) throw new Error('Enter a wallet address');
      await api('/api/wallets', {
        method: 'POST',
        body: JSON.stringify({ address: addForm.address.value.trim(), label }),
      });
      return;
    }
    if (!addForm.apiKey.value.trim() || !addForm.apiSecret.value.trim()) {
      throw new Error('Paste both the API key and the secret key');
    }
    const result = await api('/api/exchanges', {
      method: 'POST',
      body: JSON.stringify({
        exchange: exchangeChoice.value,
        apiKey: addForm.apiKey.value.trim(),
        apiSecret: addForm.apiSecret.value.trim(),
        label,
      }),
    });
    warning = result.warning;
  });
  addForm.apiSecret.value = '';
  if (!added) return;
  await actions.load();
  if (warning) showInfo(warning);
});

export let removing = null;

export function openRemove(account) {
  removing = account;
  const exchange = account.kind === 'binance';
  setError('remove-error', null);
  $('remove-title').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-submit').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-text').replaceChildren(
    h('b', {}, account.label),
    exchange
      ? ` (${account.address}) leaves the dashboard together with its recorded history and its stored API key. Nothing changes on the exchange. You can also delete the key there.`
      : ` (${account.address}) leaves the dashboard together with its recorded history. Nothing changes on chain, and you can add the wallet again later.`,
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

export let categorising = null;

export const CATEGORY_SOURCE = {
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

export async function saveCategory(category) {
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
