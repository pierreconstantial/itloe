// P4 — /screen: the TV page. Renders purely from each { t: 'view', state } (PROTOCOL.md).
// Dev console: bloko.debug('midgame' | 'finished') (mock server only), bloko.render(state).

import { renderLobby } from './lobby-view.js';
import { renderGame } from './game-view.js';
import { renderPodium } from './podium-view.js';

/** @typedef {import('../../shared/game.js').State} State */

const RECONNECT_MS = 1000;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @type {State | null} */
let current = null;
/** @type {WebSocket | null} */
let ws = null;

/** @type {Record<State['phase'], (s: State, prev: State | null) => HTMLElement>} */
const VIEWS = {
  lobby: (s) => renderLobby(s),
  playing: (s, prev) => renderGame(s, prev),
  finished: (s) => renderPodium(s),
};

/** @param {State} next */
function show(next) {
  const prev = current;
  current = next;
  app.replaceChildren(VIEWS[next.phase](next, prev));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.addEventListener('open', () => {
    document.body.classList.remove('offline');
    sock.send(JSON.stringify({ t: 'hello', role: 'screen' }));
  });
  sock.addEventListener('message', (ev) => {
    /** @type {{ t?: string, state?: State }} */
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.t === 'view' && msg.state) show(msg.state);
  });
  sock.addEventListener('close', () => {
    document.body.classList.add('offline');
    setTimeout(connect, RECONNECT_MS);
  });
}

connect();

/** @type {any} */ (window).bloko = {
  /** @param {'midgame' | 'finished'} scenario */
  debug: (scenario) => ws?.send(JSON.stringify({ t: 'debug', scenario })),
  state: () => current,
  /** @param {State} s */
  render: (s) => show(s),
};
