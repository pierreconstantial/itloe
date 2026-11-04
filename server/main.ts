// Bloko server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure campaign engine
// (the evening: party, hub/worlds/tableaux, facts, news) with the block game nested as its activity.
// Every change goes through apply() → solo best, save to disk, arm the timed-mode clock, doors, broadcast.
// Run: npm start          (resumes the saved evening in any state; a timed clock keeps its remaining time)
//      npm start -- --new (or BLOKO_NEW=1: always a fresh evening)
// Env: PORT (3131), BLOKO_HOST (LAN interface or address), BLOKO_VAR (data dir, default var/)

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import qrcodeTerminal from 'qrcode-terminal';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { makeApiHandler } from './http-api.ts';
import { pickLan } from './lan.ts';
import { makeClock } from './clock.ts';
import { activityDeadline, isQuiz, shiftActivityDeadline, type ActivityState } from './resume.ts';
import { loadBank, makeQuizClock, nullJudge, withTimeout } from './quiz.ts';
import { candidatesFor, judgeAnswer, projectQuiz } from '../shared/quiz/bank.js';
import { MAX_TEXT, type QuizAction, type QuizState } from '../shared/quiz/index.js';
import { makeBests } from './bests.ts';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import type { CharacterId } from '../shared/campaign/types.js';
import { canMove, makePositions, parsePos, posMsg, type Pos } from './pos.ts';
import { loadGame, saveGame, STATE_FILE, type Game } from './store.ts';
import type { ServerAction, Settings, State } from './rules.ts';
import {
  CONTENT, CONTENT_VERSION, assertContent, reduceCampaign, isUnlocked, zoneAt,
  type Campaign, type CampaignAction, type GmOp,
} from './campaign.ts';

type ErrCode = 'full' | 'bad-place' | 'not-host' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room' | 'taken' | 'refused';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';

// ---------- the evening + change hooks (wrap the engine, never inside it) ----------

assertContent(CONTENT); // broken content: refuse to boot, with every problem listed
const loaded = loadGame(FORCE_NEW, CONTENT);
const game: Game = { campaign: loaded.campaign, room: loaded.room, bestPrevious: loaded.bestPrevious ?? null };

/** The quiz question bank (data/quiz/*.json): validated at boot, never served (it holds the answers). */
const bank = loadBank();
/** Typed answers the local matcher finds 'uncertain' go to this judge (E1: the null judge for now). */
const JUDGE_TIMEOUT_MS = 4000;
const judge = withTimeout(nullJudge, JUDGE_TIMEOUT_MS);

/** The campaign's nested activity (block game or quiz), or null on the hub / in a world / a scene. */
const activity = (): ActivityState | null => game.campaign.at.activity;
/** The block game, when that is what runs (block-only messages, bests, the block clock). */
const blocks = (): State | null => { const s = activity(); return s && !isQuiz(s) ? s : null; };
/** The quiz, when that is what runs. */
const quiz = (): QuizState | null => { const s = activity(); return isQuiz(s) ? s : null; };
const party = () => game.campaign.party;

const bests = makeBests(game);

// beat() first: after a suspend, the overdue bell may run before the heartbeat; the beat shifts the
// deadline, so this timeUp no longer matches it and the reducer ignores it (the new one is armed).
const clock = makeClock((deadline) => { beat(); applyGame({ t: 'timeUp', deadline }); });
const quizClock = makeQuizClock((deadline) => { beat(); applyQuiz({ t: 'close', deadline }); });

/** Avatar positions: in memory only, outside the reducer (see pos.ts). */
const positions = makePositions<WebSocket>();
/** Door each walker currently stands in (edge trigger: entering a door fires once). In memory only. */
const zones = new Map<string, string | null>();

const onChange: ((prev: Campaign, next: Campaign) => void)[] = [
  (prev, next) => { // before saveGame: it sets game.bestPrevious (solo block games only)
    const a = prev.at.activity, b = next.at.activity;
    if (a && b && !isQuiz(a) && !isQuiz(b)) bests.onChange(a, b);
    else if (!b || isQuiz(b)) game.bestPrevious = null;
  },
  () => saveGame(game), // ONE atomic save per step: a finished game and its recorded facts land together
  (prev, next) => {
    const a = prev.at.activity, b = next.at.activity;
    if (b && !isQuiz(b)) clock.onChange(a && !isQuiz(a) ? a : null, b);
    if (isQuiz(b)) quizClock.onChange(isQuiz(a) ? a : null, b);
  },
  (_prev, next) => positions.prune(next.party),
  (prev, next) => { if (prev.at.node !== next.at.node) resetZones(); },
  () => broadcast(),
];

/** Runs an action through the campaign engine; returns false when it was refused (state unchanged). */
function apply(action: CampaignAction): boolean {
  return commit(reduceCampaign(game.campaign, action, CONTENT));
}

/** A block-game action, already rebuilt field by field, into the nested activity. */
function applyGame(action: ServerAction): boolean {
  return blocks() !== null && apply({ t: 'activity', action });
}

/** A quiz action, already rebuilt field by field (ids, now, candidates, verdicts injected here). */
function applyQuiz(action: QuizAction): boolean {
  return quiz() !== null && apply({ t: 'activity', action });
}

/** Installs a new campaign and runs every change hook; false when nothing changed. */
function commit(next: Campaign): boolean {
  const prev = game.campaign;
  if (next === prev) return false;
  game.campaign = next;
  for (const hook of onChange) hook(prev, next);
  return true;
}

// ---------- timed-pause heartbeat ----------
// While a timed game runs, re-save every second so savedAt is never more than ~1 s older than a
// kill -9 (the resume shift then gives back at most ~1 s too much). The same beat notices a
// suspended process (laptop lid closed: timers stop, wall time does not) and pauses the clock by
// the gap — the deadline is a server-owned input, like `now`, so shifting it here keeps reduce pure.
const BEAT_MS = 1000;
const SUSPEND_GAP_MS = 3000;
let lastBeat = Date.now();
function beat(): void {
  const now = Date.now();
  const gap = now - lastBeat;
  lastBeat = now;
  const c = game.campaign;
  const s = c.at.activity;
  if (activityDeadline(s) === null || !s) return; // nothing on a clock (a timed block game, an open quiz question)
  const shifted = gap > SUSPEND_GAP_MS ? shiftActivityDeadline(s, now - gap + BEAT_MS, now) : s;
  // a server-owned input moved: installed directly (not an engine transition), like the resume shift
  if (shifted !== s && commit({ ...c, at: { ...c.at, activity: shifted } })) {
    console.log(`[bloko] process was suspended ${Math.round(gap / 1000)} s — timed clock paused for that long`);
    return; // commit saved + broadcast
  }
  saveGame(game);
}
setInterval(beat, BEAT_MS).unref();

// ---------- HTTP ----------

const lan = await pickLan();
const serveStatic = makeStaticHandler(ROOT);
/** The address phones open (the QR's content); without a LAN IP, the host the request came in on. */
const joinUrl = (hostHeader?: string): string =>
  `http://${lan ? `${lan.address}:${PORT}` : (hostHeader ?? `localhost:${PORT}`)}/play?room=${game.room}`;
const serveApi = makeApiHandler((req) => ({ url: joinUrl(req?.headers.host), code: game.room }), { version: CONTENT_VERSION, data: CONTENT });

const httpServer = createServer((req, res) => {
  serveApi(req, res)
    .then((handled) => (handled ? undefined : serveStatic(req, res)))
    .catch((e) => {
      console.error('[bloko] http error:', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

// ---------- WebSocket protocol ----------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/** playerId of each identified player socket */
const who = new Map<WebSocket, string>();
/** live socket of each player (rejoin replaces it) */
const sockets = new Map<string, WebSocket>();
/** sockets whose hello carried the right room code (allowed to join) */
const roomOk = new WeakSet<WebSocket>();
/** sockets that said hello as a screen: the only receivers of pos */
const screens = new Set<WebSocket>();

/** Presence (ephemeral, never in State or on disk): party members with a live socket, in party order. */
const online = (): string[] => party().order.filter((id) => sockets.get(id)?.readyState === WebSocket.OPEN);

/** `state` = the nested block game (null outside one), kept for clients that read it directly;
 *  `campaign` = the whole evening (TV hub/cutscenes, phone host panel). */
/** The public quiz (never an answer before the reveal: shared/quiz/bank.js projectQuiz). */
const publicQuiz = (s: QuizState) => projectQuiz(s, (id) => bank.byId.get(id));

/** `state` stays the BLOCK game only (null during a quiz: block clients never see a quiz); `quiz` is the
 *  projected quiz; the campaign travels with its quiz projected the same way (raw verdicts would leak). */
const viewMsg = () => {
  const b = blocks();
  const q = quiz();
  const pq = q ? publicQuiz(q) : null;
  const campaign = pq ? { ...game.campaign, at: { ...game.campaign.at, activity: pq } } : game.campaign;
  return JSON.stringify({
    t: 'view', state: b, quiz: pq, campaign, contentVersion: CONTENT_VERSION,
    online: online(), now: Date.now(), best: b ? bests.view(b) : undefined,
  });
};

function send(ws: WebSocket, data: string | object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data));
}

function broadcast(): void {
  const msg = viewMsg();
  for (const c of wss.clients) send(c, msg);
}

function relayPos(playerId: string, pos: Pos): void {
  const msg = posMsg(playerId, pos);
  for (const c of screens) send(c, msg);
}

/** welcome, then the player's own last pos (the one pos a phone receives) so it resumes where its avatar stands. */
function welcome(ws: WebSocket, playerId: string): void {
  send(ws, { t: 'welcome', playerId });
  const pos = positions.get(playerId);
  if (pos) send(ws, posMsg(playerId, pos));
}

function sendErr(ws: WebSocket, code: ErrCode): void {
  send(ws, { t: 'err', code });
}

/** Forget a player's socket binding (the socket stays open as a fresh client). */
function detach(playerId: string): void {
  const ws = sockets.get(playerId);
  if (ws) who.delete(ws);
  sockets.delete(playerId);
}

/** Close code sent with `replaced` (4000–4999: application range). */
const CLOSE_REPLACED = 4001;

/**
 * Attach a socket to a playerId. Newest socket wins: a previous socket of that player (old device
 * after a reclaim, second tab) gets `replaced` and is closed. A socket that held another id lets it go.
 * Callers broadcast afterwards: presence changed.
 */
function attach(ws: WebSocket, playerId: string): void {
  const old = sockets.get(playerId);
  if (old && old !== ws) {
    who.delete(old);
    send(old, { t: 'replaced' });
    old.close(CLOSE_REPLACED, 'replaced');
  }
  const prevId = who.get(ws);
  if (prevId && prevId !== playerId && sockets.get(prevId) === ws) sockets.delete(prevId);
  sockets.set(playerId, ws);
  who.set(ws, playerId);
}

/** The party member (not left) holding a character, if any. Left members' characters are free, never reclaimable. */
function holderOf(character: string): string | undefined {
  const p = party();
  return p.order.find((id) => !p.players[id].left && p.players[id].character === character);
}

/** In the evening's party and has not left it: a stored id that may rejoin. */
const isMember = (id: unknown): id is string => typeof id === 'string' && !!party().players[id] && !party().players[id].left;

const isOnline = (playerId: string): boolean => sockets.get(playerId)?.readyState === WebSocket.OPEN;

/** Why a (non-reclaim) join was refused: every character held → full; held by an online member → taken
 *  while a block lobby (or no game) is open, full while a game is under way; not a character → taken. */
function joinRefusal(): ErrCode {
  const held = new Set(party().order.filter((id) => !party().players[id].left).map((id) => party().players[id].character));
  if (Object.keys(CHARACTERS).every((c) => held.has(c as CharacterId))) return 'full';
  const s = activity();
  return s && s.phase !== 'lobby' ? 'full' : 'taken';
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Edge-triggered doors: entering one fires `zone.entered` (any member) and, for the chooser on an
 *  unlocked door, `enter` (A1: Élodie walks into a door; the host can always enter directly). */
function walk(id: string, pos: Pos): void {
  const c = game.campaign;
  const zone = zoneAt(CONTENT, c.at.node, pos.x, pos.y);
  // a walker's first known position (new phone, or after a restart wiped this memory) only sets the
  // baseline: standing in a door is not stepping into it
  const known = zones.has(id);
  const before = zones.get(id) ?? null;
  zones.set(id, zone);
  if (!known || !zone || zone === before) return;
  const character = c.party.players[id]?.character;
  if (!character) return;
  apply({ t: 'event', event: { t: 'zone.entered', zone, character } });
  if (character === CONTENT.chooser && isUnlocked(game.campaign, zone)) apply({ t: 'enter', id, node: zone });
}

/** The party moved to another node: every walker's door is re-read on the new map, so standing where
 *  a door now is does not fire it — only a fresh step in does. */
function resetZones(): void {
  zones.clear();
  for (const [id, pos] of positions.entries()) zones.set(id, zoneAt(CONTENT, game.campaign.at.node, pos.x, pos.y));
}

function handleMessage(ws: WebSocket, m: any): void {
  if (m.t === 'hello') {
    const rejoin = m.role === 'player' && isMember(m.playerId);
    if (rejoin) {
      attach(ws, m.playerId); // rejoin: re-attach, welcome + view (no room check: stored ids outlive a code)
      welcome(ws, m.playerId);
    }
    if (String(m.room ?? '').trim().toUpperCase() === game.room) roomOk.add(ws);
    else roomOk.delete(ws);
    // screen and fresh player get the current view; a rejoin changes presence, so everyone gets it
    if (rejoin) broadcast(); else send(ws, viewMsg());
    if (m.role === 'screen') {
      screens.add(ws);
      for (const [playerId, pos] of positions.entries()) send(ws, posMsg(playerId, pos));
    } else {
      screens.delete(ws);
    }
    return;
  }

  if (m.t === 'pos') {
    // ephemeral avatar movement: bypasses the engine (doors aside); malformed, unjoined or flooding senders dropped silently
    const id = who.get(ws);
    if (!id || !canMove(party(), id) || !positions.allow(ws)) return;
    const pos = parsePos(m);
    if (!pos) return;
    positions.set(id, pos);
    relayPos(id, pos);
    walk(id, pos);
    return;
  }

  if (m.t === 'ack') {
    // a TV finished the cutscenes up to `upTo` (screens only; the id is injected, never from the wire)
    if (screens.has(ws) && Number.isFinite(m.upTo)) apply({ t: 'ack', id: 'screen', upTo: m.upTo });
    return;
  }

  if (m.t === 'join') {
    if (!roomOk.has(ws)) { sendErr(ws, 'bad-room'); return; }
    const character = m.character;
    // reclaim ("tap your character"): a character held by an OFFLINE member is taken back by this
    // socket, in any state — same playerId, so board, score, hand, facts and host role come along
    const holder = isCharacterId(character) ? holderOf(character) : undefined;
    if (holder && !isOnline(holder)) {
      attach(ws, holder);
      welcome(ws, holder);
      broadcast();
      return;
    }
    const id = `p-${randomUUID().slice(0, 8)}`;
    if (!isCharacterId(character) || !apply({ t: 'join', id, character })) { sendErr(ws, joinRefusal()); return; }
    attach(ws, id);
    welcome(ws, id);
    broadcast(); // the join's own broadcast ran before the socket was attached: presence now includes it
    return;
  }

  // everything below needs an identified member; actions are rebuilt field by field,
  // so server-only inputs (now, deadline, timeUp) and ids can never come from the wire
  if (!['start', 'again', 'newGame', 'endGame', 'retire', 'place', 'config', 'leave', 'enter', 'back', 'gm',
    'answer', 'next', 'override'].includes(m.t)) return;
  const id = who.get(ws);
  if (!id) { sendErr(ws, 'unknown-player'); return; }
  // a quiz runs here: its own messages, and the shared names (start, endGame, newGame, config) go to it
  const q = quiz();
  if (q && !['leave', 'enter', 'back', 'gm'].includes(m.t)) { handleQuiz(ws, id, m, q); return; }
  if (['answer', 'next', 'override'].includes(m.t)) { sendErr(ws, 'not-playing'); return; }
  const s = blocks();
  const hostOfGame = s !== null && id === s.hostId;
  const phase = s?.phase ?? null;

  switch (m.t) {
    // ---- the evening ----
    case 'leave':
      // leaving the EVENING (forwarded to a live game: a lobby drops them, a game marks them done);
      // the stored id must not rejoin, so the socket goes back to being a stranger
      if (apply({ t: 'leave', id })) detach(id);
      return;

    case 'enter':
      // host, or the chooser, into an unlocked child of where the party is; refused → 'refused'
      if (typeof m.node !== 'string' || !apply({ t: 'enter', id, node: m.node })) sendErr(ws, 'refused');
      return;

    case 'back':
      // host only, up one level; refused while a game is being played (endGame first) → 'refused'
      if (!apply({ t: 'back', id })) sendErr(ws, id === party().hostId ? 'refused' : 'not-host');
      return;

    case 'gm': {
      // game master: host only; the engine validates the op (a host's no-op is not an error)
      if (!isPlainObject(m.op)) return;
      if (!apply({ t: 'gm', id, op: m.op as GmOp }) && id !== party().hostId) sendErr(ws, 'not-host');
      return;
    }

    // ---- the nested block game (no game here → not-playing) ----
    case 'start':
    case 'again':
      if (!s) { sendErr(ws, 'not-playing'); return; }
      if (!applyGame({ t: m.t, id, now: Date.now() })) sendErr(ws, 'not-host');
      return;

    case 'endGame':
      // host stops the game (someone dropped while not stuck); refused (non-host / not playing) → not-host, like again
      if (!s) { sendErr(ws, 'not-playing'); return; }
      if (!applyGame({ t: 'endGame', id })) sendErr(ws, 'not-host');
      return;

    case 'retire':
      // host takes one player out (done, still ranked, keeps seat + character). Non-host or not playing →
      // not-host; a host's no-op (unknown / already done / left target) is not an error, like config
      if (typeof m.target !== 'string') return;
      if (!applyGame({ t: 'retire', id, target: m.target }) && (!hostOfGame || phase !== 'playing')) sendErr(ws, 'not-host');
      return;

    case 'newGame':
      // podium → block lobby inside the same tableau; refused (non-host or not finished) → not-host, like again
      if (!s) { sendErr(ws, 'not-playing'); return; }
      if (!applyGame({ t: 'newGame', id })) sendErr(ws, 'not-host');
      return;

    case 'place':
      if ((m.piece !== 0 && m.piece !== 1 && m.piece !== 2) || typeof m.x !== 'number' || typeof m.y !== 'number') {
        sendErr(ws, 'bad-place');
        return;
      }
      if (!applyGame({ t: 'place', id, piece: m.piece, x: m.x, y: m.y })) {
        sendErr(ws, phase === 'playing' ? 'bad-place' : 'not-playing');
      }
      return;

    case 'config':
      if (!isPlainObject(m.patch) || !s) return;
      if (!applyGame({ t: 'config', id, patch: m.patch as Partial<Settings> })) {
        // a host's no-op patch (unknown keys/values, same settings) is not an error
        if (!hostOfGame) sendErr(ws, 'not-host');
        else if (phase === 'playing') sendErr(ws, 'locked');
      }
      return;
  }
}

/** Quiz messages (Contract E + E1). The answer is judged HERE, from the bank, and only its verdict enters
 *  the reducer; an 'uncertain' typed answer goes to the pluggable judge (bounded by a timeout). */
function handleQuiz(ws: WebSocket, id: string, m: any, q: QuizState): void {
  const host = id === q.hostId;
  const refusal = (): ErrCode => (host ? 'refused' : 'not-host');
  switch (m.t) {
    case 'start': {
      // candidates: the bank filtered by the quiz settings, minus every question asked this evening
      const candidates = candidatesFor(bank.questions, q.settings, game.campaign.facts.asked ?? []);
      if (!applyQuiz({ t: 'start', id, now: Date.now(), candidates })) sendErr(ws, refusal());
      return;
    }

    case 'answer': {
      const r = q.round;
      const question = r ? bank.byId.get(r.questionId) : undefined;
      if (q.phase !== 'question' || !r || !question) { sendErr(ws, 'not-playing'); return; }
      const given = r.asChoice
        ? (Number.isInteger(m.choice) ? { choice: m.choice as number } : null)
        : (typeof m.text === 'string' && m.text.trim() ? { text: m.text.trim().slice(0, MAX_TEXT) } : null);
      if (!given) { sendErr(ws, 'refused'); return; }
      const verdict = judgeAnswer(question, r, given);
      if (!applyQuiz({ t: 'answer', id, ...given, now: Date.now(), verdict })) { sendErr(ws, 'refused'); return; }
      if (verdict === 'uncertain' && 'text' in given) {
        const { index, questionId } = r;
        void judge(question, given.text).then((ok) => {
          const now = quiz()?.round;
          // only for the same round: a late verdict never lands on the next question's answer
          if (now && now.index === index && now.questionId === questionId) applyQuiz({ t: 'verdict', target: id, ok });
        });
      }
      return;
    }

    case 'next':
      if (!applyQuiz({ t: 'next', id, now: Date.now() })) sendErr(ws, refusal());
      return;

    case 'override':
      // host, on the reveal: any answer, both ways
      if (typeof m.target !== 'string' || typeof m.ok !== 'boolean') return;
      if (!applyQuiz({ t: 'override', id, target: m.target, ok: m.ok })) sendErr(ws, refusal());
      return;

    case 'endGame':
    case 'newGame':
      if (!applyQuiz({ t: m.t, id })) sendErr(ws, host ? 'refused' : 'not-host');
      return;

    case 'config':
      if (!isPlainObject(m.patch)) return;
      if (!applyQuiz({ t: 'config', id, patch: m.patch as Partial<QuizState['settings']> })) {
        if (!host) sendErr(ws, 'not-host');
        else if (q.phase === 'question' || q.phase === 'reveal') sendErr(ws, 'locked');
      }
      return;

    default: // block-only (again, place, retire): not a quiz thing
      sendErr(ws, 'not-playing');
  }
}

// Dead-socket sweep: a phone that vanished (battery, Wi-Fi, lid) often never sends a TCP close, and
// would stay "online" — blocking its character's reclaim. Ping every PING_MS; no pong by the next
// sweep → terminate (close handler then broadcasts it offline). Browsers answer pings natively.
const PING_MS = 5000;
const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const c of wss.clients) {
    if (!alive.has(c)) { c.terminate(); continue; }
    alive.delete(c);
    c.ping();
  }
}, PING_MS).unref();

// Liveness tick: every open socket hears from the server at least every TICK_MS, so a client
// that hears NOTHING for 25 s knows its socket is half-open and reconnects (public/commun/liveness.js).
// It carries `now`, refreshing every client's clock skew for free.
const TICK_MS = 10_000;
setInterval(() => {
  const msg = JSON.stringify({ t: 'tick', now: Date.now() });
  for (const c of wss.clients) send(c, msg);
}, TICK_MS).unref();

wss.on('connection', (ws) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  send(ws, viewMsg()); // screen gets a view immediately on connect

  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m === null || typeof m !== 'object') return;
    try {
      handleMessage(ws, m);
    } catch (e) {
      // a bad message or a reducer bug must not kill the game for everyone
      console.error('[bloko] message handling failed:', e);
    }
  });

  ws.on('close', () => {
    screens.delete(ws);
    const id = who.get(ws);
    who.delete(ws);
    if (id && sockets.get(id) === ws) {
      sockets.delete(id);
      broadcast(); // presence: this player is offline now (its character becomes reclaimable)
    }
    // player stays in the game: phones rejoin via hello + playerId.
    // A phone that drops mid-walk must not leave its avatar walking on the TV forever.
    const pos = id ? positions.get(id) : undefined;
    if (id && pos?.moving) {
      const stopped = { ...pos, moving: false };
      positions.set(id, stopped);
      relayPos(id, stopped);
    }
  });
});

// ---------- start ----------

saveGame(game); // a --new start must not let the next plain start resume the old game (and a v1 save is now v2)
// resumed timed game or open quiz question: re-arm (fires at once if the deadline passed while down)
const resumed = activity();
if (resumed && !isQuiz(resumed)) clock.onChange(null, resumed);
if (isQuiz(resumed)) quizClock.onChange(null, resumed);

httpServer.listen(PORT, () => {
  console.log(`[bloko] ${loaded.how}`);
  console.log(`[bloko] saving to ${STATE_FILE}`);
  console.log(`[bloko] quiz bank: ${bank.questions.length} questions (${bank.files.join(', ') || 'no files'}), judge: none (uncertain typed answers → wrong, host overrides)`);
  console.log(`[bloko] server → http://localhost:${PORT}/  (screen: /screen/, play: /play/, sim: /sim/)`);
  if (!lan) {
    console.log('[bloko] no LAN IPv4 detected (internal interfaces only) — set BLOKO_HOST to the address phones reach');
    return;
  }
  const url = joinUrl();
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    console.log(qr);
    console.log(`[bloko] phones → ${url}   room ${game.room}   (via ${lan.iface})`);
  });
});
