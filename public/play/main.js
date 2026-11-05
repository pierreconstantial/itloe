// P3 — phone client /play. Renders strictly from the last `view` (PROTOCOL.md);
// the only optimistic paint (local placement) is reconciled by the next `view`/`err`.
// Path ../../shared: resolved on disk by tsc, normalized to /shared/ by the browser.
import { canPlace, place, findClears, applyClears } from '../../shared/board.js';
import { PIECES } from '../../shared/pieces.js';
import { ranking } from '../../shared/game.js';
import { KEYS, load, save, forget } from './storage.js';
import { $, bounds, pieceEl, dotEl, toast } from './dom.js';
import * as haptics from './haptics.js';
import { initMenu } from './menu.js';
import { syncClock, secondsLeft, mmss } from '../commun/clock.js';
import { createSettingsSheet, summarize } from './settings-ui.js';
import { CHARACTERS, ROSTER_SIZE, isCharacterId } from '../../shared/characters.js';
import { spawnPoint } from '../../shared/world.js';
import { PARTY_ROOM, APARTMENT_ROOM, DOOR_FOUR_ROOM } from '../../shared/scene.js';
import { nearbyObject, OBJECT_ACTIONS } from '../../shared/interactions.js';
import { INTRO_KEY, INTRO_KEY_SPOT, OPENING_PLAYERS } from '../../shared/campaign/story.js';
import { createPicker, pickStates, anyPickable } from './picker.js';
import { createJoystick } from './joystick.js';
import { avatarCanvas, paintAvatar } from './avatar.js';
import { posFromEcho } from './movement.js';
import { createConnection } from './connection.js';
import { installBackGuard } from './back-guard.js';
import { createHostControls } from './host-controls.js';
import { createGmPanel } from './gm-panel.js';
import { createQuizUi } from './quiz-ui.js';
import { createBag } from './bag.js';
import { createSocial } from './social.js';
import { JOIN_QR_MS } from '../../shared/join-qr.js';
import { QUIZ_SETTINGS, summarizeQuiz } from './quiz-text.js';
import { childMarks, content, onContentChange, syncContent, titleOf } from './campaign-view.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/campaign/types.js').PartyMember} PartyMember */
/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/pieces.js').PieceId} PieceId */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('./movement.js').Pos} Pos */
/** @typedef {{ score: number, previous: number | null }} Best */
/** A seat in a block or quiz lobby. @typedef {{ id: string, name: string, color: number, character?: string | null, left?: boolean }} LobbyPlayer */

const RANK_BADGES = ['①', '②', '③', '④'];
const MEDALS = ['🥇', '🥈', '🥉', ''];
const GAP = 2; // px between cells, = the `gap` value in play-base.css
const TRAY_CELL = 13; // px per cell for tray miniatures
const LIFT = 1.5; // the dragged piece floats this many cells above the finger
const URGENT_SECONDS = 10; // the countdown turns red from here
const CLOCK_TICK_MS = 250;
const LOBBY_ME_SCALE = 4; // own avatar in the lobby header: 64 px
const LOBBY_CHIP_SCALE = 2; // other players' avatars: 32 px

/** @type {Record<string, string>} */
const ERR_TOASTS = {
  locked: 'Settings are locked while a game is on.',
  'not-host': 'Only the host can do that.',
};

/** What the podium's choice became, told to everyone (the host picks, guests follow). @type {Record<string, string>} */
const PHASE_TOASTS = {
  'finished>lobby': 'Back to the room!',
  'finished>playing': 'Rematch! Go go go!',
};

// ---------- pure helpers ----------

/** @param {number} rank 1-based @returns {string} */
function ordinal(rank) {
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
}

/** @param {State} v @param {string} id @returns {number} 1-based, shared with ties */
function rankOf(v, id) {
  return ranking(v).find((r) => r.id === id)?.rank ?? v.order.length;
}

/** Room codes are typed loosely on phones: "ab cd" → "ABCD". @param {string} raw */
function normalizeRoom(raw) {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * End-of-run event this view brings to the player, for haptics.
 * @param {State} prev @param {State} next @param {string} id
 * @returns {'win' | 'bell' | 'death' | null}
 */
function outcome(prev, next, id) {
  const before = prev.players[id];
  const after = next.players[id];
  if (!before || !after) return null;
  const justFinished = prev.phase === 'playing' && next.phase === 'finished';
  if (justFinished && next.order.length > 1 && rankOf(next, id) === 1) return 'win';
  if (justFinished && next.endReason === 'time' && !before.done) return 'bell';
  if (!before.done && after.done) return 'death';
  return null;
}

// ---------- client state ----------

/** The view's running round, null between rounds or before the first view. @type {RoundView | null} */
let round = null;
/** The block game (the round's view when blocks runs): null on the hub / in a world, or before the first view. @type {State | null} */
let lastView = null;
/** The whole evening (slice 3), null from a pre-campaign server. @type {Campaign | null} */
let campaign = null;
/** The quiz running here (the round's view, the PUBLIC projection: no answer before the reveal), else null.
 *  @type {import('../../shared/quiz/bank.js').QuizView | null} */
let quizView = null;
/** At least one view arrived. */
let viewed = false;
/** Solo record for the current (size, mode), inside the block view in solo games. @type {Best | null} */
let lastBest = null;
/** @type {string | null} */ let playerId = load(KEYS.id);
/** playerIds with a live socket, from the last view (slice 2b presence). @type {string[]} */
let online = [];
/** Another device took our player (`replaced`): this phone stays offline until "Play here". */
let replaced = false;
/** Placement sent but not yet confirmed: simulated board + tray slot hidden.
 * @type {{ index: number, board: number[] } | null} */
let pending = null;

/** Room code: the join URL's ?room= wins over the stored one (the TV may show a new code). */
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) save(KEYS.room, normalizeRoom(urlRoom));
/** @type {string | null} */ let room = load(KEYS.room);
/** The server refused our join for the room code: ask for it, then join with this character. */
/** `refused`: the code the server just turned down (null: we had none to send). */
let roomPrompt = /** @type {{ character: CharacterId | null, refused: string | null } | null} */ (null);
/** Character tapped in the picker, kept for the join that follows a room prompt. @type {CharacterId | null} */
let wantedCharacter = null;
/** A join sent and not answered yet (welcome or err): the picker waits. @type {CharacterId | null} */
let pendingPick = null;
/** Where our avatar stands: from the server's echo after welcome, else our spawn point. @type {Pos | null} */
let myPos = null;

/** @type {{
 *   pointerId: number, index: number, pieceId: PieceId,
 *   cells: [number, number][], w: number, h: number,
 *   el: HTMLElement, gx: number, gy: number, valid: boolean
 * } | null} */
let drag = null;

/** Board cell elements, rebuilt on every render. @type {HTMLElement[]} */
let cellEls = [];

// ---------- connection ----------

function helloMsg() {
  return {
    t: 'hello', role: 'player',
    ...(room ? { room } : {}),
    ...(playerId ? { playerId } : {}),
  };
}

// The link heals itself (reconnect, liveness probe on unlock/bfcache); the phone keeps showing
// its last view meanwhile, under a banner — a dropped socket never sends anyone back to a menu.
const conn = createConnection({
  url: () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  hello: helloMsg,
  onMessage: receive,
  onStatus: (up) => {
    $('conn-banner').hidden = up;
    updateInteraction();
    if (!up) resetJoinRequest();
    if (!up && drag) { endDrag(); render(); } // a drop can't be sent while offline
  },
  onReplaced,
});

/** Another device continues as our player. Let go of the id for good: a reload or a probe here must
 *  not take it back (no tug of war); the character stays stored, so "Play here" offers it again. */
function onReplaced() {
  replaced = true;
  forget(KEYS.id);
  playerId = null;
  myPos = null;
  pending = null;
  pendingPick = null;
  joystick.cancel();
  if (drag) endDrag();
  menu.close();
  $('conn-banner').hidden = true;
  render();
}

/** @param {unknown} msg */
function send(msg) {
  conn.send(msg);
}

/** Unknown message types are ignored (PROTOCOL.md forward-compatibility rule). @param {string} raw */
function receive(raw) {
  /** @type {any} */ let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.t === 'welcome' && typeof m.playerId === 'string') {
    if (m.playerId !== playerId) myPos = null; // a different player: its own echo or spawn
    playerId = m.playerId;
    roomPrompt = null;
    pendingPick = null;
    save(KEYS.id, m.playerId);
    render();
  } else if (m.t === 'tick') {
    syncClock(m.now); // keep-alive (fed to the watchdog in connection.js); keeps the countdown honest
  } else if (m.t === 'joinQrAck') {
    onJoinQrAck(m);
  } else if (m.t === 'pos') {
    // the one pos a phone receives: our own last position, echoed right after welcome
    const echoed = m.playerId === playerId ? posFromEcho(m) : null;
    if (echoed) { myPos = echoed; render(); }
  } else if (m.t === 'say' || m.t === 'chatHistory') {
    social.onMessage(m);
  } else if (m.t === 'interact' && m.playerId === playerId && typeof m.object === 'string' && Object.hasOwn(OBJECT_ACTIONS, m.object)) {
    toast(OBJECT_ACTIONS[/** @type {keyof typeof OBJECT_ACTIONS} */ (m.object)].feedback);
  } else if (m.t === 'view') {
    syncClock(m.now);
    const prev = lastView;
    const prevNode = campaign?.at.node ?? null;
    round = m.round ?? null;
    lastView = round?.kind === 'blocks' ? round.view : null;
    campaign = m.campaign ?? null;
    quizView = round?.kind === 'quiz' ? round.view : null;
    viewed = true;
    syncContent(m.contentVersion); // fetches the content on the first view and whenever it changed
    lastBest = lastView ? /** @type {State & { best?: Best }} */ (lastView).best ?? null : null;
    online = Array.isArray(m.online) ? m.online.filter((/** @type {unknown} */ x) => typeof x === 'string') : [];
    pending = null;
    const next = lastView;
    const event = prev && next && playerId ? outcome(prev, next, playerId) : null;
    if (event) haptics.buzz(event);
    const turn = prev && next && playerId && next.players[playerId] ? PHASE_TOASTS[`${prev.phase}>${next.phase}`] : undefined;
    // the party moved (a door, the host): say where we are now
    const moved = prevNode !== null && campaign !== null && campaign.at.node !== prevNode && member() ? `→ ${titleOf(campaign.at.node)}` : undefined;
    if (turn || moved) { menu.close(); toast(/** @type {string} */ (moved ?? turn)); }
    render();
  } else if (m.t === 'err') {
    pending = null;
    const refusedPick = pendingPick;
    pendingPick = null;
    if (m.code === 'refused') toast("That can't be done right now.");
    else if (m.code === 'full' && lastView && lastView.phase !== 'lobby') toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} is back online on another phone.`);
    else if (m.code === 'full') showPickError(`Sorry, the game is full (${ROSTER_SIZE} players max).`);
    else if (m.code === 'taken') toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} was just picked. Choose someone else!`);
    else if (m.code === 'bad-room') onBadRoom();
    else if (ERR_TOASTS[m.code]) toast(ERR_TOASTS[m.code]);
    render(); // bad-place and friends: repaint from the last view
  }
}

/** @param {CharacterId} character */
function join(character) {
  wantedCharacter = character;
  pendingPick = character;
  save(KEYS.character, character);
  $('pick-error').hidden = true;
  send({ t: 'join', character });
  render();
}

/** Tell the server, forget this phone's player and come back as a stranger. */
function leaveGame() {
  send({ t: 'leave' });
  forget(KEYS.id);
  playerId = null;
  myPos = null;
  joystick.cancel();
  if (drag) endDrag();
  pending = null;
  conn.restart(); // a fresh socket: the old one stays bound to the removed id on the server
  render();
}

/** Our party member (slice 3: the evening's roster), or without a campaign our block-game player. @returns {PartyMember | Player | null} */
function member() {
  if (!playerId) return null;
  if (campaign) {
    const m = campaign.party.players[playerId];
    return m && !m.left ? m : null;
  }
  return lastView?.players[playerId] ?? null;
}

/** The party host steers the evening (game-master panel). */
const isStory = () => campaign?.facts.flags.includes('story.elo-50') ?? false;
const isGameMaster = () => campaign !== null && playerId !== null && campaign.party.hostId === playerId
  && !!member() && (!isStory() || campaign.facts.flags.includes('portal.entered'));

/** Walking: a member, on the hub / in a world, or in an open block or quiz lobby. */
const canWalk = () => member() !== null && (quizView ? quizView.phase === 'lobby' : !lastView || lastView.phase === 'lobby')
  && !(isStory() && campaign?.at.node === 'hub' && myCharacter() === 'elodie' && !campaign.facts.flags.includes('apparition.seen'));

/** The latest accepted window from this phone. The server decides whether a request succeeded. */
let joinShownUntil = 0;
/** @type {string | null} */ let joinToken = null;
let joinRequestId = 0;
/** @type {number | null} */ let pendingShow = null;
/** @type {{ id: number, announce: boolean } | null} */ let pendingHide = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */ let joinTimer;

/** Shows our join-QR window state: the "Hide from the TV" button lives while the window is open. */
function syncHideJoinButton() {
  $('btn-hide-join').hidden = !joinToken || joinShownUntil <= Date.now();
}

/** A lost connection makes every outstanding request and local TV window uncertain. */
function resetJoinRequest() {
  pendingShow = null;
  pendingHide = null;
  joinToken = null;
  joinShownUntil = 0;
  clearTimeout(joinTimer);
  syncHideJoinButton();
}

/** @param {any} m */
function onJoinQrAck(m) {
  if (m.action === 'show' && m.requestId === pendingShow) {
    pendingShow = null;
    if (!m.accepted || typeof m.token !== 'string' || !Number.isFinite(m.until) || !Number.isFinite(m.now)) {
      toast('TV QR was not shown. Wait a moment and try again.');
      return;
    }
    joinToken = m.token;
    joinShownUntil = Date.now() + Math.max(0, m.until - m.now);
    clearTimeout(joinTimer);
    joinTimer = setTimeout(syncHideJoinButton, Math.max(0, m.until - m.now) + 50);
    syncHideJoinButton();
    if ($('sheet-invite').hidden) hideJoinOnTv();
    else toast(`QR shown on the TV for ${Math.round(JOIN_QR_MS / 1000)} s`);
  } else if (m.action === 'hide' && m.requestId === pendingHide?.id) {
    if (pendingHide?.announce) toast(m.accepted ? 'QR hidden on the TV' : 'That TV QR was already changed or closed.');
    pendingHide = null;
  }
}

/** ☰ → Show the join QR: the TVs show it for JOIN_QR_MS (players only: the server ignores anyone else). */
function showJoinOnTv() {
  if (!member()) return;
  if (!conn.isOnline()) { toast('Connection lost. Try again when connected.'); return; }
  pendingShow = ++joinRequestId;
  send({ t: 'showJoin', requestId: pendingShow });
}

/** Takes OUR current join QR off the TVs. @param {boolean} [announce] */
function hideJoinOnTv(announce = false) {
  if (!joinToken || joinShownUntil <= Date.now()) return;
  const token = joinToken;
  joinToken = null;
  joinShownUntil = 0;
  clearTimeout(joinTimer);
  syncHideJoinButton();
  if (conn.isOnline()) {
    pendingHide = { id: ++joinRequestId, announce };
    send({ t: 'hideJoin', token, requestId: pendingHide.id });
  }
}

/** First back press: close a sheet, or say how to get around (back-guard.js). */
function onBack() {
  if (menu.isOpen()) { menu.close(); return; }
  toast(member()
    ? "You're still in the game. Press back again to leave this page."
    : 'Press back again to leave Itloe.');
}

// ---------- rendering ----------

const VIEWS = ['loading', 'pick', 'room', 'replaced', 'waiting', 'wait-lobby', 'place', 'quiz', 'lobby', 'game', 'over', 'podium'];

/** @param {string} name */
function show(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

function render() {
  menu.refresh();
  social.render();
  if (!member()) menu.close('chat');
  if (replaced) { show('replaced'); return; }
  if (!viewed) { show('loading'); return; }
  const v = lastView;
  const me = v && playerId ? v.players[playerId] ?? null : null;
  const mem = member();
  const isHost = me !== null && v !== null && me.id === v.hostId;
  const configurable = v !== null && v.phase !== 'playing';
  const q = quizView;
  const quizHost = q !== null && playerId !== null && q.hostId === playerId;
  const quizConfigurable = q !== null && (q.phase === 'lobby' || q.phase === 'finished');

  // the settings sheet follows the activity: the block game's schema, or the quiz's
  if (v) settingsSheet.render(v.settings, isHost && configurable);
  else if (q) settingsSheet.render(q.settings, quizHost && quizConfigurable, QUIZ_SETTINGS);
  hostControls.render(v, q, online, playerId ?? '');
  if (q ? !(quizHost && quizConfigurable) : (!isHost || !configurable)) menu.close('settings');
  if (campaign && isGameMaster()) gmPanel.render(campaign, round?.status ?? null);
  else menu.close('gm');
  // 🎒 my items (Contract F): they hang on my character, so they follow me to any phone
  bag.render(campaign && mem ? campaign.facts : null, mem ? myCharacter() : null);
  if (!mem) menu.close('bag');
  updateClock();

  // the piece being dragged left our hand → the drag is stale
  if (drag && (!me || me.hand[drag.index] !== drag.pieceId)) endDrag();
  // walking stops where it is not allowed (a game under way): final moving:false
  if (!canWalk()) joystick.cancel();

  if (!mem) {
    if (roomPrompt) { show('room'); renderRoomPrompt(roomPrompt); return; }
    // the picker shows whenever there is something to tap: a free character while no block game is
    // under way, or (anytime) a character whose phone is offline, to continue as
    const roster = campaign ? campaign.party : v;
    const joinable = (!v || v.phase === 'lobby') && (!q || q.phase === 'lobby');
    const states = roster ? pickStates(roster, joinable, online) : null;
    if (states && isStory() && campaign && !campaign.facts.flags.includes('portal.ready')) {
      for (const id of states.keys()) if (!OPENING_PLAYERS.includes(id)) states.set(id, 'taken');
    }
    if (!states || (!anyPickable(states) && pendingPick === null)) {
      show('waiting');
      $('waiting-text').textContent = v?.phase === 'finished' ? 'A game just ended.' : 'A game is already running.';
      return;
    }
    show('pick');
    const last = load(KEYS.character);
    picker.render(states, pendingPick, isCharacterId(last) ? last : null);
    const extra = /** @type {HTMLElement | null} */ (document.querySelector('#picker-grid [data-id="konz"]'));
    if (extra) extra.hidden = isStory() && !!campaign && !campaign.facts.flags.includes('portal.ready');
    return;
  }
  if (q) {
    if (!playerId || !q.players[playerId]) { // in the evening, but this quiz started before we joined
      show('waiting');
      $('waiting-text').textContent = "A quiz is on. You'll play the next one!";
      return;
    }
    // the quiz's lobby is the room, like the block lobby: walk, settings, the host's Start
    if (q.phase === 'lobby') { show('lobby'); renderLobby(q, q.players[playerId], quizHost, summarizeQuiz(q.settings)); return; }
    show('quiz');
    quizUi.render(q, playerId);
    return;
  }
  if (!v) {
    if (isStory() && campaign?.at.node === 'hub' && mem.character !== 'elodie'
      && !campaign.facts.flags.includes(`person.${mem.character}.unlocked`)) {
      show('wait-lobby'); dockStick('wait-lobby'); return;
    }
    show('place'); if (campaign) renderPlace(campaign, mem); return;
  }
  if (!me) { // in the evening, but this game started before we joined: we play the next one
    show('waiting');
    $('waiting-text').textContent = "A game is on. You'll play the next one!";
    return;
  }
  if (v.phase === 'lobby') { show('lobby'); renderLobby(v, me, isHost, summarize(v.settings)); return; }
  if (v.phase === 'finished') { show('podium'); renderPodium(v, me, isHost); return; }
  if (me.done) { show('over'); renderGameOver(v, me); return; }
  show('game');
  renderGame(v, me);
}

/**
 * The server turned our room code down (a restart drew a new one, or a typo). That code is forgotten:
 * never stored, never pre-filled again; the prompt names it. Without a code, just ask for one.
 */
function onBadRoom() {
  const refused = room;
  roomPrompt = { character: wantedCharacter, refused };
  if (refused) {
    forget(KEYS.room);
    room = null;
  }
  roomInput.value = '';
}

/** @param {{ refused: string | null }} prompt */
function renderRoomPrompt(prompt) {
  const err = $('room-error');
  err.hidden = !prompt.refused;
  if (prompt.refused) err.textContent = `That code (${prompt.refused}) didn't work. Check the TV and try again.`;
}

/** Our character, or the colour slot's character for a pre-M3 player. @param {LobbyPlayer} p @returns {CharacterId} */
function characterOf(p) {
  if (isCharacterId(p.character)) return p.character;
  return /** @type {CharacterId} */ (Object.values(CHARACTERS).find((c) => c.color === p.color)?.id ?? 'pierre');
}

/** Our character: from the party (slice 3), else from our block-game player. @returns {CharacterId | null} */
function myCharacter() {
  const m = member();
  if (!m) return null;
  if (isCharacterId(m.character)) return m.character;
  return 'board' in m ? characterOf(m) : null;
}

/** The avatar's current position: joystick while held, else the echoed/spawn position. @param {CharacterId} character @returns {Pos} */
function currentPos(character) {
  if (!myPos) myPos = { ...spawnPoint(character), moving: false };
  return joystick.current() ?? myPos;
}

/** The stick lives in whichever walking screen is showing (lobby or place): move it there. @param {string} view */
function dockStick(view) {
  const pad = $('stick-pad');
  const actions = $('object-actions');
  const host = $(`view-${view}`);
  if (pad.parentElement !== host) host.append(actions, pad);
  updateInteraction();
}

/** Keep one contextual button in step with the avatar's feet, including while the stick is held. */
function updateInteraction() {
  const character = myCharacter();
  const inHub = isStory() && campaign?.at.node === 'hub';
  const pos = character && canWalk() ? currentPos(character) : null;
  const canCollect = inHub && character === 'elodie' && pos && campaign?.facts.flags.includes('apparition.seen')
    && !campaign.facts.inventory.elodie?.[INTRO_KEY]
    && Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius;
  const object = pos && (!inHub || character === 'elodie')
    ? nearbyObject(inHub ? APARTMENT_ROOM : PARTY_ROOM, pos) : null;
  const button = /** @type {HTMLButtonElement} */ ($('btn-interact'));
  button.dataset.object = canCollect ? INTRO_KEY : object?.id ?? '';
  button.disabled = !(canCollect || object) || !conn.isOnline();
  button.textContent = canCollect ? '🗝️ Pick up key'
    : object ? OBJECT_ACTIONS[/** @type {keyof typeof OBJECT_ACTIONS} */ (object.id)].label : 'Walk to an object';
}

/** Hub, world or a scene tableau: where the party is, what is open from here, how to go on.
 *  @param {Campaign} c @param {PartyMember | Player} mem */
function renderPlace(c, mem) {
  const here = content().nodes[c.at.node];
  $('place-kind').textContent = here?.kind === 'hub' ? 'The hub' : here?.kind === 'world' ? 'A world' : '';
  $('place-title').textContent = titleOf(c.at.node);
  const intro = $('place-intro');
  intro.hidden = !here?.intro;
  intro.textContent = here?.intro ?? '';

  // open places only (no spoilers): done ✓, never entered ✨; the locked ones are just counted
  const marks = childMarks(c).filter((m) => m.node.door);
  const open = marks.filter((m) => m.unlocked);
  const ul = $('place-children');
  ul.replaceChildren(...open.map((m) => {
    const li = document.createElement('li');
    li.dataset.node = m.node.id;
    li.className = m.fresh ? 'fresh' : '';
    li.textContent = `${m.node.title}${m.done ? ' ✓' : ''}${m.fresh ? ' ✨' : ''}`;
    return li;
  }));
  const locked = marks.length - open.length;
  if (locked > 0) {
    const li = document.createElement('li');
    li.className = 'locked';
    li.textContent = `🔒 ${locked} more to discover`;
    ul.append(li);
  }
  ul.hidden = marks.length === 0;

  const chooser = CHARACTERS[content().chooser];
  const isChooser = mem.character === content().chooser;
  const doors = open.length > 0;
  $('btn-place-back').hidden = !(isStory() && c.at.node === 'hub.door4' && isChooser);
  $('place-hint').hidden = !(isChooser && doors);
  if (isStory() && c.at.node === 'hub' && !c.facts.flags.includes('apparition.seen')) {
    $('place-wait').textContent = 'Watch the TV—the visitor is speaking.';
    dockStick('place');
    return;
  }
  if (isStory() && c.at.node === 'hub' && !c.facts.inventory.elodie?.[INTRO_KEY]) {
    $('place-wait').textContent = 'Walk to the glowing key and pick it up.';
    dockStick('place');
    return;
  }
  $('place-wait').textContent = !doors
    ? (here?.kind === 'tableau' ? 'Eyes on the big screen!' : '')
    : isChooser ? ''
      : isGameMaster() ? `${chooser.name} walks into a door, or you pick one from ☰ 🎲 Game master.`
        : `${chooser.name} chooses where we go next.`;
  dockStick('place');
}

/**
 * The room at a tableau: the block game's lobby, or the quiz's.
 * @param {{ order: string[], players: Record<string, LobbyPlayer>, hostId: string | null }} v
 * @param {LobbyPlayer} me @param {boolean} isHost @param {string} settings the settings summary
 */
function renderLobby(v, me, isHost, settings) {
  dockStick('lobby');
  const header = $('lobby-me');
  header.replaceChildren(
    avatarCanvas(characterOf(me), LOBBY_ME_SCALE, currentPos(characterOf(me)).dir),
    Object.assign(document.createElement('span'), {
      className: 'lobby-me-name',
      textContent: `You're ${me.name}${me.id === v.hostId ? ' 👑' : ''}`,
    }),
  );

  const ul = $('lobby-players');
  ul.replaceChildren();
  for (const id of v.order) {
    const p = v.players[id];
    if (id === me.id || p.left) continue;
    const li = document.createElement('li');
    li.append(avatarCanvas(characterOf(p), LOBBY_CHIP_SCALE), document.createTextNode(
      p.name + (id === v.hostId ? ' 👑' : '')));
    ul.append(li);
  }
  ul.hidden = ul.childElementCount === 0;
  $('lobby-settings').textContent = settings;
  const opening = isStory() && campaign?.at.node === content().start && !campaign.facts.flags.includes('portal.ready');
  const portalReady = isStory() && campaign?.at.node === content().start && campaign.facts.flags.includes('portal.ready');
  const quartetReady = OPENING_PLAYERS.every((character) => v.order.some((id) => !v.players[id].left && v.players[id].character === character));
  $('btn-settings-lobby').hidden = !isHost || !!portalReady;
  $('btn-start').hidden = !isHost || !!portalReady;
  /** @type {HTMLButtonElement} */ ($('btn-start')).disabled = !!opening && !quartetReady;
  $('lobby-hint').textContent = portalReady ? 'A portal has appeared. Élodie, walk into it!'
    : opening && !quartetReady ? 'Wait for all four players.'
      : isHost ? (v.order.length === 1 ? 'Play solo, or wait for friends to join.' : 'Everyone in? Hit start!')
        : 'Waiting for the host to start…';
}

/** @param {State} v @param {Player} me */
function renderGame(v, me) {
  $('my-rank').textContent = RANK_BADGES[rankOf(v, me.id) - 1] ?? '';
  $('my-score').textContent = String(me.score);

  const opp = $('opponents');
  opp.replaceChildren();
  for (const id of v.order) {
    if (id === me.id) continue;
    const p = v.players[id];
    const chip = document.createElement('span');
    chip.className = 'opp';
    const off = !p.done && !online.includes(id);
    chip.append(dotEl(p.color), document.createTextNode(`${p.name} ${p.done ? (p.retired ? '👋' : '💀') : p.score}${off ? ' 📴' : ''}`));
    // the host can act on an offline player right from the bar: the chip opens the host menu
    if (off && v.hostId === me.id) { chip.dataset.open = 'menu'; chip.classList.add('offline'); }
    opp.append(chip);
  }

  renderBoard(pending ? pending.board : me.board, v.size);
  renderTray(me);
  if (drag) paintGhost();
}

/** @param {number[]} board @param {number} size */
function renderBoard(board, size) {
  const el = $('board');
  el.style.setProperty('--n', String(size));
  const frag = document.createDocumentFragment();
  cellEls = [];
  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('div');
    cell.className = board[i] ? `cell c${board[i]}` : 'cell';
    frag.append(cell);
    cellEls.push(cell);
  }
  el.replaceChildren(frag);
}

/** @param {Player} me */
function renderTray(me) {
  for (let i = 0; i < 3; i++) {
    const slot = $(`slot-${i}`);
    slot.replaceChildren();
    const id = me.hand[i];
    const hidden = (pending !== null && pending.index === i) || (drag !== null && drag.index === i);
    if (id != null && !hidden) slot.append(pieceEl(id, me.color, TRAY_CELL));
  }
}

/** @param {State} v @param {Player} me */
function renderGameOver(v, me) {
  // taken out by the host (slice 2b): calm, the run still counts
  $('over-icon').textContent = me.retired ? '👋' : '💀';
  $('over-title').textContent = me.retired ? 'The host took you out — your score counts' : 'Out of moves!';
  $('final-score').textContent = String(me.score);
  $('final-rank').textContent = v.order.length > 1
    ? `You're ${ordinal(rankOf(v, me.id))} of ${v.order.length} so far.`
    : '';
  const ul = $('final-others');
  ul.replaceChildren();
  for (const { id, score } of ranking(v)) {
    if (id === me.id) continue;
    const p = v.players[id];
    const li = document.createElement('li');
    li.append(dotEl(p.color), document.createTextNode(`${p.name} — ${score}${p.done ? ' 💀' : ''}`));
    ul.append(li);
  }
}

/** Countdown text in the top bar (and on the Done screen while the others still play). */
function updateClock() {
  const v = lastView;
  const deadline = v !== null && v.phase === 'playing' ? v.deadline : null;
  $('clock-game').hidden = deadline === null;
  $('over-clock-line').hidden = deadline === null || v === null || v.order.length < 2;
  if (deadline === null) return;
  const left = secondsLeft(deadline);
  for (const el of document.querySelectorAll('.clock')) {
    el.textContent = mmss(left);
    el.classList.toggle('urgent', left <= URGENT_SECONDS);
  }
}

/** @param {State} v @param {Player} me */
function podiumTitle(v, me) {
  if (v.order.length === 1) return isNewBest(me) ? 'New best! 🎉' : 'Nice run!';
  if (rankOf(v, me.id) !== 1) return 'Podium';
  return ranking(v).filter((r) => r.rank === 1).length > 1 ? "It's a tie! 🎉" : 'You win! 🎉';
}

/** @param {Player} me */
function isNewBest(me) {
  return lastBest !== null && (lastBest.previous === null || me.score > lastBest.previous);
}

/** @param {State} v @param {Player} me @param {boolean} isHost */
function renderPodium(v, me, isHost) {
  const portalReady = isStory() && campaign?.at.node === content().start && campaign.facts.flags.includes('portal.ready');
  const kicker = v.endReason === 'time' ? "⏰ Time's up!" : v.endReason === 'host' ? 'The host ended the game.' : '';
  $('podium-kicker').hidden = kicker === '';
  $('podium-kicker').textContent = kicker;
  $('podium-title').textContent = podiumTitle(v, me);
  const best = $('podium-best');
  best.hidden = v.order.length !== 1 || lastBest === null || isNewBest(me);
  if (lastBest) best.textContent = `Your best: ${lastBest.score}`;

  const ol = $('podium-list');
  ol.replaceChildren();
  for (const { id, rank, score } of ranking(v)) {
    const p = v.players[id];
    const li = document.createElement('li');
    if (rank === 1) li.className = 'champion'; // ties share rank 1: co-champions
    if (id === me.id) li.classList.add('me');
    li.append(
      document.createTextNode(`${MEDALS[rank - 1] || `${rank}.`} `),
      dotEl(p.color),
      document.createTextNode(` ${p.name} — ${score}`),
    );
    ol.append(li);
  }
  $('podium-settings').textContent = portalReady ? 'Return to the room together.' : `Next game: ${summarize(v.settings)}`;
  $('btn-settings-podium').hidden = !isHost || !!portalReady;
  $('btn-again').hidden = !!portalReady;
  $('podium-hint').textContent = portalReady ? 'Waiting for the host to return to the room…'
    : 'Waiting for the host: rematch or back to the room…';
  $('podium-actions').hidden = !isHost;
  $('podium-hint').hidden = isHost;
}

/** @param {string} text */
function showPickError(text) {
  const el = $('pick-error');
  el.textContent = text;
  el.hidden = false;
}

// ---------- drag & drop ----------

/** @param {PointerEvent} e @param {number} index */
function startDrag(e, index) {
  if (drag || pending || !lastView || !playerId || !conn.isOnline()) return;
  const me = lastView.players[playerId];
  if (!me || lastView.phase !== 'playing' || me.done) return;
  const pieceId = me.hand[index];
  if (pieceId == null || cellEls.length === 0) return;
  e.preventDefault();

  const { cells } = PIECES[pieceId];
  const { w, h } = bounds(cells);
  const el = pieceEl(pieceId, me.color, cellSize());
  el.id = 'floating-piece';
  document.body.append(el);

  drag = { pointerId: e.pointerId, index, pieceId, cells, w, h, el, gx: -99, gy: -99, valid: false };
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragDrop);
  window.addEventListener('pointercancel', onDragCancel);
  haptics.buzz('pickup');
  onDragMove(e);
  renderTray(me); // hide the lifted piece
}

/** Side of one board cell in px (measured, follows screen and board size). */
function cellSize() {
  return cellEls[0].getBoundingClientRect().width;
}

/** @param {PointerEvent} e */
function onDragMove(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId || !lastView || cellEls.length === 0) return;
  e.preventDefault();

  const cell = cellSize();
  const pitch = cell + GAP;
  const width = d.w * pitch - GAP;
  const height = d.h * pitch - GAP;
  const left = e.clientX - width / 2;
  const top = e.clientY - LIFT * cell - height;
  d.el.style.transform = `translate(${left}px, ${top}px)`;

  const origin = cellEls[0].getBoundingClientRect();
  d.gx = Math.round((left - origin.left) / pitch);
  d.gy = Math.round((top - origin.top) / pitch);
  const me = playerId ? lastView.players[playerId] : null;
  d.valid = me != null && canPlace(me.board, lastView.size, d.cells, d.gx, d.gy);
  paintGhost();
}

/** Ghost under the piece: green/red + preview of the lines that would clear. */
function paintGhost() {
  const d = drag;
  const v = lastView;
  clearGhost();
  if (!d || !v || !playerId) return;
  const n = v.size;
  const cls = d.valid ? 'ghost-ok' : 'ghost-bad';
  let onBoard = false;
  for (const [cx, cy] of d.cells) {
    const x = d.gx + cx, y = d.gy + cy;
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    cellEls[y * n + x].classList.add(cls);
    onBoard = true;
  }
  if (!onBoard || !d.valid) return;
  const me = v.players[playerId];
  const after = place(me.board, n, d.cells, d.gx, d.gy, me.color);
  const { rows, cols } = findClears(after, n);
  for (const r of rows) for (let c = 0; c < n; c++) cellEls[r * n + c].classList.add('clear-preview');
  for (const c of cols) for (let r = 0; r < n; r++) cellEls[r * n + c].classList.add('clear-preview');
}

function clearGhost() {
  for (const cell of cellEls) cell.classList.remove('ghost-ok', 'ghost-bad', 'clear-preview');
}

/** @param {PointerEvent} e */
function onDragDrop(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const v = lastView;
  endDrag();
  if (d.valid && v && playerId) {
    const me = v.players[playerId];
    send({ t: 'place', piece: d.index, x: d.gx, y: d.gy });
    // optimistic paint: same simulation as the server, reconciled by the next view/err
    const after = place(me.board, v.size, d.cells, d.gx, d.gy, me.color);
    const clears = findClears(after, v.size);
    const lines = clears.rows.length + clears.cols.length;
    pending = { index: d.index, board: applyClears(after, v.size, clears) };
    if (lines > 0) haptics.buzzClear(lines);
    else haptics.buzz('place');
  }
  render();
}

/** @param {PointerEvent} e */
function onDragCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag();
  render();
}

/** Removes floating piece, ghost and listeners. Does not re-render. */
function endDrag() {
  if (!drag) return;
  drag.el.remove();
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragDrop);
  window.removeEventListener('pointercancel', onDragCancel);
  clearGhost();
}

// ---------- wiring ----------

const menu = initMenu({
  canLeave: () => member() !== null,
  onLeave: leaveGame,
  isGameMaster,
  onShowJoin: showJoinOnTv,
  onHideJoin: () => hideJoinOnTv(true),
  // closing the QR sheet takes the TV card with it, when this phone put it there
  onClosed: (sheet) => { if (sheet === 'invite') hideJoinOnTv(); },
});
const settingsSheet = createSettingsSheet({ send });
const hostControls = createHostControls({ send });
const gmPanel = createGmPanel({ send });
const quizUi = createQuizUi({ send });
const bag = createBag();
const social = createSocial({
  send,
  canSend: () => member() !== null && conn.isOnline(),
  me: () => playerId,
  name: (id) => campaign?.party.players[id]?.name ?? lastView?.players[id]?.name ?? 'Guest',
});
const picker = createPicker({ onPick: join });

const joystick = createJoystick({
  pad: $('stick-pad'),
  base: $('stick-base'),
  knob: $('stick-knob'),
  start: () => {
    const character = myCharacter();
    return character && canWalk() ? currentPos(character) : null;
  },
  // one room so far; when there are several, this is where the current one is chosen
  scene: () => campaign?.at.node === 'hub.door4' ? DOOR_FOUR_ROOM
    : isStory() && campaign?.at.node === 'hub' && myCharacter() === 'elodie' ? APARTMENT_ROOM : PARTY_ROOM,
  send: (pos) => {
    const turned = myPos?.dir !== pos.dir;
    myPos = pos;
    send({ t: 'pos', ...pos });
    if (turned) repaintMyAvatar(pos);
    updateInteraction();
  },
  onGrab: () => haptics.buzz('pickup'),
});

/** Turn the lobby header avatar to the facing we just sent. @param {Pos} pos */
function repaintMyAvatar(pos) {
  const me = playerId ? (quizView ?? lastView)?.players[playerId] : undefined;
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.querySelector('#lobby-me canvas'));
  if (me && canvas) paintAvatar(canvas, characterOf(me), pos.dir);
}

const roomInput = /** @type {HTMLInputElement} */ ($('room-input'));
roomInput.value = room ?? '';

$('room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoom(roomInput.value);
  if (!code) { roomInput.focus(); return; }
  room = code;
  save(KEYS.room, code);
  // a second hello on the same socket updates the room check, then the held join goes through
  send(helloMsg());
  const character = roomPrompt?.character ?? wantedCharacter;
  if (character) join(character);
  else { roomPrompt = null; render(); } // nothing picked yet: back to the picker
});

$('btn-start').addEventListener('click', () => send({ t: 'start' }));
$('btn-place-back').addEventListener('click', () => send({ t: 'back' }));
$('btn-interact').addEventListener('click', () => {
  if (!canWalk() || !conn.isOnline()) return;
  joystick.cancel(); // flush the exact position before the interaction on the same socket
  const character = myCharacter();
  if (isStory() && character === 'elodie' && campaign?.at.node === 'hub'
    && !campaign.facts.inventory.elodie?.[INTRO_KEY]
    && campaign.facts.flags.includes('apparition.seen')) {
    const pos = currentPos(character);
    if (Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius) {
      send({ t: 'interact', object: INTRO_KEY }); return;
    }
  }
  const object = character ? nearbyObject(isStory() && campaign?.at.node === 'hub' ? APARTMENT_ROOM : PARTY_ROOM,
    currentPos(character)) : null;
  if (object) send({ t: 'interact', object: object.id });
  updateInteraction();
});
$('btn-again').addEventListener('click', () => send({ t: 'again' }));
$('btn-new-game').addEventListener('click', () => send({ t: 'newGame' }));
$('btn-play-here').addEventListener('click', () => {
  replaced = false;
  conn.restart(); // a hello without our old id: the picker shows who can be continued
  render();
});

for (let i = 0; i < 3; i++) {
  $(`slot-${i}`).addEventListener('pointerdown', (e) => startDrag(e, i));
}

installBackGuard({ onBack });
onContentChange(render); // titles, doors and the tree come with the content
setInterval(() => { updateClock(); quizUi.tick(); }, CLOCK_TICK_MS);
show('loading');
conn.start();
