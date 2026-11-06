// Itloe server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure campaign engine
// (the evening: party, hub/worlds/tableaux, facts, news) with the running minigame nested as its activity;
// each minigame's server code is in the server list (server/minigames.ts).
// Every change goes through apply() → the minigame's hook (solo best), save to disk, arm the round's clock,
// doors, broadcast.
// Run: npm start          (resumes the saved evening in any state; a timed clock keeps its remaining time)
//      npm start -- --new (or BLOKO_NEW=1: always a fresh evening)
//      /?reset=1 in a browser, once confirmed (admins only): saves a fresh evening and exits for a restart
// Env: PORT (3131), BLOKO_BIND, BLOKO_HOST (LAN), BLOKO_VAR, BLOKO_PUBLIC_ORIGIN + BLOKO_ACCESS_TOKEN, BLOKO_ADMIN_TOKEN

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import qrcodeTerminal from 'qrcode-terminal';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { makeApiHandler } from './http-api.ts';
import { makeAccess } from './access.ts';
import { makeAdmin } from './admin.ts';
import { pickLan } from './lan.ts';
import { makeClock } from './clock.ts';
import { roundDeadline, shiftRound } from './resume.ts';
import { minigame, spotAt, spotStep, type MinigameKind, type MinigameView, type Spot, type StartPosition } from '../shared/minigames.js';
import { makeMinigameServers, type ErrCode, type MinigameServer } from './minigames.ts';
import { makeRound, roundOf, type Round } from './round.ts';
import { JOIN_QR_GAP_MS, JOIN_QR_MS } from '../shared/join-qr.js';
import { cleanSpeech, isEmote, EMOTES } from '../shared/social.js';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import { INTRO_KEY, INTRO_KEY_SPOT, PORTAL } from '../shared/campaign/story.js';
import type { CharacterId, TableauPlayers } from '../shared/campaign/types.js';
import { canMove, makePositions, parsePos, posMsg, type Pos } from './pos.ts';
import { holding, isWisp } from '../shared/campaign/index.js';
import { PARTY_ROOM, spawnAt } from '../shared/scene.js';
import { interactionActor, nearbyObject, objectAction } from '../shared/interactions.js';
import { freshGame, loadGame, saveGame, STATE_FILE, type Game } from './store.ts';
import {
  CONTENT, CONTENT_VERSION, assertContent, reduceCampaign, isUnlocked, minigameStatus, gameMasterId, askedSoFar, zoneAt, roomAt,
  type Campaign, type CampaignAction, type GmOp,
} from './campaign.ts';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';
const access = makeAccess(process.env.BLOKO_PUBLIC_ORIGIN, process.env.BLOKO_ACCESS_TOKEN, process.env.BLOKO_ADMIN_TOKEN);
const STARTED_AT = Date.now();
/** The admin page's server side: its events, the pages' error reports, its routes (snapshot: adminSnapshot). */
const admin = makeAdmin({ isAdmin: access.isAdmin, clientIp: access.clientIp, snapshot: adminSnapshot, saveFile: STATE_FILE });
const STORY_MODE = CONTENT.storyId === 'elo-50';

// ---------- the evening + change hooks (wrap the engine, never inside it) ----------

assertContent(CONTENT); // broken content: refuse to boot, with every problem listed
const loaded = loadGame(FORCE_NEW, CONTENT);
const game: Game = { campaign: loaded.campaign, room: loaded.room, bestPrevious: loaded.bestPrevious ?? null };

/** Every minigame's server code (server/minigames.ts), by kind. */
const servers = makeMinigameServers(game);
const serverOf = (kind: MinigameKind): MinigameServer<any, any> => servers[kind];
const party = () => game.campaign.party;
/** The game master's id (Pierre, by the content), or null while he isn't in the evening. */
const gameMaster = () => gameMasterId(party(), CONTENT);

// beat() first: after a suspend, the overdue bell may run before the heartbeat; the beat shifts the
// deadline, so this deadline action no longer matches it and the reducer ignores it (the new one is armed).
const clock = makeClock((kind, deadline) => {
  beat();
  if (game.campaign.at.kind === kind) apply({ t: 'activity', action: minigame(kind)!.deadlineAction(deadline) });
});

/** The room's avatar positions: in memory only, outside the reducer (see pos.ts). */
const positions = makePositions<WebSocket>();
/** A server-timed presentation window after a Wisp gains playable status. */
const incarnations = new Map<string, { at: number, kind: string }>();
const isIncarnating = (id: string) => !!party().players[id] && !party().players[id].left
  && party().players[id].statuses.includes('incarnating');

/** A persisted pending status can be scheduled again after a server restart. */
function scheduleIncarnation(id: string): void {
  if (incarnations.has(id) || !isIncarnating(id)) return;
  const at = Date.now() + 3000;
  const kinds = EMOTES.filter((kind) => kind !== 'shine');
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  incarnations.set(id, { at, kind });
  setTimeout(() => {
    if (incarnations.get(id)?.at !== at) return;
    incarnations.delete(id);
    if (apply({ t: 'incarnate', id })) sendAll({ t: 'emote', playerId: id, kind, at: Date.now() });
  }, 3000);
}

/** The running minigame's in-memory side (round.ts): its server code's io, with unsaved messages. Null while none runs. */
let round: Round<unknown> | null = null;
const openRound = (c: Campaign): Round<unknown> | null => {
  if (!c.at.kind || !c.at.activity) return null;
  // Nobody keeps walking in the room while the minigame runs (a phone's last "stop" may arrive after it started).
  for (const [id, pos] of positions.entries()) if (pos.moving) positions.set(id, { ...pos, moving: false });
  return makeRound({
    apply: (action) => apply({ t: 'activity', action: action as any }),
    sendAll,
  });
};
round = openRound(game.campaign); // a resumed round
/** Door each walker currently stands in (edge trigger: entering a door fires once). In memory only. */
const zones = new Map<string, string | null>();
/** Spot each walker of a walkable lobby currently stands on (edge trigger, as the doors). In memory only. */
const onSpot = new Map<string, string | null>();
/** The players the running minigame shows who were placed on its walkable lobby since it last showed them
 *  (placeWalkers). In memory only: a restart places everyone again. */
const placed = new Set<string>();

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
  (prev, next) => {
    if (roundOf(prev) === roundOf(next)) return;
    const ended = round;
    round = null;
    ended?.end(); // the old round's io goes quiet before the next round opens
    round = openRound(next);
    onSpot.clear();
    placed.clear();
  },
  (_prev, next) => positions.prune(next.party),
  () => placeWalkers(),
  (prev, next) => { if (prev.at.node !== next.at.node) resetZones(); },
  (prev, next) => {
    for (const id of next.party.order) {
      const before = prev.party.players[id], after = next.party.players[id];
      if (!after || after.left || !after.statuses.includes('incarnating')) incarnations.delete(id);
      else if (!before?.statuses.includes('incarnating')) scheduleIncarnation(id);
    }
  },
  () => broadcast(),
];

/** Runs an action through the campaign engine; returns false when it was refused (state unchanged). */
function apply(action: CampaignAction): boolean {
  const ok = commit(reduceCampaign(game.campaign, action, CONTENT));
  const inner = action.t === 'activity' ? action.action as { id?: string } : action;
  admin.log('id' in inner && typeof inner.id === 'string' ? inner.id : null, actionText(action), ok);
  return ok;
}

/** An action as the admin page's events show it: its fields but the actor and the server's inputs, short. */
function actionText(action: CampaignAction): string {
  const { id: _id, now: _now, inputs: _inputs, ...rest } = (action.t === 'activity' ? action.action : action) as any;
  const text = (action.t === 'activity' ? 'activity ' : '') + JSON.stringify(rest);
  return text.length > 200 ? text.slice(0, 199) + '…' : text;
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
    admin.log(null, `process was suspended ${Math.round(gap / 1000)} s: timed clock paused for that long`);
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
    if (serveReset(req, res)) return;
    if (await admin.handle(req, res)) return;
    if (!await serveApi(req, res)) await serveStatic(req, res);
  } catch (e) {
    console.error('[itloe] http error:', e);
    admin.log(null, `http error on ${req.url?.split('?')[0]}: ${e}`, false);
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
const jumpAt = new WeakMap<WebSocket, number>();
const interactionAt = new WeakMap<WebSocket, number>();

/** The join QR on the TVs (showJoin / hideJoin): until when, in epoch ms; until ≤ now = closed.
 *  Ephemeral, like presence and pos. */
let joinQrUntil = 0;
let joinQrToken: string | null = null;
const showJoinAt = new WeakMap<WebSocket, number>();
/** Hides have their OWN limit: a quick "show, then close" must not be swallowed by the show's. */
const hideJoinAt = new WeakMap<WebSocket, number>();
const joinQrMsg = () => JSON.stringify({ t: 'joinQr', until: joinQrUntil, now: Date.now() });
/** For the admin page: each socket's opening time, address, browser, and last message. In memory only. */
const socketInfo = new WeakMap<WebSocket, { since: number, ip: string, agent: string, lastAt: number | null, last: string | null }>();
/** For the admin page: how many sockets each player has attached since the start (reconnects, reclaims). */
const attaches = new Map<string, number>();
/** Who a socket is, for the admin page's events: its player, `screen`, or `unjoined` (a phone before its join). */
const whoIs = (ws: WebSocket): string => who.get(ws) ?? (screens.has(ws) ? 'screen' : 'unjoined');

/** Presence (ephemeral, never in State or on disk): party members with a live socket, in party order. */
const online = (): string[] => party().order.filter((id) => sockets.get(id)?.readyState === WebSocket.OPEN);

/** The players the running minigame shows itself, null while none runs (everyone else is a wisp: isWisp). */
const shown = (): string[] | null => {
  const { kind, activity } = game.campaign.at;
  return kind && activity ? minigame(kind)!.shows(activity) : null;
};
/** Does this member show as a wisp now (the story's, or one the running minigame doesn't show)? @param id a member */
const wisp = (id: string): boolean => isWisp(party(), id, shown());
/** The running minigame's spots while the players it shows walk its lobby (MinigameRules `spots`), else null. */
const spots = (): Spot[] | null => {
  const { kind, activity } = game.campaign.at;
  return kind && activity ? minigame(kind)!.spots?.(activity) ?? null : null;
};
/** Does this member walk the running minigame's lobby as their character (shown, while its lobby is walkable)? */
const walksLobby = (id: string): boolean => spots() !== null && !!shown()?.includes(id);

/** The running minigame as the view carries it (shared/minigames.js MinigameView): its kind, status, its server
 *  code's view, the same for everyone (the quiz hides answers until the reveal), whom it shows itself, and the
 *  tableau's content rules for the Start button. Null while none runs. */
const minigameView = (): MinigameView | null => {
  const { kind, activity, node } = game.campaign.at;
  if (!kind || !activity) return null;
  const rules = minigame(kind)!;
  const content = CONTENT.nodes[node]?.activity as TableauPlayers | undefined;
  return {
    kind, status: minigameStatus(game.campaign)!, view: serverOf(kind).view(activity), shows: rules.shows(activity),
    spots: rules.spots?.(activity) ?? null,
    required: { ...(content?.eligible ? { eligible: content.eligible } : {}), ...(content?.allReady ? { allReady: true } : {}) },
  };
};

/** `minigame`: the running minigame; `campaign`: the whole evening (TV hub/cutscenes, phone game-master panel), without
 *  the minigame's raw state, which travels only through its server code's view (raw quiz verdicts would leak). */
const viewMsg = () => {
  const { activity: _raw, ...at } = game.campaign.at;
  return JSON.stringify({
    t: 'view', minigame: minigameView(), campaign: { ...game.campaign, at }, contentVersion: CONTENT_VERSION,
    online: online(), incarnations: Object.fromEntries(incarnations), now: Date.now(),
  });
};

function send(ws: WebSocket, data: string | object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data));
}

/** Every open socket, phones and TVs alike: the one send-to-everyone step. */
function sendAll(data: string | object): void {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  for (const c of wss.clients) send(c, msg);
}

function broadcast(): void {
  sendAll(viewMsg());
}

/** A screen's snapshot of the positions it draws: the room's. */
function sendPositions(ws: WebSocket): void {
  for (const [playerId, pos] of positions.entries()) send(ws, posMsg(playerId, pos));
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
  admin.log(whoIs(ws), `err ${code}`, false);
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
    admin.log(playerId, 'replaced: another socket took this player, the old one is closed');
  }
  if (old !== ws) attaches.set(playerId, (attaches.get(playerId) ?? 0) + 1);
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
 *  while no minigame runs, full while one does; not a character → taken. */
function joinRefusal(): ErrCode {
  const held = new Set(party().order.filter((id) => !party().players[id].left).map((id) => party().players[id].character));
  if (Object.keys(CHARACTERS).every((c) => held.has(c as CharacterId))) return 'full';
  return game.campaign.at.activity ? 'full' : 'taken';
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Edge-triggered doors: entering one fires `zone.entered` (any member) and, for the chooser on an
 *  unlocked door, `enter` (A1: Élodie walks into a door; the game master can also enter directly). */
function walk(id: string, pos: Pos): void {
  const c = game.campaign;
  const character = c.party.players[id]?.character;
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
  if (wisp(id) || isIncarnating(id)) return;
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

/** Where a character stands on a spot: its feet at the spot's centre, facing the TV. */
const onSpotPos = (spot: Spot): Pos => ({ x: spot.x + spot.w / 2, y: spot.y + spot.h / 2, dir: 'down', moving: false });

/** Edge-triggered spots on a walkable lobby: a walker stepping onto a spot, off it or from one to another tells
 *  the minigame (`spot`, never from the wire). Wisps never get here. */
function stepOnSpots(id: string, pos: Pos): void {
  const list = spots();
  if (!list) return;
  const { at, changed } = spotStep(list, onSpot.get(id), pos.x, pos.y);
  onSpot.set(id, at);
  if (changed) apply({ t: 'activity', action: { t: 'spot', id, spot: at } });
}

/** A start position for a walker: the minigame's first one where no other walker stands, else one in turn. */
function startPosition(id: string, starts: readonly StartPosition[]): Pos | null {
  if (!starts.length) return null;
  const others = [...placed].filter((other) => other !== id).map((other) => positions.get(other)).filter((p) => !!p);
  const free = starts.find((s) => !others.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 0.5));
  const at = free ?? starts[placed.size % starts.length];
  return { x: at.x, y: at.y, dir: 'down', moving: false };
}

/** Whoever starts walking a walkable lobby (the minigame's start, a join, back from a round they sat out, a
 *  restart) stands where the lobby puts them, on the TVs and on their phone: a holder on its spot, anyone else on
 *  one of the minigame's start positions (none: where they stood). Placed once until the minigame stops showing
 *  them, so walking and the rounds don't move them. */
function placeWalkers(): void {
  const ids = shown() ?? [];
  for (const id of placed) if (!ids.includes(id)) placed.delete(id);
  const list = spots();
  if (!list) return;
  const starts = minigame(game.campaign.at.kind)!.startPositions ?? [];
  for (const id of ids) {
    if (placed.has(id)) continue;
    const held = list.find((s) => s.holder === id);
    const pos = held ? onSpotPos(held) : startPosition(id, starts);
    placed.add(id);
    if (!pos) continue;
    positions.set(id, pos);
    onSpot.set(id, held?.id ?? spotAt(list, pos.x, pos.y));
    const ws = sockets.get(id);
    if (ws) send(ws, posMsg(id, pos));
    relayPos(id, pos);
  }
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
    admin.log(rejoin ? m.playerId : m.role === 'screen' ? 'screen' : 'unjoined', m.role === 'screen' ? 'hello as a screen'
      : rejoin ? 'hello: rejoined' : `hello: new phone, ${roomOk.has(ws) ? 'right' : 'wrong or no'} room code`);
    // screen and fresh player get the current view; a rejoin changes presence, so everyone gets it
    if (rejoin) broadcast(); else send(ws, viewMsg());
    send(ws, { t: 'chatHistory', messages: chat });
    if (m.role === 'screen') {
      screens.add(ws);
      if (joinQrUntil > Date.now()) send(ws, joinQrMsg()); // a TV (re)connecting mid-window shows it too
      sendPositions(ws);
    } else {
      screens.delete(ws);
    }
    return;
  }

  if (m.t === 'pos') {
    // ephemeral avatar movement: bypasses the engine (doors aside); malformed, unjoined or flooding senders dropped silently
    const id = who.get(ws);
    if (!id || !canMove(party(), id) || !positions.allow(ws)) return;
    if (isIncarnating(id)) return;
    if (round) { // while a minigame runs only its wisps walk, and its players on its walkable lobby, in the room's
      // positions and without doors
      const pos = parsePos(m);
      const walker = walksLobby(id);
      if (!pos || !(walker || wisp(id))) return;
      positions.set(id, pos);
      relayPos(id, pos);
      if (walker) stepOnSpots(id, pos);
      else onSpot.delete(id); // a wisp's light stands on no spot
      return;
    }
    if (STORY_MODE && game.campaign.at.node === 'hub' && party().players[id].character === CONTENT.chooser
      && !game.campaign.facts.flags.includes('apparition.seen')) return;
    const pos = parsePos(m);
    if (!pos) return;
    positions.set(id, pos);
    relayPos(id, pos);
    walk(id, pos);
    return;
  }

  if (m.t === 'jump') {
    const id = who.get(ws);
    if (!id || !canMove(party(), id) || round || isIncarnating(id)) return;
    const member = party().players[id];
    if (wisp(id)) return;
    if (STORY_MODE && game.campaign.at.node === 'hub' && member.character === CONTENT.chooser
      && !game.campaign.facts.flags.includes('apparition.seen')) return;
    const now = Date.now();
    if (now - (jumpAt.get(ws) ?? 0) < 650) return;
    jumpAt.set(ws, now);
    for (const screen of screens) send(screen, { t: 'jump', playerId: id });
    return;
  }

  if (m.t === 'say' || m.t === 'emote') {
    const id = who.get(ws);
    if (!id || !isMember(id)) return;
    const now = Date.now();
    if (now - (socialAt.get(ws) ?? 0) < 650) return;
    if (m.t === 'say') {
      if (wisp(id) || isIncarnating(id)) return;
      const text = cleanSpeech(m.text);
      if (!text) return;
      socialAt.set(ws, now);
      const event = { t: 'say' as const, playerId: id, text, at: now };
      chat.push(event);
      if (chat.length > 30) chat.shift();
      sendAll(event);
    } else if (isEmote(m.kind) && !isIncarnating(id) && (wisp(id) ? m.kind === 'shine' : m.kind !== 'shine')) {
      socialAt.set(ws, now);
      const event = { t: 'emote', playerId: id, kind: m.kind, at: now };
      sendAll(event);
    }
    return;
  }

  if (m.t === 'interact') {
    const id = who.get(ws);
    // the furniture of the room where the party is (roomAt): wherever avatars walk, while no minigame runs (hub,
    // world, the room at a tableau)
    if (!id || !isMember(id) || game.campaign.at.activity) return;
    const member = party().players[id];
    if (wisp(id) || isIncarnating(id)) return;
    const actor = interactionActor(member, game.campaign.facts);
    if (STORY_MODE && m.object === INTRO_KEY && game.campaign.at.node === 'hub') {
      if (!objectAction(INTRO_KEY, actor) || !game.campaign.facts.flags.includes('apparition.seen')) return;
      const pos = positions.get(id);
      if (pos && Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius
        && holding(game.campaign.facts, CONTENT.chooser, INTRO_KEY) === 0) {
        apply({ t: 'collect', id, item: INTRO_KEY });
      }
      return;
    }
    const now = Date.now();
    if (now - (interactionAt.get(ws) ?? 0) < 700) return;
    const scene = roomAt(CONTENT, game.campaign.at.node);
    const position = positions.get(id) ?? spawnAt(scene, member.character);
    const object = nearbyObject(scene, position, actor);
    if (!object || object.id !== m.object) return;
    const action = objectAction(object.id, actor);
    if (!action) return;
    interactionAt.set(ws, now);
    const event = { t: 'interact', playerId: id, object: object.id, action: action.key, feedback: action.feedback, at: now };
    sendAll(event);
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
    // socket, in any state — same playerId, so board, score, hand and facts come along
    const holder = isCharacterId(character) ? holderOf(character) : undefined;
    if (holder && !isOnline(holder)) {
      attach(ws, holder);
      admin.log(holder, `reclaimed ${character}`);
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
  if (isIncarnating(id) && m.t !== 'leave' && m.t !== 'gm') return;

  switch (m.t) {
    case 'leave':
      // leaving the EVENING (a running minigame hears their leave: its lobby drops them, a block game marks
      // them done); the stored id must not rejoin, so the socket goes back to being a stranger
      if (apply({ t: 'leave', id })) detach(id);
      return;

    case 'enter':
      // the game master, or the chooser, into an unlocked child of where the party is; refused → 'refused'
      if (typeof m.node !== 'string' || !apply({ t: 'enter', id, node: m.node })) sendErr(ws, 'refused');
      return;

    case 'back':
      // the game master (the chooser after the portal, while no minigame runs), up one level; a running
      // minigame ends first → 'refused' at the hub
      if (!apply({ t: 'back', id })) sendErr(ws, id === gameMaster() || (STORY_MODE && party().players[id]?.character === CONTENT.chooser) ? 'refused' : 'not-gm');
      return;

    case 'gm': {
      // the game master (Pierre, even as a Wisp) steers the evening. The engine validates the op. A GM's
      // no-op is silent, EXCEPT a refused give/take (Contract F: unknown item or character, or taking more
      // than held) → 'refused'
      if (!isPlainObject(m.op)) return;
      if (apply({ t: 'gm', id, op: m.op as GmOp })) return;
      if (id !== gameMaster()) sendErr(ws, 'not-gm');
      else if (m.op.op === 'give' || m.op.op === 'take') sendErr(ws, 'refused');
      return;
    }

    case 'takeSpot': {
      // a walker of a walkable lobby takes a free spot from the phone: the character moves onto it, which is a
      // step onto it, whatever it stood on before
      const spot = spots()?.find((s) => s.id === m.spot);
      if (!spot || spot.holder !== null || !walksLobby(id) || !positions.allow(ws)) { sendErr(ws, 'refused'); return; }
      const pos = onSpotPos(spot);
      positions.set(id, pos);
      send(ws, posMsg(id, pos));
      relayPos(id, pos);
      onSpot.set(id, null);
      stepOnSpots(id, pos);
      return;
    }

    // the main game's minigame messages, at a minigame's tableau (elsewhere → not-playing): a guest gets
    // not-gm, the game master at the wrong moment refused
    case 'startMinigame':
    case 'endMinigame': {
      if (game.campaign.at.kind === null) { sendErr(ws, 'not-playing'); return; }
      const action: CampaignAction = m.t === 'startMinigame' ? { t: 'startMinigame', id, now: Date.now() } : { t: 'endMinigame', id };
      if (!apply(action)) sendErr(ws, id === gameMaster() ? 'refused' : 'not-gm');
      return;
    }
  }

  minigameMessage(ws, id, m);
}

/**
 * Every other message goes to the running minigame's server code (none running → not-playing), with the
 * sender's id, the time, the game master and the evening's asked ids.
 */
function minigameMessage(ws: WebSocket, id: string, m: any): void {
  const { kind, activity: state } = game.campaign.at;
  if (kind === null || !state || !round) { sendErr(ws, 'not-playing'); return; }
  // the minigame's own io: a later action (the quiz's verdict) lands only while this minigame runs
  const { io } = round;
  const reply = serverOf(kind).message(m, { id, now: Date.now(), gameMasterId: gameMaster(), state, asked: askedSoFar(game.campaign) }, io);
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
  sendAll({ t: 'tick', now: Date.now() });
}, TICK_MS).unref();

wss.on('connection', (ws, req) => {
  ws.on('error', () => ws.terminate()); // malformed/oversized frames must not crash the process
  alive.add(ws);
  socketInfo.set(ws, { since: Date.now(), ip: access.clientIp(req), agent: String(req.headers['user-agent'] ?? ''), lastAt: null, last: null });
  ws.on('pong', () => alive.add(ws));
  send(ws, viewMsg()); // screen gets a view immediately on connect

  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m === null || typeof m !== 'object') return;
    const info = socketInfo.get(ws);
    if (info) { info.lastAt = Date.now(); info.last = String(m.t); }
    try {
      handleMessage(ws, m);
    } catch (e) {
      // a bad message or a reducer bug must not kill the game for everyone
      console.error('[itloe] message handling failed:', e);
      admin.log(whoIs(ws), `server error on ${JSON.stringify(m.t)}: ${e instanceof Error ? e.stack ?? e.message : e}`, false);
    }
  });

  ws.on('close', () => {
    admin.log(whoIs(ws), 'socket closed');
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

// ---------- admin page (/admin/, server/admin.ts) ----------

/** Everything the admin page shows that only the server knows: the in-memory side included, and the running
 *  minigame's raw state, answers too. */
function adminSnapshot() {
  const c = game.campaign;
  const socket = (ws: WebSocket) => ({ ...socketInfo.get(ws), open: ws.readyState === WebSocket.OPEN });
  let savedAt: number | null = null;
  try { savedAt = statSync(STATE_FILE).mtimeMs; } catch { /* not saved yet */ }
  const rules = minigame(c.at.kind);
  return {
    now: Date.now(), startedAt: STARTED_AT, loaded: loaded.how, content: process.env.ITLOE_CONTENT || 'the story',
    contentVersion: CONTENT_VERSION,
    hosting: access.origin ?? 'LAN', saveFile: STATE_FILE, savedAt, room: game.room, joinQrUntil,
    players: c.party.order.map((id) => {
      const ws = sockets.get(id);
      return {
        id, online: isOnline(id), attaches: attaches.get(id) ?? 0, socket: ws ? socket(ws) : null,
        pos: positions.get(id) ?? null,
      };
    }),
    screens: [...screens].map(socket),
    strangers: [...wss.clients].filter((ws) => !who.has(ws) && !screens.has(ws)).map(socket),
    gameMaster: gameMaster(),
    minigame: c.at.kind && c.at.activity ? {
      kind: c.at.kind, status: minigameStatus(c), describe: rules?.describe(c.at.activity) ?? '', deadline: roundDeadline(c.at),
    } : null,
    campaign: c,
  };
}

// ---------- reset (/?reset=1) ----------

/** The reset's two pages: the confirmation, then the wait for the restart. */
const resetPage = (head: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${head}<title>Itloe: a fresh evening</title>
<style>body{font:18px/1.5 system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 1em}
button{font:inherit;padding:.5em 1em;margin-right:1em}</style></head>
<body>${body}</body></html>`;
const RESET_CONFIRM = resetPage('', `<h1>Start a fresh evening?</h1>
<p>The current evening is replaced: the party, the progress and the room code. The server restarts;
phones and TVs reconnect, and players join again with the new code on the TV.</p>
<form method="post"><button type="submit">Start a fresh evening</button><a href="/">Keep the current evening</a></form>`);
const RESET_REFUSED = resetPage('', `<h1>Admins only</h1>
<p>Only an admin can start a fresh evening: open this address with <code>&amp;admin=</code> and the admin token
at the end.</p>`);
const RESET_DONE = resetPage('<meta http-equiv="refresh" content="8;url=/">', `<h1>Starting a fresh evening…</h1>
<p>The server is restarting. The TV page opens in a few seconds.</p>`);

/** Exit code after a reset. Not 0: the hosted service restarts the server only after a failure exit. */
const EXIT_RESET = 75;

/** Any page with `?reset=1`, for admins (others get a refusal): GET shows the confirmation page; its POST saves a fresh evening, as `--new`
 *  starts it, and exits so that the restart loads it. False when the request is not a reset. */
function serveReset(req: IncomingMessage, res: ServerResponse): boolean {
  if (new URL(req.url ?? '/', 'http://x').searchParams.get('reset') !== '1') return false;
  if (!access.isAdmin(req)) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(RESET_REFUSED);
    return true;
  }
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(RESET_CONFIRM);
    return true;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(RESET_DONE, () => {
    // saved and exited in the same step: no change to the old evening can overwrite the fresh save
    saveGame(freshGame(CONTENT));
    console.log('[itloe] fresh evening saved (/?reset=1): exiting, the restart loads it');
    process.exit(EXIT_RESET);
  });
  return true;
}

// ---------- start ----------

saveGame(game); // a --new start must not let the next plain start resume the old game (and a v1 save is now v2)
placeWalkers(); // a resumed walkable lobby: its holders on their spots, everyone else on a start position
for (const id of party().order) scheduleIncarnation(id);
// resumed timed game or open quiz question: re-arm (fires at once if the deadline passed while down)
clock.onChange(null, game.campaign.at);

httpServer.listen(PORT, process.env.BLOKO_BIND, () => {
  console.log(`[itloe] ${loaded.how}`);
  console.log(`[itloe] saving to ${STATE_FILE}`);
  if (access.origin) {
    console.log(`[itloe] server → ${access.origin}/ (invitation token required)`);
    return; // invitation URLs and QR codes contain the secret: keep them out of service logs
  }
  console.log(`[itloe] server → http://localhost:${PORT}/  (screen: /screen/, play: /play/, sim: /sim/, admin: /admin/)`);
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
