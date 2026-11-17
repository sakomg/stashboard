const SVG = 'http://www.w3.org/2000/svg';
let sequence = 0;
const nextId = (prefix) => `${prefix}-${++sequence}`;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style') Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

export const iconButton = (name, label, onclick, cls = '') =>
  h('button', { class: `icon-button ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

function placePopover(popover, anchor, align = 'start') {
  const box = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const { offsetWidth: width, offsetHeight: height } = popover;
  const below = box.bottom + gap + height <= window.innerHeight - margin || box.top - gap - height < margin;
  const top = below ? box.bottom + gap : box.top - gap - height;
  const preferred = align === 'end' ? box.right - width : box.left;
  const left = Math.min(Math.max(margin, preferred), window.innerWidth - width - margin);
  popover.style.top = `${Math.max(margin, top)}px`;
  popover.style.left = `${left}px`;
}

const isOpen = (popover) => popover.matches(':popover-open');

window.addEventListener(
  'scroll',
  (event) => {
    for (const popover of document.querySelectorAll('.popover:popover-open')) {
      if (!popover.contains(event.target)) popover.hidePopover();
    }
  },
  true,
);
window.addEventListener('resize', () => {
  for (const popover of document.querySelectorAll('.popover:popover-open')) popover.hidePopover();
});

export function help({ title, text, source = null }) {
  const id = nextId('help');
  const panel = h(
    'div',
    { class: 'popover help-panel', id, popover: 'auto', role: 'dialog', 'aria-label': title },
    h('b', {}, title),
    h('p', {}, text),
    source &&
      h(
        'a',
        { href: source.href, target: source.href.startsWith('#') ? null : '_blank', rel: 'noopener noreferrer' },
        source.label,
        !source.href.startsWith('#') && icon('external-link'),
      ),
  );
  const trigger = h(
    'button',
    { class: 'help', type: 'button', 'aria-label': `What is ${title}?`, 'aria-expanded': 'false', 'aria-controls': id },
    icon('circle-help'),
  );
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen(panel)) return panel.hidePopover();
    panel.showPopover();
    placePopover(panel, trigger);
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('toggle', (event) => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
  return h('span', { class: 'help-wrap' }, trigger, panel);
}

export function select({ label, options, value, onChange = null }) {
  const id = nextId('select');
  let current = value;
  let active = 0;
  const shown = h('span', { class: 'select-value' });
  const trigger = h(
    'button',
    {
      class: 'select-trigger',
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-label': label,
    },
    shown,
    icon('chevron-down'),
  );
  const items = options.map((option, i) =>
    h(
      'li',
      { id: `${id}-${i}`, role: 'option', 'aria-selected': 'false' },
      h('span', { class: 'select-option' }, option.media?.(), option.label),
      icon('check'),
    ),
  );
  const list = h(
    'ul',
    { class: 'popover select-list', id, popover: 'auto', role: 'listbox', tabindex: '-1', 'aria-label': label },
    items,
  );
  const root = h('div', { class: 'select' }, trigger, list);

  const sync = () => {
    items.forEach((item, i) => {
      item.setAttribute('aria-selected', String(options[i].value === current));
      item.classList.toggle('active', i === active);
    });
    const chosen = options.find((o) => o.value === current);
    shown.replaceChildren(...(chosen ? [chosen.media?.(), chosen.label].filter(Boolean) : []));
    list.setAttribute('aria-activedescendant', items[active]?.id ?? '');
  };
  const open = () => {
    active = Math.max(
      0,
      options.findIndex((o) => o.value === current),
    );
    sync();
    list.style.minWidth = `${trigger.offsetWidth}px`;
    list.showPopover();
    placePopover(list, trigger);
    list.focus();
  };
  const close = () => {
    if (isOpen(list)) list.hidePopover();
    trigger.focus();
  };
  const choose = (i) => {
    const changed = options[i].value !== current;
    current = options[i].value;
    sync();
    close();
    if (changed) {
      onChange?.(current);
      root.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const move = (to) => {
    active = (to + items.length) % items.length;
    sync();
    items[active].scrollIntoView({ block: 'nearest' });
  };

  trigger.addEventListener('click', () => (isOpen(list) ? list.hidePopover() : open()));
  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (event) => {
    const keys = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(items.length - 1),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: () => close(),
    };
    if (event.key === 'Tab') return list.hidePopover();
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  items.forEach((item, i) => {
    item.addEventListener('click', () => choose(i));
    item.addEventListener('pointermove', () => {
      if (active !== i) {
        active = i;
        sync();
      }
    });
  });
  list.addEventListener('toggle', (event) => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));

  Object.defineProperty(root, 'value', {
    get: () => current,
    set: (next) => {
      current = next;
      sync();
    },
  });
  Object.defineProperty(root, 'selectedLabel', { get: () => options.find((o) => o.value === current)?.label ?? '' });
  sync();
  return root;
}

export function segmented({ label, options, value, onChange }) {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([id, text, media]) =>
      h('button', { type: 'button', 'aria-pressed': String(id === value), onclick: () => onChange(id) }, media, text),
    ),
  );
}

export const skeleton = (cls = 'sk-line') => h('span', { class: `skeleton ${cls}`, 'aria-hidden': 'true' });
