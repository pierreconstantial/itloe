// Itloe server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure campaign engine
// (the evening: party, hub/worlds/tableaux, facts, news) with a minigame's round nested as its activity;
// each minigame's server code is in the server list (server/minigames.ts).
// Every change goes through apply() → the minigame's hook (solo best), save to disk, arm the round's clock,
// doors, broadcast.
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
import { minigame, type MinigameKind } from '../shared/minigames.js';
import { makeMinigameServers, type ErrCode, type MinigameServer } from './minigames.ts';
import { JOIN_QR_GAP_MS, JOIN_QR_MS } from '../shared/join-qr.js';
import { cleanSpeech, isEmote } from '../shared/social.js';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import { INTRO_KEY, INTRO_KEY_SPOT, OPENING_PLAYERS, PORTAL } from '../shared/campaign/story.js';
import type { CharacterId } from '../shared/campaign/types.js';
import { canMove, makePositions, parsePos, posMsg, type Pos } from './pos.ts';
import { holding } from '../shared/campaign/index.js';
import { PARTY_ROOM, spawnAt } from '../shared/scene.js';
import { nearbyObject } from '../shared/interactions.js';
import { loadGame, saveGame, STATE_FILE, type Game } from './store.ts';
import {
  CONTENT, CONTENT_VERSION, assertContent, reduceCampaign, isUnlocked, roundStatus, zoneAt, roomAt,
  type Campaign, type CampaignAction, type GmOp,
} from './campaign.ts';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';
const access = makeAccess(process.env.BLOKO_PUBLIC_ORIGIN, process.env.BLOKO_ACCESS_TOKEN);
const STORY_MODE = CONTENT.storyId === 'elo-50';

// ---------- the evening + change hooks (wrap the engine, never inside it) ----------

assertContent(CONTENT); // broken content: refuse to boot, with every problem listed
const loaded = loadGame(FORCE_NEW, CONTENT);
const game: Game = { campaign: loaded.campaign, room: loaded.room, bestPrevious: loaded.bestPrevious ?? null };

/** Every minigame's server code (server/minigames.ts), by kind. */
const servers = makeMinigameServers(game);
const serverOf = (kind: MinigameKind): MinigameServer<any, any, any> => servers[kind];
const party = () => game.campaign.party;

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
  (prev, next) => { // before saveGame: a minigame's own records land in the same save (the block game's best)
    for (const kind of new Set([prev.at.kind, next.at.kind])) {
      if (kind === null) continue;
      const before = prev.at.kind === kind ? prev.at.activity : null;
      const after = next.at.kind === kind ? next.at.activity : null;
      if (before !== after) serverOf(kind).onChange?.(before, after);
    }
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

/** The running round as the view carries it: its kind, status and its minigame's view, the same for
 *  everyone (the quiz hides answers until the reveal). Null between rounds. */
const roundView = () => {
  const { kind, activity } = game.campaign.at;
  return kind && activity ? { kind, status: roundStatus(game.campaign), view: serverOf(kind).view(activity) } : null;
};

/** `round`: the running round; `campaign`: the whole evening (TV hub/cutscenes, phone host panel), without
 *  the round's raw state, which travels only through its minigame's view (raw quiz verdicts would leak). */
const viewMsg = () => {
  const { activity: _raw, ...at } = game.campaign.at;
  return JSON.stringify({
    t: 'view', round: roundView(), campaign: { ...game.campaign, at }, contentVersion: CONTENT_VERSION,
    online: online(), now: Date.now(),
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
 *  between rounds, full while a round is under way or on its podium; not a character → taken. */
function joinRefusal(): ErrCode {
  const held = new Set(party().order.filter((id) => !party().players[id].left).map((id) => party().players[id].character));
  if (Object.keys(CHARACTERS).every((c) => held.has(c as CharacterId))) return 'full';
  return game.campaign.at.activity ? 'full' : 'taken';
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Edge-triggered doors: entering one fires `zone.entered` (any member) and, for the chooser on an
 *  unlocked door, `enter` (A1: Élodie walks into a door; the host can always enter directly). */
function walk(id: string, pos: Pos): void {
  const c = game.campaign;
  const character = c.party.players[id]?.character;
  if (STORY_MODE && c.at.node === 'hub' && character !== CONTENT.chooser) return; // the others still occupy the old lobby
  const portalOpen = STORY_MODE && c.at.node === CONTENT.start && c.at.activity === null && c.facts.flags.includes('portal.ready');
  const inPortal = portalOpen && Math.hypot(pos.x - PORTAL.x, pos.y - PORTAL.y) < PORTAL.radius;
  const zone = inPortal ? '@portal' : zoneAt(CONTENT, c.at.node, pos.x, pos.y);
  // a walker's first known position (new phone, or after a restart wiped this memory) only sets the
  // baseline: standing in a door is not stepping into it
  const known = zones.has(id);
  const before = zones.get(id) ?? null;
  zones.set(id, zone);
  if (!known || !zone || zone === before) return;
  if (!character) return;
  if (zone === '@portal') {
    if (character !== CONTENT.chooser || !apply({ t: 'portal', id })) return;
    const arrival: Pos = { x: 6.2, y: 7.3, dir: 'up', moving: false };
    positions.set(id, arrival);
    const echo = posMsg(id, arrival);
    send(sockets.get(id)!, echo);
    relayPos(id, arrival);
    return;
  }
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
    if (STORY_MODE && game.campaign.at.node === 'hub' && party().players[id].character === CONTENT.chooser
      && !game.campaign.facts.flags.includes('apparition.seen')) return;
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
    // the furniture of the room where the party is (roomAt): wherever avatars walk, between rounds (hub, world,
    // the room at a tableau)
    if (!id || !isMember(id) || game.campaign.at.activity) return;
    if (STORY_MODE && game.campaign.at.node === 'hub' && party().players[id].character !== CONTENT.chooser) return;
    if (STORY_MODE && m.object === INTRO_KEY && game.campaign.at.node === 'hub'
      && party().players[id].character === CONTENT.chooser && game.campaign.facts.flags.includes('apparition.seen')) {
      const pos = positions.get(id);
      if (pos && Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius
        && holding(game.campaign.facts, CONTENT.chooser, INTRO_KEY) === 0) {
        apply({ t: 'collect', id, item: INTRO_KEY });
      }
      return;
    }
    const now = Date.now();
    if (now - (interactionAt.get(ws) ?? 0) < 700) return;
    const member = party().players[id];
    const position = positions.get(id) ?? spawnAt(PARTY_ROOM, member.character);
    const object = nearbyObject(roomAt(CONTENT, game.campaign.at.node), position);
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

  // everything below needs an identified member; ids and server-only inputs (now, deadline, timeUp)
  // are injected here or by the minigame, never taken from the wire
  const id = who.get(ws);
  if (!id) { sendErr(ws, 'unknown-player'); return; }

  switch (m.t) {
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
      if (!apply({ t: 'back', id })) sendErr(ws, id === party().hostId || (STORY_MODE && party().players[id]?.character === CONTENT.chooser) ? 'refused' : 'not-host');
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

    case 'config':
      // the tableau's settings: host only, not while a round runs; a host's no-op patch is silent
      if (game.campaign.at.kind === null) { sendErr(ws, 'not-playing'); return; }
      if (!isPlainObject(m.patch) || apply({ t: 'config', id, patch: m.patch })) return;
      if (id !== party().hostId) sendErr(ws, 'not-host');
      else if (roundStatus(game.campaign) === 'running') sendErr(ws, 'locked');
      return;

    // the round messages: the RPG's, at a minigame's tableau (elsewhere → not-playing). A guest gets
    // not-host, the host at the wrong moment refused, in every minigame
    case 'start':
    case 'again':
    case 'newGame':
    case 'endGame':
    case 'retire': {
      const { kind } = game.campaign.at;
      if (kind === null) { sendErr(ws, 'not-playing'); return; }
      if (m.t === 'retire' && typeof m.target !== 'string') return;
      if ((m.t === 'start' || m.t === 'again') && storyRefusesRound(m.t)) { sendErr(ws, 'refused'); return; }
      const host = id === party().hostId;
      const action: CampaignAction = m.t === 'start' || m.t === 'again'
        ? { t: m.t, id, now: Date.now(), inputs: serverOf(kind).inputs?.(game.campaign.at.settings, game.campaign.facts) }
        : m.t === 'newGame' ? { t: 'newGame', id }
          : { t: 'activity', action: m.t === 'endGame' ? { t: 'endGame', id } : { t: 'retire', id, target: m.target } };
      if (apply(action)) return;
      // the host taking out an unknown, done or left player while the round runs: a no-op, not an error
      if (m.t === 'retire' && host && roundStatus(game.campaign) === 'running') return;
      sendErr(ws, host ? 'refused' : 'not-host');
      return;
    }
  }

  roundMessage(ws, id, m);
}

/** The story's opening: its first round needs the four opening players, and none follows once the portal
 *  is ready. */
function storyRefusesRound(t: 'start' | 'again'): boolean {
  if (!STORY_MODE || game.campaign.at.node !== CONTENT.start) return false;
  if (game.campaign.facts.flags.includes('portal.ready')) return true;
  return t === 'start' && !OPENING_PLAYERS.every((character) => party().order.some((playerId) => !party().players[playerId].left && party().players[playerId].character === character));
}

/**
 * Every other message goes to the running round's minigame (no round → not-playing), with the sender's
 * id and the time.
 */
function roundMessage(ws: WebSocket, id: string, m: any): void {
  const { kind, activity: state } = game.campaign.at;
  if (kind === null || !state) { sendErr(ws, 'not-playing'); return; }
  const server = serverOf(kind);
  // a later action (the quiz's verdict) lands only while a round of this minigame runs
  const io = { apply: (action: unknown) => game.campaign.at.kind === kind && apply({ t: 'activity', action: action as any }) };
  const reply = server.message(m, { id, now: Date.now(), hostId: party().hostId, state }, io);
  if (!reply) return;
  if (!('action' in reply)) sendErr(ws, reply.refused);
  else if (!io.apply(reply.action) && reply.refused) sendErr(ws, reply.refused);
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
