// Admin page: what the server knows about the evening, for testing by hand and troubleshooting. Polls
// GET /api/admin (server/admin.ts) every second and redraws; it changes nothing (the GM panel on Pierre's
// phone steers the evening). Admins only: with an admin token set, the page opens with ?admin=<token> once.

const POLL_MS = 1000;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} tag @param {string} [text] @param {string} [className] */
function el(tag, text = '', className = '') {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

/** @param {HTMLElement} table @param {string[]} head @param {(string | HTMLElement)[][]} rows */
function fillTable(table, head, rows) {
  const tr = el('tr');
  for (const h of head) tr.append(el('th', h));
  table.replaceChildren(tr, ...rows.map((cells) => {
    const row = el('tr');
    for (const c of cells) {
      if (typeof c === 'string') row.append(el('td', c));
      else row.append(c);
    }
    return row;
  }));
  if (!rows.length) table.append(el('tr', 'none'));
}

/** @param {number} ms */
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
/** @param {number} at @param {number} now */
const ago = (at, now) => `${duration(now - at)} ago`;
/** @param {number} at */
const clock = (at) => new Date(at).toLocaleTimeString([], { hour12: false });
/** @param {number} at */
const when = (at) => el('td', clock(at), 'when');

/** The browser, short: the part of a user agent that tells phones apart. @param {string} agent */
function browser(agent) {
  const device = agent.match(/\(([^)]*)\)/)?.[1].split(';').slice(0, 2).join(';') ?? '';
  const name = agent.match(/(Firefox|Edg|OPR|SamsungBrowser|CriOS|Chrome|Version)\/[\d.]+/)?.[0] ?? '';
  return `${device} ${name.replace('Version/', 'Safari/')}`.trim() || agent;
}

/** @param {any} s the socket info of the snapshot @param {number} now */
const socketCells = (s, now) => [
  s ? when(s.since) : el('td', '—'),
  s?.lastAt ? el('td', `${s.last} (${ago(s.lastAt, now)})`, 'when') : el('td', '—'),
  s ? s.ip : '—', s ? browser(s.agent) : '—',
];

let paused = false;
/** The page errors drawn last: redrawn only when one arrives, so an open stack stays open. */
let errorsShown = -1;

/** @param {any} d the snapshot */
function draw(d) {
  const now = d.now;
  const c = d.campaign;
  const players = c.party.players;
  /** @param {string | null} id */
  const name = (id) => id === null ? 'server' : id === 'screen' ? 'TV' : id === 'unjoined' ? 'unjoined phone' : players[id]?.name ?? id;

  const round = d.round ? `${d.round.kind} ${d.round.status}` : 'no round';
  $('summary').textContent = `room ${d.room} · at ${c.at.node} · ${round} · ${d.hosting} · up ${duration(now - d.startedAt)}`
    + ` · saved ${d.savedAt ? ago(d.savedAt, now) : 'never'}${d.joinQrUntil > now ? ' · join QR showing' : ''}`;

  fillTable($('players'), ['Player', 'Id', 'Role', 'State', 'Statuses', 'Socket since', 'Last message', 'Address', 'Browser', 'Sockets', 'Position'],
    d.players.map((/** @type {any} */ p) => {
      const m = players[p.id];
      const pos = p.roundPos ?? p.pos;
      return [
        `${m.name} (${m.character})`, p.id, p.id === d.gameMaster ? 'game master' : '',
        el('td', m.left ? 'left' : p.online ? 'online' : 'offline', m.left ? 'dim' : p.online ? 'ok' : 'bad'),
        m.statuses.join(', '), ...socketCells(p.socket, now), String(p.attaches),
        pos ? `${p.roundPos ? 'game area ' : ''}${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}${pos.moving ? ' moving' : ''}` : '—',
      ];
    }));

  fillTable($('sockets'), ['Kind', 'Open since', 'Last message', 'Address', 'Browser'], [
    ...d.screens.map((/** @type {any} */ s) => ['TV', ...socketCells(s, now)]),
    ...d.strangers.map((/** @type {any} */ s) => ['not joined', ...socketCells(s, now)]),
  ]);

  const deadline = d.round?.deadline;
  $('round').textContent = d.round
    ? `${d.round.kind}, ${d.round.status}: ${d.round.describe}${typeof deadline === 'number' ? `, ${duration(deadline - now)} left on the clock` : ''}`
    : `No round: the party is at ${c.at.node}.`;
  $('round-raw').textContent = JSON.stringify(c.at.activity, null, 2);

  $('error-count').textContent = d.clientErrorCount > d.clientErrors.length
    ? `(the last ${d.clientErrors.length} of ${d.clientErrorCount})` : '';
  if (d.clientErrorCount !== errorsShown) {
    errorsShown = d.clientErrorCount;
    $('errors').replaceChildren(...d.clientErrors.slice().reverse().map((/** @type {any} */ e) => {
      const box = el('div', '', 'error');
      const who = e.playerId ? `${name(e.playerId)} · ` : '';
      box.append(el('div', `${clock(e.at)} · ${who}${e.page} · ${e.ip} · ${browser(e.agent)}`, 'dim'), el('div', e.message, 'what'));
      if (e.source) box.append(el('div', e.source, 'what dim'));
      if (e.stack) {
        const details = el('details');
        details.append(el('summary', 'stack'), el('pre', e.stack));
        box.append(details);
      }
      return box;
    }));
    if (!d.clientErrors.length) $('errors').append(el('p', 'none', 'dim'));
  }

  fillTable($('events'), ['When', 'Who', 'What', ''], d.events.slice().reverse().map((/** @type {any} */ e) => [
    when(e.at), name(e.who), el('td', e.what, 'what'),
    e.ok === undefined ? '' : el('td', e.ok ? 'accepted' : 'refused', e.ok ? 'ok' : 'bad'),
  ]));

  $('server').replaceChildren(...[
    ['Started', clock(d.startedAt)], ['Loaded', d.loaded],
    ['Content', `${d.content} (version ${d.contentVersion})`], ['Save file', d.saveFile], ['Hosting', d.hosting],
  ].flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
  $('campaign-raw').textContent = JSON.stringify(c, null, 2);
}

/** @param {string} text */
function problem(text) {
  $('problem').hidden = !text;
  $('problem').textContent = text;
}

async function poll() {
  if (!paused) {
    try {
      const res = await fetch('/api/admin', { cache: 'no-store' });
      if (res.ok) {
        draw(await res.json());
        problem('');
      } else problem(res.status === 401 ? await res.text() : `The server answered ${res.status}.`);
    } catch {
      problem('The server does not answer.');
    }
  }
  setTimeout(poll, POLL_MS);
}

$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
});
poll();
