import { h, select } from '/common/ui.js';
import { api } from './api.js';
import { setError } from './dialogs.js';
import { percent, usd } from './format.js';
import { DIMENSIONS, groups, segmented, totals } from './overview.js';
import { shareUrl } from './settings.js';
import { $, state } from './state.js';

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 675;
export const SHARE_SCALE = 2;
export let shareTicket = 0;
export let shareBlob = null;

export const shareTitle = (dimension) =>
  `Allocation by ${DIMENSIONS.find(([id]) => id === dimension)[1].toLowerCase()}`;
export const shareFileName = () => `stashboard-${state.shareDimension}-${new Date().toISOString().slice(0, 10)}.png`;
export const longDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
export const hasDebt = (borrowed) => borrowed >= 0.005;
export const breakdown = ({ held, borrowed }) => `Held ${usd(held)}, borrowed ${usd(borrowed)}`;

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function logoSource(spec) {
  const version = spec && state.logos.get(`${spec.kind}/${spec.key}`);
  return version ? `/logo/${spec.kind}/${encodeURIComponent(spec.key)}?v=${version}` : null;
}

export function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function drawShareCard({ title, rows, sums, withAmounts }) {
  const ticket = ++shareTicket;
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const display = '"Bricolage Grotesque", system-ui, sans-serif';
  const body = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  await Promise.all([document.fonts.load(`600 52px ${display}`), document.fonts.load(`650 28px ${display}`)]).catch(
    () => {},
  );
  const [mark, ...logos] = await Promise.all([
    loadImage('/logo.svg'),
    ...rows.map((r) => loadImage(logoSource(r.logo))),
  ]);
  if (ticket !== shareTicket) return;

  const canvas = $('share-canvas');
  canvas.width = SHARE_WIDTH * SHARE_SCALE;
  canvas.height = SHARE_HEIGHT * SHARE_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(SHARE_SCALE, 0, 0, SHARE_SCALE, 0, 0);
  const pad = 64;
  const inner = SHARE_WIDTH - 2 * pad;

  ctx.fillStyle = token('--ink');
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);

  if (mark) ctx.drawImage(mark, pad, 50, 36, 36);
  ctx.font = `650 28px ${display}`;
  ctx.fillStyle = token('--amber');
  ctx.fillText('stash', pad + 48, 78);
  ctx.fillStyle = token('--slate');
  ctx.fillText('board', pad + 49 + ctx.measureText('stash').width, 78);
  ctx.font = `400 22px ${body}`;
  ctx.textAlign = 'right';
  ctx.fillText(longDate(new Date()), SHARE_WIDTH - pad, 78);
  ctx.textAlign = 'left';

  ctx.font = `600 52px ${display}`;
  ctx.fillStyle = token('--bone');
  ctx.fillText(title, pad, 168);
  let top = 210;
  if (withAmounts) {
    ctx.font = `400 24px ${body}`;
    ctx.fillStyle = token('--slate');
    ctx.fillText(`Net worth ${usd(sums.netWorth)}`, pad, 210);
    top = 236;
    if (hasDebt(sums.borrowed)) {
      ctx.font = `400 20px ${body}`;
      ctx.fillText(breakdown(sums), pad, 240);
      top = 266;
    }
  }

  const height = 64;
  const gap = 4;
  const slices = rows.filter((r) => r.slice > 0);
  const usable = inner - gap * (slices.length - 1);
  let before = 0;
  slices.forEach((r, i) => {
    const x = pad + before * usable + i * gap;
    const width = i === slices.length - 1 ? pad + inner - x : Math.max(3, r.slice * usable);
    before += r.slice;
    const left = i === 0 ? height / 2 : 6;
    const right = i === slices.length - 1 ? height / 2 : 6;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.roundRect(x, top, width, height, [left, right, right, left]);
    ctx.fill();
  });

  const columnGap = 64;
  const columnWidth = (inner - columnGap) / 2;
  const perColumn = Math.max(1, Math.ceil(rows.length / 2));
  const legendTop = top + height + 64;
  rows.forEach((r, i) => {
    const column = i < perColumn ? 0 : 1;
    const x = pad + column * (columnWidth + columnGap);
    const y = legendTop + (i - column * perColumn) * 54;
    const end = x + columnWidth;

    ctx.beginPath();
    if (r.value < 0) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.roundRect(x + 1, y - 16, 14, 14, 3);
      ctx.stroke();
    } else {
      ctx.fillStyle = r.color;
      ctx.roundRect(x, y - 17, 16, 16, 4);
      ctx.fill();
    }

    let nameX = x + 32;
    if (r.logo) {
      const img = logos[i];
      ctx.save();
      ctx.beginPath();
      ctx.arc(nameX + 15, y - 9, 15, 0, Math.PI * 2);
      ctx.clip();
      if (img) ctx.drawImage(img, nameX, y - 24, 30, 30);
      else {
        ctx.fillStyle = token('--raised');
        ctx.fillRect(nameX, y - 24, 30, 30);
        ctx.fillStyle = token('--slate');
        ctx.font = `600 12px ${body}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          r.name
            .replace(/[^\p{L}\p{N}]/gu, '')
            .slice(0, 2)
            .toUpperCase(),
          nameX + 15,
          y - 4,
        );
        ctx.textAlign = 'left';
      }
      ctx.restore();
      nameX += 42;
    }

    ctx.textAlign = 'right';
    ctx.font = `600 26px ${display}`;
    ctx.fillStyle = token('--bone');
    const share = percent(r.share);
    ctx.fillText(share, end, y);
    let nameEnd = end - ctx.measureText(share).width - 20;
    if (withAmounts) {
      ctx.font = `400 22px ${body}`;
      ctx.fillStyle = token('--slate');
      const value = usd(r.value);
      ctx.fillText(value, nameEnd, y);
      nameEnd -= ctx.measureText(value).width + 20;
    }
    ctx.textAlign = 'left';
    ctx.font = `500 26px ${body}`;
    ctx.fillStyle = token('--bone');
    ctx.fillText(fitText(ctx, r.name, nameEnd - nameX), nameX, y);
  });

  canvas.setAttribute('aria-label', `${title}: ${rows.map((r) => `${r.name} ${percent(r.share)}`).join(', ')}`);
  shareBlob = new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made'))), 'image/png'),
  );
}

export const shareDays = select({
  label: 'Link lasts',
  options: [
    { value: '1', label: '1 day' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
  ],
  value: '7',
});
$('share-days').replaceWith(shareDays);

export function shareStatus(...content) {
  $('share-status').replaceChildren(...content);
}

export function renderShare() {
  segmented('share-dimension', DIMENSIONS, state.shareDimension, (id) => {
    state.shareDimension = id;
    renderShare();
  });
  shareStatus();
  setError('share-error', null);
  return drawShareCard({
    title: shareTitle(state.shareDimension),
    rows: groups(state.shareDimension),
    sums: totals(),
    withAmounts: $('share-amounts').checked,
  });
}

export function canShareFiles() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  } catch {
    return false;
  }
}

$('open-share').addEventListener('click', () => {
  state.shareDimension = state.dimension;
  $('share-amounts').checked = !state.hideAmounts;
  $('share-native').hidden = !canShareFiles();
  $('share-dialog').showModal();
  renderShare();
});

$('share-amounts').addEventListener('change', renderShare);

$('share-copy').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareBlob })]);
    shareStatus('Image copied. Paste it into a message.');
  } catch {
    setError('share-error', 'This browser cannot copy images. Download the image instead.');
  }
});

$('share-download').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    const url = URL.createObjectURL(await shareBlob);
    const link = h('a', { href: url, download: shareFileName() });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    shareStatus('Image downloaded.');
  } catch (err) {
    setError('share-error', err.message);
  }
});

$('share-native').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    const file = new File([await shareBlob], shareFileName(), { type: 'image/png' });
    await navigator.share({ files: [file], title: shareTitle(state.shareDimension) });
  } catch (err) {
    if (err.name !== 'AbortError') setError('share-error', err.message);
  }
});

$('share-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('share-error', null);
  const withAmounts = $('share-amounts').checked;
  const rows = groups(state.shareDimension);
  const { netWorth, held, borrowed } = totals();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { token } = await api('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        title: shareTitle(state.shareDimension),
        days: Number(shareDays.value),
        showAmounts: withAmounts,
        total: withAmounts ? held : null,
        netWorth: withAmounts ? netWorth : null,
        borrowed: withAmounts ? borrowed : null,
        rows: rows.map((r) => ({
          name: r.name,
          share: r.share,
          value: withAmounts ? r.value : null,
          color: r.color,
          logo: r.logo && logoSource(r.logo) ? r.logo : null,
        })),
      }),
    });
    const url = shareUrl(token);
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false;
    }
    shareStatus(
      copied ? 'Link copied: ' : 'Link: ',
      h('a', { href: url, target: '_blank', rel: 'noopener' }, url),
      `. It works for ${shareDays.selectedLabel} and can be turned off in Settings.`,
    );
  } catch (err) {
    setError('share-error', err.message);
  } finally {
    button.disabled = false;
  }
});
