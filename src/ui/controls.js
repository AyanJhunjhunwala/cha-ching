import { h, haptic } from './dom.js';

/**
 * −/+ stepper whose value can also be typed directly.
 * @param {{label:string, hint?:string, prefix?:string, suffix?:string, get:()=>number,
 *          step:(value:number, dir:1|-1)=>number, set:(value:number)=>number, decimals?:number}} opts
 *   `set` clamps/saves and returns the stored value.
 */
export function stepper({ label, hint, prefix = '', suffix = '', get, step, set, decimals = 0 }) {
  const show = (v) => (decimals ? (Number.isInteger(v) ? String(v) : v.toFixed(decimals)) : String(Math.round(v)));
  const input = h('input', {
    class: 'stepper-input',
    inputmode: decimals ? 'decimal' : 'numeric',
    'aria-label': label,
    value: show(get()),
    onfocus: () => input.select(),
    oninput: () => fit(),
    onchange: () => commit(Number(input.value.replace(/[^0-9.]/g, ''))),
    onkeydown: (e) => e.key === 'Enter' && input.blur(),
  });
  const fit = () => input.style.setProperty('width', `${Math.max(1, input.value.length) + 0.2}ch`);
  const commit = (value) => {
    input.value = show(set(value));
    fit();
  };
  const button = (dir, text) =>
    h('button', {
      type: 'button',
      class: 'stepper-btn',
      'aria-label': `${dir > 0 ? 'Increase' : 'Decrease'} ${label.toLowerCase()}`,
      onclick: () => {
        haptic.press();
        commit(step(get(), dir));
      },
    }, text);

  fit();
  return h('div', { class: 'stepper' },
    h('div', { class: 'stepper-text' },
      h('span', { class: 'stepper-label' }, label),
      hint ? h('span', { class: 'stepper-hint' }, hint) : null,
    ),
    h('div', { class: 'stepper-controls' },
      button(-1, '−'),
      h('label', { class: 'stepper-value' }, prefix ? h('span', { class: 'affix' }, prefix) : null, input, suffix ? h('span', { class: 'affix' }, suffix) : null),
      button(1, '+'),
    ),
  );
}

/** Bottom sheet; returns a close function. */
export function sheet(title, ...content) {
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
  };
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => e.target === backdrop && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-handle' }),
      h('h2', { class: 'sheet-title' }, title),
      ...content,
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => close() }, 'Done'),
    ),
  );
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  return close;
}
