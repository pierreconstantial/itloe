// Game-master panel (slice 3): Pierre, the party host, steers the evening from the ☰ sheet.
// Enter an unlocked child, go back up, and gm ops (goto / unlock / lock / reset-node / setFlag / count)
// on ANY node, each confirmed by a second tap. Plus a progress readout (counters, flags, and why a
// node is or is not unlocked). Everything comes from the content tree and the campaign facts: no node
// id is written here. Static controls are built once, so a view arriving mid-typing keeps inputs intact.
import { $ } from './dom.js';
import { createConfirm } from './confirm.js';
import { holds } from '../../shared/campaign/index.js';
import { childMarks, content, explain, nodeTree, onContentChange, titleOf } from './campaign-view.js';

/** @typedef {import('../../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../../shared/campaign/types.js').GmOp} GmOp */
/** @typedef {import('../../shared/campaign/types.js').Condition} Condition */

/** Flag and counter names the content refers to (suggestions for the inputs). @returns {{ flags: string[], counters: string[] }} */
function contentNames() {
  const flags = new Set(), counters = new Set();
  /** @param {Condition | undefined} c */
  const walk = (c) => {
    if (!c || typeof c !== 'object') return;
    if ('flag' in c) flags.add(c.flag);
    if ('count' in c) counters.add(c.count);
    if ('all' in c) c.all.forEach(walk);
    if ('any' in c) c.any.forEach(walk);
    if ('not' in c) walk(c.not);
  };
  for (const n of Object.values(content().nodes)) {
    walk(n.unlock);
    walk(n.complete);
    for (const r of n.rewards ?? []) if ('flag' in r) flags.add(r.flag);
  }
  return { flags: [...flags], counters: [...counters] };
}

/** @param {HTMLElement} list @param {string[]} values */
function fillDatalist(list, values) {
  const sig = values.join('|');
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  list.replaceChildren(...values.map((v) => Object.assign(document.createElement('option'), { value: v })));
}

/** @param {{ send: (msg: unknown) => void }} io */
export function createGmPanel(io) {
  /** @type {Campaign | null} */ let last = null;
  const confirm = createConfirm(() => redraw());
  let names = contentNames();

  const select = /** @type {HTMLSelectElement} */ ($('gm-node'));
  /** The place picker, from the content tree (rebuilt when the content changes; the choice is kept). */
  function fillNodes() {
    const keep = select.value;
    select.replaceChildren(...nodeTree().map(({ node, depth }) => Object.assign(document.createElement('option'), {
      value: node.id, textContent: `${'  '.repeat(depth)}${node.title}`,
    })));
    if (keep && content().nodes[keep]) select.value = keep;
  }
  fillNodes();
  onContentChange(() => { names = contentNames(); fillNodes(); confirm.disarm(); redraw(); });
  const flagInput = /** @type {HTMLInputElement} */ ($('gm-flag'));
  const counterInput = /** @type {HTMLInputElement} */ ($('gm-counter'));
  const countInput = /** @type {HTMLInputElement} */ ($('gm-count'));

  /** @param {GmOp} op */
  const gm = (op) => io.send({ t: 'gm', op });

  /** The confirmable ops of the static buttons: key (unique per target) + label + what it sends. */
  /** @type {Record<string, () => { key: string, label: string, act: () => void } | null>} */
  const OPS = {
    goto: () => ({ key: `goto:${select.value}`, label: `go to "${titleOf(select.value)}"`, act: () => gm({ op: 'goto', node: select.value }) }),
    unlock: () => ({ key: `unlock:${select.value}`, label: `unlock "${titleOf(select.value)}"`, act: () => gm({ op: 'unlock', node: select.value }) }),
    lock: () => ({ key: `lock:${select.value}`, label: `lock "${titleOf(select.value)}"`, act: () => gm({ op: 'lock', node: select.value }) }),
    'reset-node': () => ({ key: `reset:${select.value}`, label: `reset "${titleOf(select.value)}"`, act: () => gm({ op: 'reset-node', node: select.value }) }),
    'flag-on': () => {
      const flag = flagInput.value.trim();
      return flag ? { key: `flag+:${flag}`, label: `set ${flag}`, act: () => gm({ op: 'setFlag', flag, on: true }) } : null;
    },
    'flag-off': () => {
      const flag = flagInput.value.trim();
      return flag ? { key: `flag-:${flag}`, label: `clear ${flag}`, act: () => gm({ op: 'setFlag', flag, on: false }) } : null;
    },
    'count-set': () => {
      const counter = counterInput.value.trim();
      const set = Number(countInput.value);
      return counter && Number.isFinite(set)
        ? { key: `count:${counter}=${set}`, label: `${counter} = ${set}`, act: () => gm({ op: 'count', counter, set }) }
        : null;
    },
  };

  /** @type {Map<HTMLButtonElement, string>} button → its resting label */
  const resting = new Map();
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#sheet-gm [data-gm]'))) {
    resting.set(b, b.textContent ?? '');
    b.addEventListener('click', () => {
      const op = OPS[b.dataset.gm ?? '']?.();
      if (op) confirm.tap(op.key, op.act);
    });
  }
  // changing the target disarms (the armed action was for the previous one)
  for (const el of [select, flagInput, counterInput, countInput]) el.addEventListener('input', () => { confirm.disarm(); redraw(); });
  counterInput.addEventListener('change', () => {
    const v = last?.facts.counters[counterInput.value.trim()];
    if (typeof v === 'number') countInput.value = String(v); // start from the current value
  });

  $('gm-back').addEventListener('click', () => io.send({ t: 'back' }));

  function redraw() {
    const c = last;
    if (!c) return;
    const f = c.facts;
    const nodes = content().nodes;
    const here = nodes[c.at.node];
    $('gm-where').textContent = `The party is at: ${titleOf(c.at.node)}`;
    const playing = c.at.activity?.phase === 'playing';
    const back = /** @type {HTMLButtonElement} */ ($('gm-back'));
    back.hidden = !here?.parent;
    back.disabled = playing;
    back.textContent = playing ? '⬆ Back (end the game first)' : `⬆ Back to ${here?.parent ? titleOf(here.parent) : ''}`;

    // enter: one button per child, locked ones shown greyed with their condition
    const enter = $('gm-enter');
    const marks = childMarks(c);
    const sig = JSON.stringify([marks.map((m) => [m.node.id, m.unlocked, m.done, m.fresh]), playing]);
    if (enter.dataset.sig !== sig) {
      enter.dataset.sig = sig;
      enter.replaceChildren(...marks.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.enter = m.node.id;
        b.disabled = !m.unlocked || playing;
        b.textContent = `${m.unlocked ? '→' : '🔒'} ${m.node.title}${m.done ? ' ✓' : ''}${m.fresh ? ' ✨' : ''}`;
        b.addEventListener('click', () => io.send({ t: 'enter', node: m.node.id }));
        return b;
      }));
    }
    $('gm-enter-title').hidden = marks.length === 0;

    // the static op buttons: relabel the armed one
    for (const [b, label] of resting) {
      const op = OPS[b.dataset.gm ?? '']?.();
      b.textContent = op && confirm.isArmed(op.key) ? `Tap again: ${op.label}` : label;
      b.classList.toggle('armed', !!op && confirm.isArmed(op.key));
    }

    // why the selected node is (not) unlocked
    const sel = nodes[select.value];
    if (sel) {
      const open = f.unlocked.includes(sel.id);
      const forced = open && !holds(sel.unlock, f) ? ' (opened by the game master)' : '';
      const state = f.done.includes(sel.id) ? 'done ✓' : open ? `unlocked${forced}` : 'locked';
      $('gm-node-why').textContent = `${state} · unlock: ${explain(sel.unlock, f)}${sel.complete ? ` · complete: ${explain(sel.complete, f)}` : ''}`;
    }

    fillDatalist($('gm-flags'), [...new Set([...f.flags, ...names.flags])]);
    fillDatalist($('gm-counters'), [...new Set([...Object.keys(f.counters), ...names.counters])]);

    const lines = [
      `unlocked ${f.unlocked.length}/${Object.keys(nodes).length}, done ${f.done.length}, news waiting ${c.news.length}`,
      `items: ${f.items.join(', ') || '—'}`,
      `flags: ${f.flags.join(', ') || '—'}`,
      'counters:',
      ...Object.entries(f.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k} = ${v}`),
      `totals: ${Object.entries(f.totals).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`,
    ];
    $('gm-progress').textContent = lines.join('\n');
  }

  return {
    /** @param {Campaign} c */
    render(c) {
      last = c;
      redraw();
    },
  };
}
