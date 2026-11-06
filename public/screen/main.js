// P4 — /screen: the TV page, the frame around every minigame. Renders purely from each `view`
// (PROTOCOL.md): the room at a tableau, the map and the cutscenes are the frame's; while a minigame runs,
// its screen (./minigames.js) is mounted in #app, from its start to its end.

import { renderLobby, fetchJoinInfo, fallbackJoinInfo } from './lobby-view.js';
import { sfx, installAudioUnlock, onAudioState } from './audio.js';
import * as fx from './fx.js';
import { syncClock, serverNow } from '../commun/clock.js';
import { createPartyRoom } from './party-room.js';
import { createAvatarLayer, worldView } from './avatar-layer.js';
import { createPresence } from './presence.js';
import { createLiveness } from '../commun/liveness.js';
import { h } from './dom.js';
import { createContentSource } from '../commun/content.js';
import { doorStates, mapCopy, nameOf } from './doors.js';
import { roomAt } from '../../shared/campaign/content.js';
import { gameMasterId, isWisp } from '../../shared/campaign/index.js';
import { room as sceneRoom } from '../../shared/scene.js';
import { createCutscenes } from './cutscenes.js';
import { screenOf } from './minigames.js';
import { applyJoinQr, joinQrState } from './join-qr.js';
import { CHARACTERS } from '../../shared/characters.js';
import { INTRO_KEY, REUNIONS } from '../../shared/campaign/story.js';

/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */

const RECONNECT_MS = 1000;
/** A socket still CONNECTING after this is abandoned and retried (Chrome throttles/queues attempts after failures). */
const CONNECT_TIMEOUT_MS = 5000;
/** Timers stopped for longer than this (laptop asleep, tab frozen) → the socket is presumed dead. */
const WAKE_GAP_MS = 5000;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
/** Every player's avatar, whatever screen is showing. */
const avatars = createAvatarLayer();
/** The players walking over the running minigame's screen: its wisps, and its players on its walkable lobby. */
const minigameAvatars = createAvatarLayer();
const wispOverlay = /** @type {HTMLCanvasElement} */ (document.getElementById('wisp-overlay'));
const wispContext = /** @type {CanvasRenderingContext2D} */ (wispOverlay.getContext('2d'));
let wispFrame = 0;
let lastWispFrame = 0;

/** The connected party members the running minigame doesn't show (isWisp), as wisps over its screen. @type {string[]} */
let minigameWisps = [];
/** Who walks over the running minigame's screen: its wisps, and while its lobby is walkable (`spots`), the players it
 *  shows, as their characters, offline ones too (they keep standing where they stood). @type {string[]} */
let minigameWalkers = [];

/** Draws `minigameWalkers` over the running minigame's screen, frame by frame. @param {number} now */
function drawMinigameWalkers(now) {
  if (!shownMinigame || !campaign) { wispFrame = 0; return; }
  const c = campaign;
  const dpr = devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  if (wispOverlay.width !== Math.round(w * dpr) || wispOverlay.height !== Math.round(h * dpr)) {
    wispOverlay.width = Math.round(w * dpr); wispOverlay.height = Math.round(h * dpr);
  }
  wispContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  wispContext.clearRect(0, 0, w, h);
  const ids = minigameWalkers;
  if (!ids.length) { wispFrame = 0; return; }
  const base = roomAt(content.get(), c.at.node);
  minigameAvatars.update(Math.min(.05, (now - lastWispFrame) / 1000 || .016));
  minigameAvatars.draw(wispContext, worldView(w, h, dpr), 1, now, sceneRoom('wisp-overlay', base.floor, []), {}, ids);
  lastWispFrame = now;
  wispFrame = requestAnimationFrame(drawMinigameWalkers);
}

const party = createPartyRoom(
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-bg')),
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-fg')),
  avatars,
);
const soundHint = /** @type {HTMLElement} */ (document.getElementById('sound-hint'));

/** Party members with a live socket, from the last view. @type {string[]} */
let onlineNow = [];
/** The minigame last shown; null while none runs. @type {MinigameView | null} */
let shownMinigame = null;
/** The minigame screen mounted in #app while a minigame runs: its kind and handle, else null.
 *  @type {{ kind: string, screen: import('./minigames.js').Mounted } | null} */
let running = null;
/** No view shown since the page loaded or the socket reconnected: what happened in between is not replayed. */
let gap = true;
/** Who was in the room at a tableau when it was last drawn (newcomers get a sound); null: the room isn't showing. */
let roomIds = /** @type {string[] | null} */ (null);
/** @type {WebSocket | null} */
let ws = null;
/** @type {import('./lobby-view.js').JoinInfo} */
let joinInfo = fallbackJoinInfo();
/** Who has dropped (debounced): dims their board / avatar so the game master can say "tap your character". */
const presence = createPresence({ onChange: applyPresence });

/** Marks offline players on the current DOM and in the party room, without a re-render. */
function applyPresence() {
  const off = presence.offline();
  for (const el of app.querySelectorAll('[data-id]')) {
    el.classList.toggle('is-offline', off.has(/** @type {HTMLElement} */ (el).dataset.id ?? ''));
  }
  avatars.setOffline(off);
  minigameAvatars.setOffline(off);
}

/** The story's start tableau after its first match: no round follows. */
const portalReady = () => !!campaign?.facts.flags.includes('story.elo-50') && campaign.facts.flags.includes('portal.ready')
  && campaign.at.node === 'hub.false-start';
/** The portal stands in the room until Élodie went through it. */
const portalOpen = () => portalReady() && !campaign?.facts.flags.includes('portal.entered');

/** What the frame offers a minigame's screen. @type {import('./minigames.js').TvIo} */
const io = { continuous: () => !gap, gameMasterName: () => CHARACTERS[content.get().gameMaster].name };

/** Removes the running minigame's screen, with its listeners, loops, sounds and timers. */
function unmountScreen() {
  const r = running;
  running = null;
  r?.screen.unmount();
}

/** Leaving a minigame for the room or the map: its screen goes, and the avatars stand where they stood in
 *  the room, without walking there. */
function leaveMinigame() {
  unmountScreen();
  if (!shownMinigame) return;
  shownMinigame = null;
  wispOverlay.hidden = true;
  if (wispFrame) cancelAnimationFrame(wispFrame);
  wispFrame = 0;
  avatars.settle();
  fx.clearAll();
}

/**
 * A running minigame: its screen, from its start to its end (its lobby, its rounds, their podiums), with the
 * party members it doesn't show as wisps over it, and the players it shows walking over its walkable lobby.
 * @param {MinigameView} m @param {Campaign} c
 */
function showMinigame(m, c) {
  const screen = /** @type {import('./minigames.js').TvScreen} */ (screenOf(m.kind));
  shownMinigame = m;
  roomIds = null;
  party.setRoom(roomAt(content.get(), c.at.node));
  party.setPortal(false);
  party.setKey(false);
  minigameAvatars.setPlayers(c.party, roomAt(content.get(), c.at.node));
  minigameWisps = c.party.order.filter((id) => onlineNow.includes(id) && isWisp(c.party, id, m.shows));
  minigameWalkers = [...minigameWisps, ...(m.spots ? m.shows : [])];
  // whom the minigame doesn't show is drawn as a wisp, and whom it shows as their character, whatever their story status
  minigameAvatars.setStatuses(Object.fromEntries(c.party.order.map((id) => {
    const statuses = c.party.players[id].statuses.filter((s) => s !== 'wisp');
    return [id, { statuses: minigameWisps.includes(id) ? [...statuses, 'wisp'] : statuses }];
  })));
  avatars.setStatuses(c.party.players);
  party.setDoors([]);
  party.setVisible(false);
  wispOverlay.hidden = false;
  if (!wispFrame) wispFrame = requestAnimationFrame(drawMinigameWalkers);
  document.body.classList.remove('party');
  if (running?.kind !== m.kind) {
    unmountScreen();
    app.replaceChildren();
    running = { kind: m.kind, screen: screen.mount(app, io) };
  }
  running.screen.update(m, c);
  applyPresence();
}

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */

/** Campaign content (titles, doors): fetched from the server, refreshed on a new contentVersion. */
const content = createContentSource({ onChange: () => { if (campaign && !shownMinigame) showPlace(campaign); } });
/** Last campaign from the server (views carry it next to `minigame`). @type {Campaign | null} */
let campaign = null;

/**
 * The room at a tableau, while its minigame doesn't run: the party room under the minigame's band (title,
 * who's in, who starts it, the join QR); the guests are the avatars walking below it. A guest arriving gets a
 * sound.
 * @param {Campaign} c
 */
function showRoom(c) {
  leaveMinigame();
  fx.clearAll();
  const here = c.party.order.filter((id) => !c.party.players[id].left && c.party.players[id].character);
  // not after a page load or a reconnect: who arrived in between isn't announced
  if (roomIds && io.continuous()) for (const id of here) if (!roomIds.includes(id)) sfx.joined();
  roomIds = here;
  const band = /** @type {import('./minigames.js').TvScreen} */ (screenOf(c.at.kind));
  const gm = gameMasterId(c.party, content.get());
  app.replaceChildren(renderLobby({ order: here, players: c.party.players }, null, joinInfo,
    { title: band.title, name: band.name },
    portalOpen() ? { gameMasterId: gm, status: 'A portal has appeared. Élodie, walk into it!' }
      : portalReady() ? { gameMasterId: gm, status: 'Élodie went through the portal.' }
        : { gameMasterId: gm }));
  party.setRoom(roomAt(content.get(), c.at.node));
  party.setPortal(portalOpen());
  party.setKey(false);
  party.setPlayers({ order: here, players: c.party.players });
  avatars.setStatuses(c.party.players);
  party.setDoors([]);
  party.setVisible(true);
  document.body.classList.add('party');
  applyPresence();
}

/** While no minigame runs: the room at a minigame's tableau, else the hub / world map. @param {Campaign} c */
const showPlace = (c) => (c.at.kind ? showRoom(c) : showMap(c));

/**
 * Hub / world map (no round on): the party room with one door per child node, avatars walking
 * as in the room at a tableau, and a top band with where we are. The next round starts fresh.
 * @param {Campaign} c
 */
function showMap(c) {
  leaveMinigame();
  roomIds = null;
  const storyScene = c.facts.flags.includes('story.elo-50') && c.facts.flags.includes('portal.entered');
  const inApartment = storyScene && c.at.node === 'hub';
  party.setRoom(roomAt(content.get(), c.at.node));
  party.setPlayers(c.party);
  avatars.setStatuses(c.party.players);
  party.setPortal(false);
  party.setKey(inApartment && c.facts.flags.includes('apparition.seen') && !(c.facts.inventory.elodie?.[INTRO_KEY] > 0));
  party.setHubPeople(inApartment ? REUNIONS.filter((person) => c.facts.flags.includes(person.flag)
    && !['pierre', 'sol', 'anna'].includes(person.id)).map((person) => person.id) : []);
  party.setDecorations(inApartment ? Object.entries(c.facts.inventory.elodie ?? {})
    .filter(([id, count]) => count > 0 && !id.startsWith('memory-key-') && content.get().items[id])
    .map(([id]) => ({ id, icon: content.get().items[id].icon })) : []);
  party.setDoors(doorStates(c, content.get()));
  party.setVisible(true);
  document.body.classList.add('party');
  const copy = mapCopy(c, content.get());
  app.replaceChildren(h('section', 'map-band', [
    h('h1', 'map-title', [copy.title]),
    h('p', 'map-hint', [copy.hint]),
    ...(copy.bags.length ? [h('div', 'map-bags', copy.bags.map((b) => {
      const el = h('span', 'map-bag', [
        h('span', 'map-bag-name', [b.name]),
        ...b.items.map((it) => {
          const i = h('span', 'map-bag-item', [it.icon, ...(it.count > 1 ? [h('sub', '', [`×${it.count}`])] : [])]);
          i.title = it.name;
          i.dataset.item = it.id;
          return i;
        }),
      ]);
      el.dataset.id = b.id;
      el.style.setProperty('--pc', `var(--p${b.color})`);
      return el;
    }))] : []),
  ]));
}

// ---------- "show the QR again" (any player asks; screens get { t:'joinQr', until }) ----------
// A side card with the join QR + room code + a shrinking bar. While it is open a minigame's screen makes
// room for it (body.join-qr-open, in its own CSS), so it never covers a board or a question.

/** @type {import('./join-qr.js').JoinWindow | null} */
let joinWindow = null;
const joinCard = h('aside', 'join-qr-card', [
  h('p', 'join-qr-title', ['Scan to join or get back in']),
  h('img', 'join-qr-img'),
  h('p', 'join-qr-label', ['Room code']),
  h('div', 'join-qr-code', ['']),
  h('div', 'join-qr-bar', [h('span', 'join-qr-fill')]),
]);
joinCard.hidden = true;
document.body.append(joinCard);

/** @param {unknown} until */
function onJoinQr(until) {
  const was = joinWindow;
  joinWindow = applyJoinQr(joinWindow, until, serverNow());
  if (joinWindow && joinWindow !== was) {
    // the room code may have changed (server restarted): refresh the QR and the code each time it opens
    fetchJoinInfo().then((info) => {
      joinInfo = info;
      const img = /** @type {HTMLImageElement} */ (joinCard.querySelector('.join-qr-img'));
      const code = info.code ?? '';
      if (img.dataset.code !== code || !img.src) { img.src = `/api/join-qr.svg?room=${encodeURIComponent(code)}`; img.dataset.code = code; }
      img.alt = 'QR code to join';
      /** @type {HTMLElement} */ (joinCard.querySelector('.join-qr-code')).textContent = code;
      joinCard.classList.toggle('no-code', !code);
    });
  }
  drawJoinCard();
}

function drawJoinCard() {
  const st = joinQrState(joinWindow, serverNow());
  if (!st.visible) joinWindow = null;
  if (joinCard.hidden === st.visible) joinCard.hidden = !st.visible;
  document.body.classList.toggle('join-qr-open', st.visible);
  if (st.visible) /** @type {HTMLElement} */ (joinCard.querySelector('.join-qr-fill')).style.transform = `scaleX(${st.fraction})`;
}
setInterval(drawJoinCard, 200);

// ---------- unlock / reward cutscenes (campaign.news) ----------

const CUTSCENE_MS = 4200;
let acksSent = 0;
let momentsPlayed = 0;

/** A moment may start: no minigame running (its results reach the main game when it ends). */
function canPlayCutscene() {
  // a hidden TV tab plays nothing (and so never acks what nobody saw); it plays once shown again
  if (document.visibilityState !== 'visible') return false;
  return !shownMinigame; // the room at a tableau, the hub, a world
}

/**
 * One combined TV moment: headline, the unlocked titles, the rewards; fanfare + confetti.
 * @param {import('./cutscenes.js').Moment} m @param {AbortSignal} signal
 */
function playMoment(m, signal) {
  momentsPlayed++;
  if (m.apparition) return playApparition(signal);
  const box = h('div', 'cutscene', [
    h('p', 'cutscene-headline', [m.headline]),
    ...m.unlocked.map((u) => h('p', `cutscene-line is-${u.kind}`, [`🚪 ${u.title}`])),
    ...m.items.map((it) => h('p', 'cutscene-line is-item', [
      h('span', 'cutscene-gift', ['🎁']),
      ` ${it.to.length ? it.to.join(', ') : 'Someone'} ${it.to.length > 1 ? 'get' : 'gets'} `,
      h('span', 'cutscene-item-icon', [it.icon]), ` ${it.name}`,
    ])),
  ]);
  box.dataset.upTo = String(m.upTo);
  document.body.append(box);
  sfx.reveal();
  setTimeout(() => { if (!signal.aborted) { sfx.fanfare(); fx.confetti(['#ffd166', '#ffffff', '#ff5fa2', '#3b8ea5']); } }, 600);
  return new Promise((resolve) => {
    const end = () => { box.classList.add('is-leaving'); setTimeout(() => box.remove(), 400); resolve(undefined); };
    const timer = setTimeout(end, CUTSCENE_MS);
    signal.addEventListener('abort', () => { clearTimeout(timer); end(); }, { once: true });
  });
}

/** A one-time scripted reveal; the server releases the key only after the TV acknowledges it. */
/** @param {AbortSignal} signal */
function playApparition(signal) {
  const box = h('div', 'apparition', [
    h('div', 'apparition-light'),
    h('div', 'apparition-figure', [
      h('div', 'apparition-hair'), h('div', 'apparition-face'), h('div', 'apparition-beard'),
      h('div', 'apparition-robe'), h('div', 'apparition-guitar', ['🎸']),
    ]),
    h('div', 'apparition-speech', [
      h('p', '', ['Fifty years… You turn fifty today, and you have travelled through space and time.']),
      h('p', '', ['But can you gather the keys of memory? Only they will open the path to your future.']),
      h('p', '', ['There are seven keys to find. It is up to you to seek them.']),
    ]),
    h('div', 'apparition-smoke', ['☁️ ☁️ ☁️']),
  ]);
  document.body.append(box);
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!signal.aborted) fn(); }, ms); timers.add(id); };
  later(() => box.classList.add('speaking'), 1600);
  later(() => { box.classList.add('riffing'); sfx.guitarRiff(); }, 10700);
  later(() => box.classList.add('vanishing'), 15000);
  return new Promise((resolve) => {
    const end = () => {
      for (const timer of timers) clearTimeout(timer);
      box.remove();
      resolve(undefined);
    };
    later(end, 17000);
    signal.addEventListener('abort', end, { once: true });
  });
}

const cutscenes = createCutscenes({
  play: playMoment,
  ack: (upTo) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    acksSent++;
    ws.send(JSON.stringify({ t: 'ack', upTo }));
  },
  canPlay: canPlayCutscene,
  content: () => content.get(),
  nameOf: (ch) => nameOf(ch, campaign ?? undefined),
  ackDelay: () => 200 + Math.random() * 1300,
});
setInterval(() => cutscenes.poke(), 500); // a deferred moment starts once the minigame ends

/** Server → screen messages; any other `t` is ignored (forward-compatibility rule, PROTOCOL.md). */
/** @type {Record<string, (msg: any) => void>} */
const HANDLERS = {
  view: (msg) => {
    syncClock(msg.now);
    if (msg.campaign) campaign = msg.campaign;
    const ready = content.sync(msg.contentVersion);
    /** @type {MinigameView | null} */
    const minigame = msg.minigame ?? null;
    if (!campaign) return;
    const online = Array.isArray(msg.online) ? msg.online : [];
    onlineNow = online;
    presence.update(online, campaign.party.order.filter((id) => !campaign?.party.players[id].left));
    if (minigame && screenOf(minigame.kind)) showMinigame(minigame, campaign);
    else {
      // no minigame: the room at a tableau, or the hub / world map (re-drawn once fresh content arrives)
      showPlace(campaign);
      ready.then(() => { if (campaign && !shownMinigame) showPlace(campaign); });
    }
    gap = false;
    if (campaign) cutscenes.update(campaign.news, campaign.newsSeq);
  },
  pos: (msg) => { avatars.onPos(msg); minigameAvatars.onPos(msg); },
  jump: (msg) => avatars.onJump(msg),
  unsaved: (msg) => running?.screen.message(msg), // the running minigame's own; none running: ignored
  say: (msg) => { avatars.onSocial(msg); minigameAvatars.onSocial(msg); },
  emote: (msg) => { avatars.onSocial(msg); minigameAvatars.onSocial(msg); },
  interact: (msg) => party.onInteract(msg),
  tick: (msg) => syncClock(msg.now), // liveness (any message feeds the watchdog) + clock skew
  joinQr: (msg) => { syncClock(msg.now); onJoinQr(msg.until); },
};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  // silent for 25 s (no tick, no view) → half-open: abandon it like after a sleep
  const live = createLiveness({ onDead: () => { if (ws === sock) reconnectNow('no message for 25 s'); } });
  // a connect attempt can hang in CONNECTING (no open, no close): never wait on it forever
  const openTimer = setTimeout(() => {
    if (ws === sock && sock.readyState === WebSocket.CONNECTING) reconnectNow('connect timeout');
  }, CONNECT_TIMEOUT_MS);
  // every listener checks `ws === sock`: an abandoned socket (see reconnectNow) can never act again
  sock.addEventListener('open', () => {
    clearTimeout(openTimer);
    if (ws !== sock) { live.stop(); return; }
    live.start();
    document.body.classList.remove('offline');
    // Positions are server memory: after a reconnect its pos snapshot (or, after a server restart,
    // each phone's spawn point) is the truth — not where this TV last drew the avatars.
    avatars.reset();
    party.reset();
    gap = true;
    sock.send(JSON.stringify({ t: 'hello', role: 'screen' }));
    loadJoinInfo(); // a fresh evening since (restart, /?reset=1) has a new room code
  });
  sock.addEventListener('message', (ev) => {
    if (ws !== sock) { live.stop(); return; }
    live.feed();
    /** @type {{ t?: string }} */
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    HANDLERS[String(msg.t)]?.(msg); // a screen is never bumped: `replaced` is not for it and is ignored
  });
  sock.addEventListener('close', () => {
    clearTimeout(openTimer);
    live.stop();
    if (ws !== sock) return;
    console.info('[itloe] socket closed — retrying');
    document.body.classList.add('offline');
    setTimeout(connect, RECONNECT_MS);
  });
}

/**
 * Drops the current socket and opens a new one at once. After a sleep the old socket may be
 * half-open: the server already terminated it, but this side never hears the FIN and close() can
 * hang — so it is abandoned (its listeners go inert) instead of waited for.
 * @param {string} why
 */
function reconnectNow(why) {
  // wake and liveness can both fire on the same wake-up: keep a reconnect already under way
  if (why !== 'connect timeout' && ws?.readyState === WebSocket.CONNECTING && Date.now() - lastReconnectAt < 3000) return;
  lastReconnectAt = Date.now();
  const old = ws;
  ws = null;
  console.info(`[itloe] reconnecting (${why})`);
  document.body.classList.add('offline');
  try { old?.close(); } catch { /* already closing */ }
  connect();
}

let lastReconnectAt = 0;

// Wake detection: timers do not run while the laptop sleeps (or the tab is frozen), wall time does.
// Hidden tabs are skipped (Chrome throttles their timers to ~1/min, which is not a sleep);
// a tab shown again after a long hide reconnects instead.
let lastTick = Date.now();
let hiddenAt = 0;
setInterval(() => {
  const t = Date.now();
  if (t - lastTick > WAKE_GAP_MS && document.visibilityState === 'visible') {
    reconnectNow(`woke after ${Math.round((t - lastTick) / 1000)} s`);
  }
  lastTick = t;
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const away = Date.now() - hiddenAt;
  lastTick = Date.now();
  if (hiddenAt && away > WAKE_GAP_MS) reconnectNow(`shown again after ${Math.round(away / 1000)} s`);
});
addEventListener('online', () => reconnectNow('network back'));

installAudioUnlock();
onAudioState((st) => {
  soundHint.dataset.state = st;
  soundHint.textContent = st === 'locked' ? '🔇 Click anywhere for sound' : st === 'muted' ? '🔇 Muted (M)' : '';
});
/** The join info, redrawn in the room when it changed. */
function loadJoinInfo() {
  fetchJoinInfo().then((info) => {
    const changed = info.code !== joinInfo.code || info.url !== joinInfo.url;
    joinInfo = info;
    if (changed && roomIds !== null && campaign) showRoom(campaign);
  });
}
connect();

/** @type {any} */ (window).bloko = {
  /** The minigame shown: { kind, status, view, shows, required }; null while none runs. */
  minigame: () => shownMinigame,
  /** Feed a fake `pos` (self-tests before the server relays them). @param {object} m */
  pos: (m) => avatars.onPos(m),
  /** What the TV draws now, per player: while a minigame runs, its walkers and wisps over its screen, otherwise the room's
   *  characters. `drawnAs`: 'character' or 'wisp'. */
  avatars: () => (shownMinigame ? minigameAvatars.snapshot().filter((a) => minigameWalkers.includes(a.id)) : avatars.snapshot())
    .map((a) => ({ ...a, drawnAs: a.statuses.includes('wisp') ? 'wisp' : 'character' })),
  /** Contract G: the party room's paint order, back to front (prop ids and player ids interleaved). */
  drawOrder: () => party.drawOrder(),
  /** Contract G: the room's colliders and prop anchors. */
  scene: () => party.scene(),
  offline: () => [...presence.offline()],
  campaign: () => campaign,
  doors: () => party.doors(),
  joinQr: () => ({ ...joinQrState(joinWindow, serverNow()), until: joinWindow?.until ?? null }),
  cutscene: () => ({ playing: cutscenes.playing(), maxShown: cutscenes.maxShown(), acks: acksSent, moments: momentsPlayed,
    text: document.querySelector('.cutscene')?.textContent ?? null }),
  contentVersion: () => content.version(),
  /** Tests: simulate a wake from sleep. */
  wake: () => reconnectNow('debug wake'),
};
