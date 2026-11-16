import './dialogs.js';
import './people.js';
import './settings.js';
import './share-dialog.js';
import './views.js';
import { h, skeleton } from '/common/ui.js';
import { renderAccounts } from './accounts.js';
import { api } from './api.js';
import { renderDefi } from './defi.js';
import { showBanner, showInfo } from './feedback.js';
import { renderAllocation, renderHistory } from './overview.js';
import { renderPositions } from './positions.js';
import { renderAccountPanel } from './settings.js';
import { renderSignals } from './signals.js';
import { $, actions, firstRead, hasBalances, state } from './state.js';
import { renderSummary, renderUpdating } from './summary.js';
import { renderCounts } from './views.js';

export let progressTimer;

export function watchProgress() {
  if (progressTimer) return;
  const tick = async () => {
    try {
      const { collecting, progress, update: gate } = await api('/api/progress');
      state.progress = progress;
      if (state.data) {
        state.data.update = gate;
        setPhase(false);
        renderUpdating();
      }
      if (!collecting && !state.updating) {
        progressTimer = null;
        state.progress = null;
        await load();
        return;
      }
    } catch {}
    progressTimer = setTimeout(tick, 1000);
  };
  progressTimer = setTimeout(tick, 300);
}

export function setPhase(redraw = true) {
  const { data } = state;
  const phase = data.sources.length === 0 ? 'empty' : firstRead() ? 'reading' : 'ready';
  const changed = document.body.dataset.state !== phase;
  if (changed) document.body.dataset.state = phase;
  if (!changed && !redraw) return;
  $('facts').removeAttribute('aria-busy');
  $('overview-empty').hidden = hasBalances();
  $('overview-content').hidden = !hasBalances();
  if (hasBalances()) return;
  const failed = data.sources.filter((s) => s.status === 'error').length;
  $('overview-empty').replaceChildren(
    ...(firstRead()
      ? [
          skeleton('sk-strip'),
          h(
            'p',
            { class: 'reading-note' },
            h('b', {}, 'Reading your accounts.'),
            ' Balances appear here as soon as the first update finishes, usually within a minute.',
          ),
        ]
      : [
          h(
            'p',
            { class: 'empty' },
            h('b', {}, 'No balances found yet.'),
            failed
              ? ` ${failed === 1 ? 'One account' : `${failed} accounts`} could not be read. The notice above says why.`
              : ' The accounts added so far hold nothing Stashboard can price.',
            ' Update again, or add another wallet or exchange.',
          ),
        ]),
  );
}

export async function renderAll() {
  setPhase();
  renderSummary();
  renderAccounts();
  renderCounts();
  renderPositions();
  renderSignals();
  renderDefi();
  if (state.data.holdings.length > 0) {
    renderAllocation();
    await renderHistory();
  }
}

export async function load() {
  try {
    const data = await api('/api/portfolio');
    state.build ??= data.build;
    if (data.build !== state.build) {
      location.reload();
      return;
    }
    state.data = data;
    state.hideAmounts = data.preferences.hideAmounts;
    state.progress = data.progress ?? state.progress;
    state.logos = new Map(Object.entries(data.logos.available));
    state.chainNames = data.logos.chains;
    $('banner').hidden = true;

    await renderAll();
    if (data.demo && !state.demoNoticed) {
      state.demoNoticed = true;
      showInfo('This is demo data. Nothing in it is real, and updates and new accounts are off.');
    }
    if ($('account').open) renderAccountPanel();
    if (data.collecting) watchProgress();
  } catch (err) {
    showBanner(err);
  }
}

export async function update() {
  if (state.updating) return;
  state.updating = true;
  if (state.data) renderUpdating();
  watchProgress();
  let failure = null;
  try {
    await api('/api/collect', { method: 'POST', body: '{}' });
  } catch (err) {
    if (err.status !== 429) failure = err;
  }
  state.updating = false;
  state.progress = null;
  await load();
  if (failure) showBanner(failure);
  else setTimeout(load, 20000);
}

$('collect').addEventListener('click', update);
$('sign-out').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  location.replace('/login');
});
setInterval(load, 5 * 60 * 1000);

Object.assign(actions, { load, renderAll, watchProgress });
load();
