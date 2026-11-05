// Itloe server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure campaign engine
// (the evening: party, hub/worlds/tableaux, facts, news) with the block game nested as its activity.
// Every change goes through apply() → solo best, save to disk, arm the timed-mode clock, doors, broadcast.
// Run: npm start          (resumes the saved evening in any state; a timed clock keeps its remaining time)
//      npm start -- --new (or BLOKO_NEW=1: always a fresh evening)
// Env: PORT (3131), BLOKO_BIND, BLOKO_HOST (LAN), BLOKO_VAR, BLOKO_PUBLIC_ORIGIN + BLOKO_ACCESS_TOKEN

import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import qrcodeTerminal from 'qrcode-terminal';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { makeApiHandler } from './http-api.ts';
import { makeAccess } from './access.ts';
import { pickLan } from './lan.ts';
import { makeClock } from './clock.ts';
import { roundDeadline, shiftRound } from './resume.ts';
import { loadBank, nullJudge, withTimeout } from './quiz.ts';
import { minigame } from '../shared/minigames.js';
import { candidatesFor, judgeAnswer, projectQuiz } from '../shared/quiz/bank.js';
import { MAX_TEXT, type QuizAction, type QuizState } from '../shared/quiz/index.js';
import { JOIN_QR_GAP_MS, JOIN_QR_MS } from '../shared/join-qr.js';
import { cleanSpeech, isEmote } from '../shared/social.js';
import { makeBests } from './bests.ts';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import type { ActivityState, CharacterId } from '../shared/campaign/types.js';
import { canMove, makePositions, parsePos, posMsg, type Pos } from './pos.ts';
import { PARTY_ROOM, spawnAt } from '../shared/scene.js';
import { nearbyObject } from '../shared/interactions.js';
import { loadGame, saveGame, STATE_FILE, type Game } from './store.ts';
import type { ServerAction, Settings, State } from './rules.ts';
import {
  CONTENT, CONTENT_VERSION, assertContent, reduceCampaign, isUnlocked, roundStatus, zoneAt,
  type Campaign, type CampaignAction, type GmOp,
} from './campaign.ts';

type ErrCode = 'full' | 'bad-place' | 'not-host' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room' | 'taken' | 'refused';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';
const access = makeAccess(process.env.BLOKO_PUBLIC_ORIGIN, process.env.BLOKO_ACCESS_TOKEN);

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
/** The block game, when that is what runs (block-only messages, bests). */
const blocks = (): State | null => (game.campaign.at.kind === 'blocks' ? activity() as State : null);
/** The quiz, when that is what runs. */
const quiz = (): QuizState | null => (game.campaign.at.kind === 'quiz' ? activity() as QuizState : null);
const party = () => game.campaign.party;

const bests = makeBests(game);

// beat() first: after a suspend, the overdue bell may run before the heartbeat; the beat shifts the
// deadline, so this deadline action no longer matches it and the reducer ignores it (the new one is armed).
const clock = makeClock((kind, deadline) => {
  beat();
  if (game.campaign.at.kind === kind) apply({ t: 'activity', action: minigame(kind)!.deadlineAction(deadline) });
});

/** Avatar positions: in memory only, outside the reducer (see pos.ts). */
const positions = makePositions<WebSocket>();
/** Door each walker currently stands in (edge trigger: entering a door fires once). In memory only. */
const zones = new Map<string, string | null>();

const onChange: ((prev: Campaign, next: Campaign) => void)[] = [
  (prev, next) => { // before saveGame: it sets game.bestPrevious (solo block games only)
    if (prev.at.kind === 'blocks' && next.at.kind === 'blocks') bests.onChange(prev.at.activity as State, next.at.activity as State);
    else if (next.at.kind !== 'blocks') game.bestPrevious = null;
  },
  () => saveGame(game), // ONE atomic save per step: a finished game and its recorded facts land together
  (prev, next) => clock.onChange(prev.at, next.at),
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
  if (roundDeadline(c.at) === null) return; // nothing on a clock (a timed block game, an open quiz question)
  const shifted = gap > SUSPEND_GAP_MS ? shiftRound(c, now - gap + BEAT_MS, now) : c;
  // a server-owned input moved: installed directly (not an engine transition), like the resume shift
  if (shifted !== c && commit(shifted)) {
    console.log(`[itloe] process was suspended ${Math.round(gap / 1000)} s — timed clock paused for that long`);
    return; // commit saved + broadcast
  }
  saveGame(game);
}
setInterval(beat, BEAT_MS).unref();

// ---------- HTTP ----------

const lan = access.origin ? null : await pickLan();
const serveStatic = makeStaticHandler(ROOT);
/** The address phones open (the QR's content); without a LAN IP, the host the request came in on. */
const joinUrl = (hostHeader?: string): string =>
  access.joinUrl(game.room, `http://${lan ? `${lan.address}:${PORT}` : (hostHeader ?? `localhost:${PORT}`)}`);
const serveApi = makeApiHandler((req) => ({ url: joinUrl(req?.headers.host), code: game.room }), { version: CONTENT_VERSION, data: CONTENT });

const httpServer = createServer(async (req, res) => {
  try {
    if (!access.http(req, res)) return;
    if (!await serveApi(req, res)) await serveStatic(req, res);
  } catch (e) {
    console.error('[itloe] http error:', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// ---------- WebSocket protocol ----------

const wss = new WebSocketServer({
  server: httpServer, path: '/ws', maxPayload: 16 * 1024,
  verifyClient: ({ req }: { req: IncomingMessage }) => access.upgrade(req),
});

/** playerId of each identified player socket */
const who = new Map<WebSocket, string>();
/** live socket of each player (rejoin replaces it) */
const sockets = new Map<string, WebSocket>();
/** sockets whose hello carried the right room code (allowed to join) */
const roomOk = new WeakSet<WebSocket>();
/** sockets that said hello as a screen: the only receivers of pos */
const screens = new Set<WebSocket>();
/** Recent speech is kept only in memory; reconnecting phones can recover the conversation. */
const chat: { t: 'say'; playerId: string; text: string; at: number }[] = [];
const socialAt = new WeakMap<WebSocket, number>();
const interactionAt = new WeakMap<WebSocket, number>();

/** The join QR on the TVs (showJoin / hideJoin): until when, in epoch ms; until ≤ now = closed.
 *  Ephemeral, like presence and pos. */
let joinQrUntil = 0;
let joinQrToken: string | null = null;
const showJoinAt = new WeakMap<WebSocket, number>();
/** Hides have their OWN limit: a quick "show, then close" must not be swallowed by the show's. */
const hideJoinAt = new WeakMap<WebSocket, number>();
const joinQrMsg = () => JSON.stringify({ t: 'joinQr', until: joinQrUntil, now: Date.now() });

/** Presence (ephemeral, never in State or on disk): party members with a live socket, in party order. */
const online = (): string[] => party().order.filter((id) => sockets.get(id)?.readyState === WebSocket.OPEN);

/** `state` = the nested block game (null outside one), kept for clients that read it directly;
 *  `campaign` = the whole evening (TV hub/cutscenes, phone host panel). */
/** The public quiz (never an answer before the reveal: shared/quiz/bank.js projectQuiz). */
const publicQuiz = (s: QuizState) => projectQuiz(s, (id) => bank.byId.get(id), bank.credits);

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
  const status = roundStatus(game.campaign);
  return status !== null && status !== 'lobby' ? 'full' : 'taken';
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
    send(ws, { t: 'chatHistory', messages: chat });
    if (m.role === 'screen') {
      screens.add(ws);
      if (joinQrUntil > Date.now()) send(ws, joinQrMsg()); // a TV (re)connecting mid-window shows it too
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

  if (m.t === 'say' || m.t === 'emote') {
    const id = who.get(ws);
    if (!id || !isMember(id)) return;
    const now = Date.now();
    if (now - (socialAt.get(ws) ?? 0) < 650) return;
    if (m.t === 'say') {
      const text = cleanSpeech(m.text);
      if (!text) return;
      socialAt.set(ws, now);
      const event = { t: 'say' as const, playerId: id, text, at: now };
      chat.push(event);
      if (chat.length > 30) chat.shift();
      for (const c of wss.clients) send(c, event);
    } else if (isEmote(m.kind)) {
      socialAt.set(ws, now);
      const event = { t: 'emote', playerId: id, kind: m.kind, at: now };
      for (const c of wss.clients) send(c, event);
    }
    return;
  }

  if (m.t === 'interact') {
    const id = who.get(ws);
    // the party room's furniture: wherever avatars walk there (hub, world, a block or quiz lobby)
    if (!id || !isMember(id) || (activity() && roundStatus(game.campaign) !== 'lobby')) return;
    const now = Date.now();
    if (now - (interactionAt.get(ws) ?? 0) < 700) return;
    const member = party().players[id];
    const position = positions.get(id) ?? spawnAt(PARTY_ROOM, member.character);
    const object = nearbyObject(PARTY_ROOM, position);
    if (!object || object.id !== m.object) return;
    interactionAt.set(ws, now);
    const event = { t: 'interact', playerId: id, object: object.id, at: now };
    for (const c of wss.clients) send(c, event);
    return;
  }

  if (m.t === 'showJoin' || m.t === 'hideJoin') {
    // A phone gets an acknowledgement, including when rate-limited, so its UI reflects the TV.
    // A hide needs the token of the current window: closing an older invite cannot close a newer one.
    const id = who.get(ws);
    const now = Date.now();
    const last = m.t === 'showJoin' ? showJoinAt : hideJoinAt;
    const action = m.t === 'showJoin' ? 'show' : 'hide';
    const requestId = Number.isSafeInteger(m.requestId) ? m.requestId : null;
    const allowed = !!id && isMember(id) && now - (last.get(ws) ?? 0) >= JOIN_QR_GAP_MS
      && (action === 'show' || (joinQrUntil > now && typeof m.token === 'string' && m.token === joinQrToken));
    if (!allowed) {
      if (id && isMember(id)) send(ws, { t: 'joinQrAck', action, requestId, accepted: false, now });
      return;
    }
    last.set(ws, now);
    if (action === 'show') {
      joinQrUntil = now + JOIN_QR_MS;
      joinQrToken = randomUUID();
    } else {
      joinQrUntil = now; // until ≤ now: the TVs close it
      joinQrToken = null;
    }
    send(ws, { t: 'joinQrAck', action, requestId, accepted: true, until: joinQrUntil,
      ...(joinQrToken ? { token: joinQrToken } : {}), now: Date.now() });
    const msg = joinQrMsg();
    for (const c of screens) send(c, msg);
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
  // a quiz runs here: its own messages, and the shared names (start, again, endGame, newGame, config) go to it
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
      // game master: host only; the engine validates the op. A host's no-op is silent, EXCEPT a refused
      // give/take (Contract F: unknown item or character, or taking more than held) → 'refused'
      if (!isPlainObject(m.op)) return;
      if (apply({ t: 'gm', id, op: m.op as GmOp })) return;
      if (id !== party().hostId) sendErr(ws, 'not-host');
      else if (m.op.op === 'give' || m.op.op === 'take') sendErr(ws, 'refused');
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
    case 'start':
    case 'again': {
      // candidates: the bank filtered by the quiz settings, minus every question asked this evening
      const candidates = candidatesFor(bank.questions, q.settings, game.campaign.facts.asked ?? []);
      if (!applyQuiz({ t: m.t, id, now: Date.now(), candidates })) sendErr(ws, refusal());
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
        // the reducer ignores a verdict for another round: a late one never lands on the next question's answer
        void judge(question, given.text).then((ok) => applyQuiz({ t: 'verdict', target: id, ok, index, questionId }));
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

    default: // block-only (place, retire): not a quiz thing
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
  ws.on('error', () => ws.terminate()); // malformed/oversized frames must not crash the process
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
      console.error('[itloe] message handling failed:', e);
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
clock.onChange(null, game.campaign.at);

httpServer.listen(PORT, process.env.BLOKO_BIND, () => {
  console.log(`[itloe] ${loaded.how}`);
  console.log(`[itloe] saving to ${STATE_FILE}`);
  console.log(`[itloe] quiz bank: ${bank.questions.length} questions (${bank.files.join(', ') || 'no files'}), judge: none (uncertain typed answers → wrong, host overrides)`);
  if (access.origin) {
    console.log(`[itloe] server → ${access.origin}/ (invitation token required)`);
    return; // invitation URLs and QR codes contain the secret: keep them out of service logs
  }
  console.log(`[itloe] server → http://localhost:${PORT}/  (screen: /screen/, play: /play/, sim: /sim/)`);
  if (!lan) {
    console.log('[itloe] no LAN IPv4 detected (internal interfaces only) — set BLOKO_HOST to the address phones reach');
    return;
  }
  const url = joinUrl();
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    console.log(qr);
    console.log(`[itloe] phones → ${url}   room ${game.room}   (via ${lan.iface})`);
  });
});
