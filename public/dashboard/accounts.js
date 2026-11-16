import { h, iconButton } from '/common/ui.js';
import { api } from './api.js';
import { openRemove } from './dialogs.js';
import { ago, money } from './format.js';
import { KINDS, isExchange, kindLogo } from './logos.js';
import { $, actions, state } from './state.js';
import { isOld } from './summary.js';

export function accountStatus(s) {
  if (s.status === null) return ['muted', 'Not read yet'];
  if (s.stale) return ['warn', `Out of date, from ${ago(s.collectedAt)}. ${s.error ?? ''}`];
  if (isOld(s)) return ['muted', `Updated ${ago(s.collectedAt)}. Some balances are from ${ago(s.oldestRead)}`];
  return ['muted', `Updated ${ago(s.collectedAt)}`];
}

export function renderAccounts() {
  $('wallets').replaceChildren(
    ...state.data.sources.map((w) => {
      const exchange = isExchange(w.kind);
      const [tone, status] = accountStatus(w);
      const details = h(
        'div',
        { class: 'details' },
        h('p', { class: tone }, status),
        ...w.warnings.map((text) => h('p', { class: 'muted' }, text)),
      );

      if (state.renaming !== w.id) {
        return h(
          'li',
          {},
          h('span', { class: 'label name' }, kindLogo(w.kind), h('span', {}, w.label)),
          h('span', { class: 'kind muted' }, exchange ? 'Exchange' : KINDS[w.kind]),
          h('span', { class: 'address num muted' }, w.address),
          h('span', { class: 'num' }, w.status === null ? '—' : money(w.value)),
          h(
            'span',
            { class: 'actions' },
            iconButton('pencil', `Rename ${w.label}`, () => {
              state.renaming = w.id;
              renderAccounts();
            }),
            iconButton('trash-2', `Remove ${w.label}`, () => openRemove(w)),
          ),
          details,
        );
      }

      const input = h('input', { value: w.label, maxlength: 40, 'aria-label': 'Wallet name' });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const cancel = () => {
        state.renaming = null;
        renderAccounts();
      };
      const save = async () => {
        try {
          await api(`/api/accounts/${w.id}`, { method: 'PATCH', body: JSON.stringify({ label: input.value }) });
          state.renaming = null;
          await actions.load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      });
      return h(
        'li',
        { class: 'renaming' },
        h('span', { class: 'label name' }, kindLogo(w.kind), input),
        h(
          'span',
          { class: 'actions' },
          iconButton('check', 'Save name', save, 'confirm'),
          iconButton('x', 'Cancel', cancel),
        ),
        error,
      );
    }),
  );
  const input = $('wallets').querySelector('input');
  if (input) {
    input.focus();
    input.select();
  }
}
