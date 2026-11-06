// Game-master panel (slice 3): Pierre steers the birthday evening from the ☰ sheet.
// Enter an unlocked child, go back up, and gm ops (goto / unlock / lock / reset-node / setFlag / count)
// on ANY node, each confirmed by a second tap. Plus a progress readout (counters, flags, and why a
// node is or is not unlocked). Everything comes from the content tree and the campaign facts: no node
// id is written here. Static controls are built once, so a view arriving mid-typing keeps inputs intact.
import { $ } from './dom.js';
import { createConfirm } from './confirm.js';
import { holds, holding } from '../../shared/campaign/index.js';
import { childMarks, content, explain, nodeTree, onContentChange, titleOf } from './campaign-view.js';
import { catalogue } from './bag.js';
import { CHARACTERS } from '../../shared/characters.js';

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/minigames.js').MinigameStatus} MinigameStatus */
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

/** @param {string} id */
const nameOf = (id) => CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (id)]?.name ?? id;
const GAME_START_PICK = '@game-start';

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
  /** @type {MinigameStatus | null} */ let lastStatus = null;
  const confirm = createConfirm(() => redraw());
  let names = contentNames();

  const select = /** @type {HTMLSelectElement} */ ($('gm-node'));
  const chosenNode = () => select.value === GAME_START_PICK ? content().start : select.value;
  /** The story's GM shortcut list; the sample campaign still exposes its whole content tree. */
  function fillNodes() {
    const keep = select.value;
    const places = content().storyId === 'elo-50'
      ? [{ value: GAME_START_PICK, label: 'Game Start' },
        { value: content().start, label: titleOf(content().start) },
        { value: 'young-adult', label: titleOf('young-adult') }]
      : nodeTree().map(({ node, depth }) => ({ value: node.id, label: `${'  '.repeat(depth)}${node.title}` }));
    select.replaceChildren(...places.map(({ value, label }) => Object.assign(document.createElement('option'), {
      value, textContent: label,
    })));
    if (keep && places.some(({ value }) => value === keep)) select.value = keep;
  }
  fillNodes();
  onContentChange(() => { names = contentNames(); fillNodes(); fillItems(); confirm.disarm(); redraw(); });
  const itemSelect = /** @type {HTMLSelectElement} */ ($('gm-item'));
  const whoSelect = /** @type {HTMLSelectElement} */ ($('gm-who'));
  const wispSelect = /** @type {HTMLSelectElement} */ ($('gm-wisp-who'));
  /** Items from the content's catalogue (Contract F: nothing outside it exists); characters from the roster. */
  function fillItems() {
    const keep = itemSelect.value;
    itemSelect.replaceChildren(...Object.values(catalogue()).map((it) => Object.assign(document.createElement('option'), {
      value: it.id, textContent: `${it.icon} ${it.name}`,
    })));
    if (keep && catalogue()[keep]) itemSelect.value = keep;
    whoSelect.replaceChildren(...Object.values(CHARACTERS).map((ch) => Object.assign(document.createElement('option'), {
      value: ch.id, textContent: ch.name,
    })));
  }
  fillItems();
  /** Only joined characters can change Wisp Mode; keep the selected target across views. @param {Campaign} c */
  function fillWisps(c) {
    const keep = wispSelect.value;
    const members = c.party.order.map((id) => c.party.players[id]).filter((p) => p && !p.left);
    wispSelect.replaceChildren(...members.map((p) => Object.assign(document.createElement('option'), {
      value: p.character, textContent: p.name,
    })));
    if (members.some((p) => p.character === keep)) wispSelect.value = keep;
  }
  const flagInput = /** @type {HTMLInputElement} */ ($('gm-flag'));
  const counterInput = /** @type {HTMLInputElement} */ ($('gm-counter'));
  const countInput = /** @type {HTMLInputElement} */ ($('gm-count'));

  /** @param {GmOp} op */
  const gm = (op) => io.send({ t: 'gm', op });

  /** The confirmable ops of the static buttons: key (unique per target) + label + what it sends. */
  /** @type {Record<string, () => { key: string, label: string, act: () => void } | null>} */
  const OPS = {
    goto: () => ({ key: `goto:${select.value}`, label: `go to "${select.selectedOptions[0]?.textContent ?? titleOf(chosenNode())}"`, act: () => gm({ op: 'goto', node: chosenNode() }) }),
    unlock: () => ({ key: `unlock:${select.value}`, label: `unlock "${titleOf(chosenNode())}"`, act: () => gm({ op: 'unlock', node: chosenNode() }) }),
    lock: () => ({ key: `lock:${select.value}`, label: `lock "${titleOf(chosenNode())}"`, act: () => gm({ op: 'lock', node: chosenNode() }) }),
    'reset-node': () => ({ key: `reset:${select.value}`, label: `reset "${titleOf(chosenNode())}"`, act: () => gm({ op: 'reset-node', node: chosenNode() }) }),
    'flag-on': () => {
      const flag = flagInput.value.trim();
      return flag ? { key: `flag+:${flag}`, label: `set ${flag}`, act: () => gm({ op: 'setFlag', flag, on: true }) } : null;
    },
    'flag-off': () => {
      const flag = flagInput.value.trim();
      return flag ? { key: `flag-:${flag}`, label: `clear ${flag}`, act: () => gm({ op: 'setFlag', flag, on: false }) } : null;
    },
    give: () => {
      const item = catalogue()[itemSelect.value], who = whoSelect.value;
      return item && who ? { key: `give:${item.id}:${who}`, label: `give ${item.icon} to ${nameOf(who)}`, act: () => gm({ op: 'give', item: item.id, to: /** @type {import('../../shared/characters.js').CharacterId} */ (who), count: 1 }) } : null;
    },
    take: () => {
      const item = catalogue()[itemSelect.value], who = whoSelect.value;
      return item && who ? { key: `take:${item.id}:${who}`, label: `take ${item.icon} from ${nameOf(who)}`, act: () => gm({ op: 'take', item: item.id, from: /** @type {import('../../shared/characters.js').CharacterId} */ (who), count: 1 }) } : null;
    },
    'count-set': () => {
      const counter = counterInput.value.trim();
      const set = Number(countInput.value);
      return counter && Number.isFinite(set)
        ? { key: `count:${counter}=${set}`, label: `${counter} = ${set}`, act: () => gm({ op: 'count', counter, set }) }
        : null;
    },
    wisp: () => {
      const c = last;
      const member = c?.party.order.map((id) => c.party.players[id]).find((p) => !p.left && p.character === wispSelect.value);
      if (!member) return null;
      const pending = member.statuses.includes('incarnating');
      const on = !member.statuses.includes('wisp') || pending;
      const label = pending ? `cancel ${member.name}'s incarnation` : on ? `make ${member.name} a Wisp` : `incarnate ${member.name}`;
      return { key: `wisp:${member.character}:${on}`, label, act: () => gm({ op: 'wisp', character: member.character, on }) };
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
  for (const el of [select, flagInput, counterInput, countInput, itemSelect, whoSelect, wispSelect]) el.addEventListener('input', () => { confirm.disarm(); redraw(); });
  counterInput.addEventListener('change', () => {
    const v = last?.facts.counters[counterInput.value.trim()];
    if (typeof v === 'number') countInput.value = String(v); // start from the current value
  });

  $('gm-back').addEventListener('click', () => {
    const parent = last && content().nodes[last.at.node]?.parent;
    if (content().storyId === 'elo-50' && parent) gm({ op: 'goto', node: parent });
    else io.send({ t: 'back' });
  });

  function redraw() {
    const c = last;
    if (!c) return;
    const f = c.facts;
    const nodes = content().nodes;
    const here = nodes[c.at.node];
    $('gm-where').textContent = `The party is at: ${titleOf(c.at.node)}`;
    // a minigame runs: going back ends it first (the campaign's rule)
    const playing = lastStatus !== null;
    const back = /** @type {HTMLButtonElement} */ ($('gm-back'));
    back.hidden = !here?.parent;
    back.textContent = `⬆ Back to ${here?.parent ? titleOf(here.parent) : ''}${playing ? ' (ends the game)' : ''}`;

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
        b.addEventListener('click', () => {
          if (content().storyId === 'elo-50') gm({ op: 'goto', node: m.node.id });
          else io.send({ t: 'enter', node: m.node.id });
        });
        return b;
      }));
    }
    $('gm-enter-title').hidden = marks.length === 0;

    // the static op buttons: relabel the armed one
    for (const [b, label] of resting) {
      const op = OPS[b.dataset.gm ?? '']?.();
      b.textContent = op && confirm.isArmed(op.key) ? `Tap again: ${op.label}` : b.dataset.gm === 'wisp' ? op?.label ?? label : label;
      if (b.dataset.gm === 'wisp') b.disabled = !op;
      b.classList.toggle('armed', !!op && confirm.isArmed(op.key));
    }

    const wisp = c.party.order.map((id) => c.party.players[id]).find((p) => !p.left && p.character === wispSelect.value);
    $('gm-wisp-state').textContent = !wisp ? 'No joined characters.' : wisp.statuses.includes('incarnating')
      ? `${wisp.name} is incarnating.` : `${wisp.name} is ${wisp.statuses.includes('wisp') ? 'a Wisp' : 'incarnated'}.`;

    // why the selected node is (not) unlocked
    const sel = nodes[chosenNode()];
    if (sel) {
      const open = f.unlocked.includes(sel.id);
      const forced = open && !holds(sel.unlock, f) ? ' (opened by the game master)' : '';
      const state = f.done.includes(sel.id) ? 'done ✓' : open ? `unlocked${forced}` : 'locked';
      $('gm-node-why').textContent = `${state} · unlock: ${explain(sel.unlock, f)}${sel.complete ? ` · complete: ${explain(sel.complete, f)}` : ''}`;
    }

    // what the picked character holds of the picked item (give/take feedback)
    const it = catalogue()[itemSelect.value];
    const held = it ? holding(f, whoSelect.value, it.id) : 0;
    $('gm-item-held').textContent = it ? `${nameOf(whoSelect.value)} holds ${held} × ${it.icon} ${it.name}` : 'No items in this story yet.';

    fillDatalist($('gm-flags'), [...new Set([...f.flags, ...names.flags])]);
    fillDatalist($('gm-counters'), [...new Set([...Object.keys(f.counters), ...names.counters])]);

    const lines = [
      `unlocked ${f.unlocked.length}/${Object.keys(nodes).length}, done ${f.done.length}, news waiting ${c.news.length}`,
      // inventory per character (Contract F): "items: Élodie 🗝️×1 · Sol 🎟️×1, 📷×1"
      `items: ${Object.entries(f.inventory).map(([ch, inv]) => `${nameOf(ch)} ${Object.entries(inv).map(([it, n]) => `${catalogue()[it]?.icon ?? it}×${n}`).join(', ')}`).join(' · ') || '—'}`,
      `flags: ${f.flags.join(', ') || '—'}`,
      'counters:',
      ...Object.entries(f.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k} = ${v}`),
      // totals per activity kind, never summed across kinds: "blocks: elodie 120, sol 80 · quiz: …"
      `totals: ${Object.entries(f.totals).map(([kind, byChar]) => `${kind}: ${Object.entries(byChar ?? {}).map(([ch, n]) => `${ch} ${n}`).join(', ') || '—'}`).join(' · ') || '—'}`,
    ];
    $('gm-progress').textContent = lines.join('\n');
  }

  return {
    /** @param {Campaign} c @param {MinigameStatus | null} status  the running minigame's status (null while none runs) */
    render(c, status) {
      last = c;
      lastStatus = status;
      fillWisps(c);
      redraw();
    },
  };
}
