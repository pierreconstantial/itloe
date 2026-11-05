// P4 — /screen: the TV page. Renders purely from each { t: 'view', state } (PROTOCOL.md);
// juice (sound, particles, call-outs, shake) reacts to events derived from consecutive views.
// Dev console: bloko.render(state).

import { renderLobby, fetchJoinInfo, fallbackJoinInfo } from './lobby-view.js';
import { summarizeSettings } from '../commun/settings-text.js';
import { renderGame } from './game-view.js';
import { renderPodium, revealSchedule } from './podium-view.js';
import { detectEvents, calloutsFor } from './events.js';
import { sfx, installAudioUnlock, onAudioState } from './audio.js';
import * as fx from './fx.js';
import { syncClock, secondsLeft, serverNow } from '../commun/clock.js';
import { updateCountdown } from './countdown.js';
import { legalPlacementCount } from '../../shared/board.js';
import { createPartyRoom } from './party-room.js';
import { createAvatarLayer } from './avatar-layer.js';
import { createPresence } from './presence.js';
import { createLiveness } from '../commun/liveness.js';
import { h } from './dom.js';
import { createContentSource } from '../commun/content.js';
import { doorStates, mapCopy, nameOf } from './doors.js';
import { roomAt } from '../../shared/campaign/content.js';
import { createCutscenes } from './cutscenes.js';
import { renderQuiz, renderQuizRoom } from './quiz-view.js';
import { applyJoinQr, joinQrState } from './join-qr.js';
import { INTRO_KEY, OPENING_PLAYERS, REUNIONS } from '../../shared/campaign/story.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('./events.js').ScreenEvent} ScreenEvent */

const RECONNECT_MS = 1000;
/** A socket still CONNECTING after this is abandoned and retried (Chrome throttles/queues attempts after failures). */
const CONNECT_TIMEOUT_MS = 5000;
/** Timers stopped for longer than this (laptop asleep, tab frozen) → the socket is presumed dead. */
const WAKE_GAP_MS = 5000;
/** How long "Time's up!" holds the screen before the podium reveal starts. */
const TIMES_UP_MS = 2600;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
/** Every player's avatar, whatever screen is showing. */
const avatars = createAvatarLayer();
const party = createPartyRoom(
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-bg')),
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-fg')),
  avatars,
);
const soundHint = /** @type {HTMLElement} */ (document.getElementById('sound-hint'));

/** @type {State | null} */
let current = null;
/** After a reconnect the previous view is stale: render, but don't replay what was missed. */
let stale = false;
/** performance.now() when the current game finished (podium sequence clock). */
let finishedAt = -Infinity;
/** @type {WebSocket | null} */
let ws = null;
/** @type {import('./lobby-view.js').JoinInfo} */
let joinInfo = fallbackJoinInfo();
/** Pending podium sounds/confetti: cancelled as soon as the phase leaves 'finished' (rematch, back to the room). */
const podiumTimers = new Set();

/** setTimeout tracked in podiumTimers. @param {() => void} fn @param {number} ms */
function podiumLater(fn, ms) {
  const id = setTimeout(() => { podiumTimers.delete(id); fn(); }, ms);
  podiumTimers.add(id);
}

function cancelPodium() {
  for (const id of podiumTimers) clearTimeout(id);
  podiumTimers.clear();
}

/** Who has dropped (debounced): dims their board / avatar so the host can say "tap your character". */
const presence = createPresence({ onChange: applyPresence });

/** Seated players who can be offline (a left player is gone, not offline). @param {State} s */
const seated = (s) => s.order.filter((id) => s.players[id] && !/** @type {{ left?: boolean }} */ (s.players[id]).left);

/** Marks offline players on the current DOM and in the party room, without a re-render. */
function applyPresence() {
  const off = presence.offline();
  for (const el of app.querySelectorAll('[data-id]')) {
    el.classList.toggle('is-offline', off.has(/** @type {HTMLElement} */ (el).dataset.id ?? ''));
  }
  avatars.setOffline(off);
}

/** The story's start tableau after its first match: the portal stands in the room, and no round follows. */
const portalReady = () => !!campaign?.facts.flags.includes('story.elo-50') && campaign.facts.flags.includes('portal.ready')
  && campaign.at.node === 'hub.false-start';

/** The tableau's settings: the campaign keeps them (null where no minigame is). @returns {any} */
const tableauSettings = () => campaign?.at.settings ?? null;

/** @type {Record<State['phase'], (s: State, prev: State | null) => HTMLElement>} */
const VIEWS = {
  lobby: (s, prev) => renderLobby(s, prev, joinInfo, { title: 'ITLOE', settings: summarizeSettings(tableauSettings()) }, portalReady()
    ? { status: 'A portal has appeared. Élodie, walk into it!' } : {
      required: campaign?.facts.flags.includes('story.elo-50') && campaign.at.node === 'hub.false-start'
        ? OPENING_PLAYERS.length : undefined,
    }),
  playing: (s, prev) => renderGame(s, prev, { danger: playersInDanger(s) }),
  finished: (s) => renderPodium(s, performance.now() - finishedAt, { next: summarizeSettings(tableauSettings()), again: !portalReady() }),
};

/** Fewer legal placements than this (and more than 0) → the board frame pulses. */
const DANGER_BELOW = 3;

/**
 * @param {State} s
 * @returns {Set<string>}
 */
function playersInDanger(s) {
  return new Set(s.order.filter((id) => {
    const p = s.players[id];
    if (p.done) return false;
    const n = legalPlacementCount(p.board, s.size, p.hand, DANGER_BELOW);
    return n > 0 && n < DANGER_BELOW;
  }));
}

/** @param {State} next */
function show(next) {
  leaveQuiz();
  const prev = stale ? null : current;
  stale = false;
  current = next;
  const events = detectEvents(prev, next);
  const finished = events.find((e) => e.t === 'finished');
  if (finished) finishedAt = performance.now() + (finished.t === 'finished' && finished.reason === 'time' ? TIMES_UP_MS : 0);
  if (next.phase !== 'finished') {
    finishedAt = -Infinity;
    cancelPodium();
  }
  if (next.phase === 'lobby') fx.clearAll();

  app.replaceChildren(VIEWS[next.phase](next, prev));
  party.setRoom(roomAt(content.get(), campaign?.at.node));
  party.setPortal(portalReady());
  party.setKey(false);
  party.setPlayers(next);
  party.setVisible(next.phase === 'lobby');
  document.body.classList.toggle('party', next.phase === 'lobby');
  updateCountdown(next);
  applyPresence();
  // the game ending in this very view (bell, host's endGame) marks everyone done at once:
  // its own sound covers it, so no pile of per-player "done" sounds
  const endsNow = events.some((e) => e.t === 'finished');
  for (const e of events) if (!(endsNow && e.t === 'done')) react(e, next);
}

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */

/** Campaign content (titles, doors): fetched from the server, refreshed on a new contentVersion. */
const content = createContentSource({ onChange: () => { if (campaign && !current) showMap(campaign); } });
/** Last campaign from the server (views carry it next to `round`). @type {Campaign | null} */
let campaign = null;

/**
 * Hub / world map (no block game on): the party room with one door per child node, avatars walking
 * as in the lobby, and a top band with where we are. The next block view starts fresh.
 * @param {Campaign} c
 */
function showMap(c) {
  leaveQuiz();
  if (current) {
    current = null;
    finishedAt = -Infinity;
    cancelPodium();
    fx.clearAll();
  }
  stale = true;
  updateCountdown(null);
  const storyScene = c.facts.flags.includes('story.elo-50') && c.facts.flags.includes('portal.entered');
  const inApartment = storyScene && c.at.node === 'hub';
  const visibleIds = !storyScene ? c.party.order : c.party.order.filter((id) => {
    const member = c.party.players[id];
    return member?.character === 'elodie' || c.facts.flags.includes(`person.${member?.character}.unlocked`);
  });
  party.setPlayers({ ...c.party, order: visibleIds });
  party.setRoom(roomAt(content.get(), c.at.node));
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

// ---------- quiz (the round's view: the public projection — never the answer before the reveal) ----------

/** @typedef {import('../../shared/quiz/bank.js').QuizView} QuizView */
/** @type {QuizView | null} */
let quiz = null;
/** performance.now() when the quiz finished (its podium reveal clock). */
let quizFinishedAt = -Infinity;
let lastQuizTick = Infinity;

/** @param {QuizView} q */
function showQuiz(q) {
  if (current) {
    current = null;
    finishedAt = -Infinity;
    fx.clearAll();
  }
  stale = true;
  updateCountdown(null);
  // the quiz's lobby is the party room, as in a block lobby: avatars walk under the band
  const room = q.phase === 'lobby';
  party.setRoom(roomAt(content.get(), campaign?.at.node));
  party.setPortal(false);
  party.setKey(false);
  party.setPlayers(q);
  party.setVisible(room);
  party.setDoors([]);
  document.body.classList.toggle('party', room);
  document.body.classList.add('in-quiz');
  const prev = quiz;
  quiz = q;
  const roundChanged = q.round && (!prev?.round || prev.round.index !== q.round.index || prev.phase === 'lobby' || prev.phase === 'finished');
  if (q.phase === 'question' && roundChanged) { lastQuizTick = Infinity; sfx.start(); }
  if (q.phase === 'reveal' && prev?.phase === 'question') sfx.reveal();
  if (q.phase === 'finished' && prev && prev.phase !== 'finished') {
    quizFinishedAt = performance.now();
    cancelPodium();
    podiumSequence(/** @type {any} */ (q));
  }
  if (q.phase !== 'finished' && prev?.phase === 'finished') cancelPodium();
  app.replaceChildren(room ? renderQuizRoom(q, joinInfo, tableauSettings())
    : renderQuiz(q, prev ? performance.now() - quizFinishedAt : Infinity, tableauSettings()));
  drawQuizRing();
}

/** Leaving the quiz (back to a map or a block game): its podium sounds stop. */
function leaveQuiz() {
  if (!quiz) return;
  quiz = null;
  quizFinishedAt = -Infinity;
  cancelPodium();
  document.body.classList.remove('in-quiz');
}

/** Countdown ring of the open question: server deadline + clock skew; ticks in the last 5 s. */
function drawQuizRing() {
  const ring = /** @type {HTMLElement | null} */ (app.querySelector('.quiz-ring'));
  if (!quiz || quiz.phase !== 'question' || !quiz.round || !ring) return;
  const total = Math.max(1, quiz.rules?.seconds ?? 20);
  const left = Math.max(0, secondsLeft(quiz.round.deadline));
  const whole = Math.ceil(left);
  ring.style.setProperty('--left', String(Math.min(1, left / total)));
  ring.classList.toggle('is-urgent', left <= 5);
  const num = ring.querySelector('.quiz-ring-num');
  if (num) num.textContent = String(whole);
  if (left <= 5 && whole > 0 && whole < lastQuizTick) sfx.tick(whole);
  lastQuizTick = Math.min(lastQuizTick, whole);
}
setInterval(drawQuizRing, 100);

// ---------- "show the QR again" (any player asks; screens get { t:'joinQr', until }) ----------
// A side card with the join QR + room code + a shrinking bar. While it is open the block arena and
// the quiz make room for it (body.join-qr-open), so it never covers a board or a question.

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

/** A moment may start: no block game or quiz question running, and a podium has finished its reveal. */
function canPlayCutscene() {
  // a hidden TV tab plays nothing (and so never acks what nobody saw); it plays once shown again
  if (document.visibilityState !== 'visible') return false;
  if (quiz) return quiz.phase === 'lobby' || quiz.phase === 'finished';
  if (!current) return true;
  if (current.phase === 'lobby') return true;
  if (current.phase !== 'finished') return false;
  const reveal = Math.max(0, ...revealSchedule(current).map((r) => r.atMs));
  return performance.now() - finishedAt > reveal + 1800;
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
setInterval(() => cutscenes.poke(), 500); // a deferred moment starts once the podium settles

/**
 * @param {ScreenEvent} e
 * @param {State} s
 */
function react(e, s) {
  switch (e.t) {
    case 'joined':
      sfx.joined();
      break;
    case 'start':
      sfx.start();
      break;
    case 'move': {
      const m = e.move;
      sfx.place();
      fx.scoreFloater(m.id, m.gained);
      if (m.lines === 0) break;
      fx.clearEffect(m, s.size);
      fx.shake(m.lines);
      sfx.clear(m.lines);
      if (m.streak >= 2) sfx.combo(m.streak);
      if (m.cleanBoard) sfx.cleanBoard();
      fx.callout(m.id, calloutsFor(m), m.color);
      break;
    }
    case 'done':
      sfx.done();
      break;
    case 'finished':
      if (e.reason === 'time') {
        sfx.bell();
        fx.timesUp(TIMES_UP_MS);
        podiumLater(() => podiumSequence(s), TIMES_UP_MS);
      } else {
        podiumSequence(s);
      }
      break;
  }
}

/** Sounds + confetti in step with the podium's CSS reveal (same schedule). @param {State} s */
function podiumSequence(s) {
  const schedule = revealSchedule(s);
  const championAt = Math.min(...schedule.filter((r) => r.rank === 1).map((r) => r.atMs));
  const steps = new Set(schedule.filter((r) => r.rank > 1).map((r) => r.atMs));
  for (const at of steps) podiumLater(() => sfx.reveal(), at);
  podiumLater(() => {
    sfx.fanfare();
    fx.confetti(schedule.filter((r) => r.rank === 1).map((r) => fx.colorHex(s.players[r.id].color)).concat('#ffd166', '#ffffff'));
  }, championAt);
}

/** Server → screen messages; any other `t` is ignored (forward-compatibility rule, PROTOCOL.md). */
/** @type {Record<string, (msg: any) => void>} */
const HANDLERS = {
  view: (msg) => {
    syncClock(msg.now);
    if (msg.campaign) campaign = msg.campaign;
    const ready = content.sync(msg.contentVersion);
    /** @type {import('../../shared/minigames.js').RoundView | null} */
    const round = msg.round ?? null;
    if (round?.kind === 'quiz') {
      showQuiz(round.view);
      presence.update(Array.isArray(msg.online) ? msg.online : [], round.view.order.filter((/** @type {string} */ id) => !round.view.players[id]?.left));
    } else if (round?.kind !== 'blocks') {
      if (!campaign) return;
      // campaign hub / world: no block game on → the map; re-drawn once fresh content arrives
      showMap(campaign);
      ready.then(() => { if (campaign && !current) showMap(campaign); });
      presence.update(Array.isArray(msg.online) ? msg.online : [], campaign.party.order.filter((id) => !campaign?.party.players[id].left));
    } else {
      party.setDoors([]);
      show(round.view);
      presence.update(Array.isArray(msg.online) ? msg.online : [], seated(round.view));
    }
    if (campaign) cutscenes.update(campaign.news, campaign.newsSeq);
  },
  pos: (msg) => avatars.onPos(msg),
  say: (msg) => avatars.onSocial(msg),
  emote: (msg) => avatars.onSocial(msg),
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
    sock.send(JSON.stringify({ t: 'hello', role: 'screen' }));
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
    stale = true;
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
  stale = true;
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
connect();
fetchJoinInfo().then((info) => {
  joinInfo = info;
  if (current?.phase === 'lobby') app.replaceChildren(VIEWS.lobby(current, current));
  else if (quiz?.phase === 'lobby') app.replaceChildren(renderQuizRoom(quiz, joinInfo, tableauSettings()));
});

/** @type {any} */ (window).bloko = {
  state: () => current,
  /** @param {State} s */
  render: (s) => show(s),
  /** Feed a fake `pos` (self-tests before the server relays them). @param {object} m */
  pos: (m) => avatars.onPos(m),
  avatars: () => avatars.snapshot(),
  /** Contract G: the party room's paint order, back to front (prop ids and player ids interleaved). */
  drawOrder: () => party.drawOrder(),
  /** Contract G: the room's colliders and prop anchors. */
  scene: () => party.scene(),
  offline: () => [...presence.offline()],
  campaign: () => campaign,
  doors: () => party.doors(),
  quiz: () => quiz,
  joinQr: () => ({ ...joinQrState(joinWindow, serverNow()), until: joinWindow?.until ?? null }),
  cutscene: () => ({ playing: cutscenes.playing(), maxShown: cutscenes.maxShown(), acks: acksSent, moments: momentsPlayed,
    text: document.querySelector('.cutscene')?.textContent ?? null }),
  contentVersion: () => content.version(),
  /** Tests: simulate a wake from sleep. */
  wake: () => reconnectNow('debug wake'),
};
