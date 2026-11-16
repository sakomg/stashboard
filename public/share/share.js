import { h } from '/common/ui.js';

const $ = (id) => document.getElementById(id);

const token = location.pathname.split('/')[2] ?? '';
const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (n) => `${(n * 100).toFixed(1)}%`;
const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function monogram(label) {
  return h(
    'span',
    { class: 'logo mono', 'aria-hidden': 'true' },
    label
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 2)
      .toUpperCase() || '?',
  );
}

function logo(row) {
  if (!row.logo) return null;
  const img = h('img', {
    class: 'logo',
    src: `/s/${encodeURIComponent(token)}/logo/${row.logo.kind}/${encodeURIComponent(row.logo.key)}`,
    alt: '',
    width: 20,
    height: 20,
  });
  img.addEventListener('error', () => img.replaceWith(monogram(row.name)));
  return img;
}

async function main() {
  let data;
  try {
    const response = await fetch(`/api/shared/${encodeURIComponent(token)}`);
    data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'This link does not work.');
  } catch (err) {
    $('share-title').textContent = 'This link is not available';
    $('share-meta').textContent = err.message;
    return;
  }

  document.title = data.title;
  $('share-title').textContent = data.title;
  $('share-meta').textContent =
    `A snapshot from ${longDate(data.createdAt)}. The link works until ${longDate(data.expiresAt)}.`;
  const netWorth = data.netWorth ?? null;
  if (netWorth !== null) {
    $('share-total').textContent = `Net worth ${usd(netWorth)}`;
    $('share-total').hidden = false;
    if (data.total !== null && data.borrowed >= 0.005) {
      $('share-breakdown').textContent = `Held ${usd(data.total)}, borrowed ${usd(data.borrowed)}`;
      $('share-breakdown').hidden = false;
    }
  } else if (data.total !== null) {
    $('share-total').textContent = `Total held ${usd(data.total)}`;
    $('share-total').hidden = false;
  }
  $('strip').replaceChildren(
    ...data.rows.map((r) => h('span', { style: { flex: `${r.share} 1 0`, background: r.color } })),
  );
  $('strip').setAttribute('aria-label', data.rows.map((r) => `${r.name} ${percent(r.share)}`).join(', '));
  $('legend').replaceChildren(
    ...data.rows.map((r) =>
      h(
        'li',
        {},
        h('span', { class: 'swatch', style: { background: r.color } }),
        h('span', { class: 'name' }, logo(r), h('span', {}, r.name)),
        h('span', { class: 'num' }, r.value === null ? '' : usd(r.value)),
        h('span', { class: 'num share' }, percent(r.share)),
      ),
    ),
  );
}

main();
