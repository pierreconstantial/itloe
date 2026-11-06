// P3 — phone client /play: the frame around every minigame. Renders strictly from the last `view`
// (PROTOCOL.md); a running minigame's screens are its own (./minigames.js), mounted in #view-minigame.
// Path ../../shared: resolved on disk by tsc, normalized to /shared/ by the browser.
import { KEYS, load, save, forget } from './storage.js';
import { $, toast } from './dom.js';
import * as haptics from './haptics.js';
import { initMenu } from './menu.js';
import { syncClock, serverNow } from '../commun/clock.js';
import { CHARACTERS, ROSTER_SIZE, isCharacterId } from '../../shared/characters.js';
import { WORLD, spawnPoint } from '../../shared/world.js';
import { roomAt } from '../../shared/campaign/content.js';
import { gameMasterId, isWisp } from '../../shared/campaign/index.js';
import { room as sceneRoom } from '../../shared/scene.js';
import { interactionActor, nearbyObject, nearbyProp, objectAction } from '../../shared/interactions.js';
import { INTRO_KEY, INTRO_KEY_SPOT } from '../../shared/campaign/story.js';
import { createPicker, pickStates, anyPickable } from './picker.js';
import { createJoystick } from './joystick.js';
import { avatarCanvas, paintAvatar } from '../commun/avatar.js';
import { posFromEcho } from './movement.js';
import { createConnection } from './connection.js';
import { installBackGuard } from './back-guard.js';
import { createGmPanel } from './gm-panel.js';
import { screenOf } from './minigames.js';
import { createBag } from './bag.js';
import { createSocial } from './social.js';
import { JOIN_QR_MS } from '../../shared/join-qr.js';
import { childMarks, content, onContentChange, syncContent, titleOf } from './campaign-view.js';

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/campaign/types.js').PartyMember} PartyMember */
/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('./movement.js').Pos} Pos */
/** A party member in the room at a tableau. @typedef {{ id: string, name: string, color: number, character: CharacterId, left?: boolean, statuses: string[] }} TableauPlayer */

/** What the wisp pad says on the hub (the story's wisps). */
const WISP_TEXT = 'Move your light on the TV. Tap Shine in the reactions to glow brighter.';
const TABLEAU_ME_SCALE = 4; // own avatar in the room's header: 64 px
const TABLEAU_CHIP_SCALE = 2; // other players' avatars: 32 px

/** @returns {Record<string, string>} */
const errToasts = () => ({
  locked: 'Settings are locked while a game is on.',
  'not-gm': `Only ${gameMasterName()} can do that.`,
});

/** What the game master's step became, told to everyone at the tableau; `room`: the minigame ended. @type {Record<string, string>} */
const PHASE_TOASTS = {
  'podium>lobby': 'Back to the lobby!',
  'lobby>room': 'Back to the room!',
};

// ---------- pure helpers ----------

/** Room codes are typed loosely on phones: "ab cd" → "ABCD". @param {string} raw */
function normalizeRoom(raw) {
  return raw.replace(/\s+/g, '').toUpperCase();
}

// ---------- client state ----------

/** The view's running minigame, null while none runs or before the first view. @type {MinigameView | null} */
let minigame = null;
/** The whole evening (slice 3), null from a pre-campaign server. @type {Campaign | null} */
let campaign = null;
/** The minigame screens mounted in #view-minigame while a minigame runs: their kind and handle, else null.
 *  @type {{ kind: string, screen: import('./minigames.js').Mounted } | null} */
let running = null;
/** At least one view arrived. */
let viewed = false;
/** @type {string | null} */ let playerId = load(KEYS.id);
/** playerIds with a live socket, from the last view (slice 2b presence). @type {string[]} */
let online = [];
/** Another device took our player (`replaced`): this phone stays offline until "Play here". */
let replaced = false;
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
let incarnationAt = 0;
let incarnationTimer = /** @type {ReturnType<typeof setInterval> | null} */ (null);

function showIncarnation() {
  const left = incarnationAt - serverNow();
  $('incarnation').hidden = left <= 0;
  if (left > 0) $('incarnation-count').textContent = String(Math.min(3, Math.max(1, Math.ceil(left / 1000))));
  else if (incarnationTimer) {
    clearInterval(incarnationTimer); incarnationTimer = null; incarnationAt = 0;
    render();
  }
}

/** @param {number} at */
function setIncarnation(at) {
  if (at === incarnationAt) return;
  incarnationAt = at;
  if (incarnationTimer) { clearInterval(incarnationTimer); incarnationTimer = null; }
  if (at > serverNow()) {
    haptics.buzz('incarnate');
    incarnationTimer = setInterval(showIncarnation, 100);
  }
  showIncarnation();
}

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
    if (running) render(); // the minigame's screens hear of it
  },
  onReplaced,
});

/** Another device continues as our player. Let go of the id for good: a reload or a probe here must
 *  not take it back (no tug of war); the character stays stored, so "Play here" offers it again. */
function onReplaced() {
  setIncarnation(0);
  replaced = true;
  forget(KEYS.id);
  playerId = null;
  myPos = null;
  pendingPick = null;
  joystick.cancel();
  unmountScreen();
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
  } else if (m.t === 'unsaved') {
    running?.screen.message(m); // the running minigame's own; none running: ignored
  } else if (m.t === 'say' || m.t === 'chatHistory') {
    social.onMessage(m);
  } else if (m.t === 'interact' && m.playerId === playerId && typeof m.feedback === 'string') {
    toast(m.feedback);
  } else if (m.t === 'view') {
    syncClock(m.now);
    const prev = minigame;
    const prevNode = campaign?.at.node ?? null;
    minigame = m.minigame ?? null;
    campaign = m.campaign ?? null;
    setIncarnation(Number(m.incarnations?.[playerId ?? '']?.at) || 0);
    viewed = true;
    syncContent(m.contentVersion); // fetches the content on the first view and whenever it changed
    online = Array.isArray(m.online) ? m.online.filter((/** @type {unknown} */ x) => typeof x === 'string') : [];
    // the podium became the lobby, or the lobby the room at the same tableau
    const next = minigame;
    const turn = prev && member() && campaign?.at.node === prevNode
      ? PHASE_TOASTS[`${prev.status}>${next ? next.status : 'room'}`] : undefined;
    // the party moved (a door, the game master): say where we are now
    const moved = prevNode !== null && campaign !== null && campaign.at.node !== prevNode && member() ? `→ ${titleOf(campaign.at.node)}` : undefined;
    if (turn || moved) { menu.close(); toast(/** @type {string} */ (moved ?? turn)); }
    render();
  } else if (m.t === 'err') {
    const refusedPick = pendingPick;
    pendingPick = null;
    if (m.code === 'refused') toast("That can't be done right now.");
    else if (m.code === 'full' && minigame) toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} is back online on another phone.`);
    else if (m.code === 'full') showPickError(`Sorry, the game is full (${ROSTER_SIZE} players max).`);
    else if (m.code === 'taken') toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} was just picked. Choose someone else!`);
    else if (m.code === 'bad-room') onBadRoom();
    else if (errToasts()[m.code]) toast(errToasts()[m.code]);
    running?.screen.message(m);
    render();
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
  setIncarnation(0);
  send({ t: 'leave' });
  forget(KEYS.id);
  playerId = null;
  myPos = null;
  joystick.cancel();
  unmountScreen();
  conn.restart(); // a fresh socket: the old one stays bound to the removed id on the server
  render();
}

/** Our party member (the evening's roster), null when we aren't one. @returns {PartyMember | null} */
function member() {
  if (!playerId || !campaign) return null;
  const m = campaign.party.players[playerId];
  return m && !m.left ? m : null;
}

/** The screens of the tableau's minigame (null on the hub, in a world, at a scene). */
const screensHere = () => screenOf(campaign?.at.kind);

/** The game master's id (shared/campaign: Pierre, by the content), or null while he isn't in the evening. */
const gameMaster = () => (campaign ? gameMasterId(campaign.party, content()) : null);
/** The game master's name, for the hints. */
const gameMasterName = () => CHARACTERS[content().gameMaster].name;

/** The birthday story (its own screens and hints). */
const isStory = () => campaign?.facts.flags.includes('story.elo-50') ?? false;
/** Do we show as a wisp now (the story's, or one the running minigame doesn't show)? */
const amWisp = () => !!playerId && !!campaign && isWisp(campaign.party, playerId, minigame?.shows ?? null);
/** The room where the party is: what the joystick walks in and the object button looks around. */
/** @type {WeakMap<import('../../shared/scene.js').Scene, import('../../shared/scene.js').Scene>} */
const wispRooms = new WeakMap();
const roomHere = () => {
  const base = roomAt(content(), campaign?.at.node);
  if (!amWisp()) return base;
  let scene = wispRooms.get(base);
  if (!scene) { scene = sceneRoom(`${base.id}-wisp`, { x: 0, y: 0, w: WORLD.w, h: WORLD.h }, []); wispRooms.set(base, scene); }
  return scene;
};
const isGameMaster = () => playerId !== null && gameMaster() === playerId;

/** Walking: a member while no minigame runs (on the hub, in a world, in the room at a tableau), or a wisp at any time. */
const canWalk = () => member() !== null && incarnationAt <= serverNow()
  && (amWisp() || minigame === null)
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

const VIEWS = ['loading', 'pick', 'room', 'replaced', 'waiting', 'wait-lobby', 'place', 'minigame', 'tableau'];

/** Shows one screen; the running minigame's screens go whenever another one shows. @param {string} name */
function show(name) {
  if (name !== 'minigame') unmountScreen();
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

/** What the frame offers a minigame's screens. @type {import('./minigames.js').PhoneIo} */
const io = {
  send,
  meId: () => playerId ?? '',
  isGameMaster,
  gameMasterName: () => gameMasterName(),
  online: () => online,
  connected: () => conn.isOnline(),
};

/** The screens of a minigame of `kind`, mounted in #view-minigame (kept while the kind stays). @param {string} kind */
function mountScreen(kind) {
  if (running?.kind !== kind) {
    unmountScreen();
    running = { kind, screen: /** @type {import('./minigames.js').PhoneScreen} */ (screenOf(kind)).mount($('view-minigame'), io) };
  }
  return running.screen;
}

/** Removes the running minigame's screens, with their listeners, loops and timers. */
function unmountScreen() {
  const r = running;
  running = null;
  r?.screen.unmount();
}

function render() {
  menu.refresh();
  social.render();
  if (!member()) menu.close('chat');
  if (replaced) { show('replaced'); return; }
  if (!viewed) { show('loading'); return; }
  const mem = member();
  // the tableau's minigame (null on the hub, in a world, at a scene) and the room while it doesn't run
  const kind = campaign?.at.kind ?? null;
  const inRoom = kind !== null && minigame === null;

  // the minigame's settings sheet is its lobby's, for the game master
  if (!(isGameMaster() && minigame?.status === 'lobby')) menu.close('settings');
  if (campaign && isGameMaster()) gmPanel.render(campaign, minigame?.status ?? null);
  else menu.close('gm');
  // 🎒 my items (Contract F): they hang on my character, so they follow me to any phone
  bag.render(campaign && mem ? campaign.facts : null, mem ? myCharacter() : null);
  if (!mem) menu.close('bag');

  // walking stops where it is not allowed (a game under way): final moving:false
  if (!canWalk()) joystick.cancel();

  if (!mem) {
    if (roomPrompt) { show('room'); renderRoomPrompt(roomPrompt); return; }
    // A free character joins the evening even while a minigame runs; an offline character continues its
    // existing seat.
    const states = campaign ? pickStates(campaign.party, online) : null;
    if (!states || (!anyPickable(states) && pendingPick === null)) {
      show('waiting');
      $('waiting-text').textContent = 'A game is already running.';
      $('waiting-hint').textContent = 'Watch it on the big screen!';
      return;
    }
    show('pick');
    const last = load(KEYS.character);
    picker.render(states, pendingPick, isCharacterId(last) ? last : null);
    return;
  }
  if (inRoom && campaign) { // the room at the tableau: walk, and the game master's Start
    const party = campaign.party;
    const here = { order: party.order.filter((id) => !party.players[id].left && party.players[id].character), players: party.players };
    show('tableau');
    renderTableau(here, mem, isGameMaster());
    return;
  }
  if (minigame && campaign) { // a running minigame: its screens, or the pad of a wisp floating over it
    if (amWisp() && !isGameMaster()) { // the game master keeps his controls when he sits a round out
      // the screens see the view that turns us into a wisp (a block player out of moves feels it), then go
      if (running?.kind === minigame.kind) running.screen.update(minigame, campaign);
      show('wait-lobby'); dockStick('wait-lobby');
      $('wait-lobby-text').textContent = `The ${screenOf(minigame.kind)?.name ?? 'game'} is on: until you play, you float over it as a light. Move it here, and tap Shine in the reactions to glow brighter.`;
      return;
    }
    show('minigame');
    mountScreen(minigame.kind).update(minigame, campaign);
    return;
  }
  if (isStory() && campaign?.at.node === 'hub' && amWisp()) {
    show('wait-lobby'); dockStick('wait-lobby'); $('wait-lobby-text').textContent = WISP_TEXT; return;
  }
  show('place'); if (campaign) renderPlace(campaign, mem);
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

/** Our character, from the party. @returns {CharacterId | null} */
function myCharacter() {
  const m = member();
  return m ? m.character : null;
}

/** The avatar's current position: joystick while held, else the echoed/spawn position. @param {CharacterId} character @returns {Pos} */
function currentPos(character) {
  if (!myPos) myPos = { ...spawnPoint(character), moving: false };
  return joystick.current() ?? myPos;
}

/** The stick lives in whichever walking screen is showing (the room at a tableau, a place, a wisp's): move it there. @param {string} view */
function dockStick(view) {
  const pad = $('stick-pad');
  const actions = $('object-actions');
  const host = $(`view-${view}`);
  if (pad.parentElement !== host) host.append(actions, pad);
  updateInteraction();
}

/** Wisps may shine near visible furniture or the intro key, without using either object.
 * @param {{x: number, y: number}} pos */
function wispNearObject(pos) {
  if (!campaign || minigame) return false; // over a minigame there is no furniture

  if (nearbyProp(roomAt(content(), campaign.at.node), pos)) return true;
  return isStory() && campaign.at.node === 'hub' && campaign.facts.flags.includes('apparition.seen')
    && !campaign.facts.inventory.elodie?.[INTRO_KEY]
    && Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius;
}

/** Keep one contextual button in step with the avatar's feet, including while the stick is held. */
function updateInteraction() {
  const character = myCharacter();
  const inHub = isStory() && campaign?.at.node === 'hub';
  const mem = member();
  const actor = mem ? interactionActor(mem, campaign?.facts) : null;
  const pos = character && canWalk() ? currentPos(character) : null;
  const canCollect = inHub && !!objectAction(INTRO_KEY, actor) && pos && campaign?.facts.flags.includes('apparition.seen')
    && !campaign.facts.inventory.elodie?.[INTRO_KEY]
    && Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius;
  const object = pos ? nearbyObject(roomHere(), pos, actor) : null;
  const action = canCollect ? objectAction(INTRO_KEY, actor) : object ? objectAction(object.id, actor) : null;
  const button = /** @type {HTMLButtonElement} */ ($('btn-interact'));
  const jump = /** @type {HTMLButtonElement} */ ($('btn-jump'));
  jump.hidden = !mem || amWisp() || !canWalk() || !!minigame;
  jump.disabled = !conn.isOnline();
  if (mem && amWisp()) {
    const near = pos && wispNearObject(pos);
    button.dataset.object = '';
    button.disabled = !near || !conn.isOnline() || incarnationAt > serverNow();
    button.hidden = !near || incarnationAt > serverNow();
    button.textContent = '✨ Shine';
    $('object-actions').hidden = button.hidden;
    return;
  }
  if (incarnationAt > serverNow()) {
    button.dataset.object = '';
    button.disabled = true;
    button.hidden = true;
    $('object-actions').hidden = true;
    return;
  }
  button.hidden = false;
  $('object-actions').hidden = false;
  button.dataset.object = canCollect ? INTRO_KEY : object?.id ?? '';
  button.disabled = !action || !conn.isOnline();
  button.textContent = action?.text ?? 'Walk to an object';
}

/** Hub, world or a scene tableau: where the party is, what is open from here, how to go on.
 *  @param {Campaign} c @param {PartyMember} mem */
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
  $('btn-place-back').hidden = !(isStory() && c.at.node === 'young-adult' && isChooser);
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
 * The room at a tableau, while its minigame doesn't run: who's here (the party), the game master's Start.
 * @param {{ order: string[], players: Record<string, TableauPlayer> }} v
 * @param {TableauPlayer} me @param {boolean} isGm
 */
function renderTableau(v, me, isGm) {
  dockStick('tableau');
  const header = $('tableau-me');
  header.replaceChildren(
    avatarCanvas(me.character, TABLEAU_ME_SCALE, currentPos(me.character).dir),
    Object.assign(document.createElement('span'), {
      className: 'tableau-me-name',
      textContent: `You're ${me.name}${me.id === gameMaster() ? ' 👑' : ''}`,
    }),
  );

  const ul = $('tableau-players');
  ul.replaceChildren();
  for (const id of v.order) {
    const p = v.players[id];
    if (id === me.id || p.left) continue;
    const li = document.createElement('li');
    li.append(avatarCanvas(p.character, TABLEAU_CHIP_SCALE), document.createTextNode(
      p.name + (id === gameMaster() ? ' 👑' : '')));
    ul.append(li);
  }
  ul.hidden = ul.childElementCount === 0;
  const name = screensHere()?.name ?? 'game';
  $('btn-start-minigame').hidden = !isGm;
  $('btn-start-minigame').textContent = `▶ Start the ${name}`;
  const portalReady = isStory() && campaign?.at.node === content().start && campaign.facts.flags.includes('portal.ready');
  $('tableau-hint').textContent = portalReady ? (campaign?.facts.flags.includes('portal.entered')
    ? 'Élodie went through the portal.' : 'A portal has appeared. Élodie, walk into it!')
    : isGm ? '' : `Waiting for ${gameMasterName()} to start the ${name}…`;
}

/** @param {string} text */
function showPickError(text) {
  const el = $('pick-error');
  el.textContent = text;
  el.hidden = false;
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
const gmPanel = createGmPanel({ send });
const bag = createBag();
const social = createSocial({
  send,
  canSend: () => member() !== null && conn.isOnline(),
  canSpeak: () => member() !== null && conn.isOnline() && !amWisp(),
  isWisp: amWisp,
  me: () => playerId,
  name: (id) => campaign?.party.players[id]?.name ?? 'Guest',
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
  scene: roomHere,
  send: (pos) => {
    const turned = myPos?.dir !== pos.dir;
    myPos = pos;
    send({ t: 'pos', ...pos });
    if (turned) repaintMyAvatar(pos);
    updateInteraction();
  },
  onGrab: () => haptics.buzz('pickup'),
});

/** Turn the room's header avatar to the facing we just sent. @param {Pos} pos */
function repaintMyAvatar(pos) {
  const me = member();
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.querySelector('#tableau-me canvas'));
  if (me && canvas) paintAvatar(canvas, me.character, pos.dir);
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

$('btn-start-minigame').addEventListener('click', () => send({ t: 'startMinigame' }));
$('btn-jump').addEventListener('pointerdown', (e) => e.stopPropagation());
$('btn-jump').addEventListener('click', () => {
  if (canWalk() && !minigame && !amWisp() && conn.isOnline()) send({ t: 'jump' });
});
$('btn-place-back').addEventListener('click', () => send({ t: 'back' }));
$('btn-interact').addEventListener('click', () => {
  if (!canWalk() || !conn.isOnline()) return;
  if (amWisp()) {
    const character = myCharacter();
    if (character && incarnationAt <= serverNow() && wispNearObject(currentPos(character))) send({ t: 'emote', kind: 'shine' });
    return;
  }
  joystick.cancel(); // flush the exact position before the interaction on the same socket
  const character = myCharacter();
  const mem = member();
  const actor = mem ? interactionActor(mem, campaign?.facts) : null;
  if (isStory() && character && objectAction(INTRO_KEY, actor) && campaign?.at.node === 'hub'
    && !campaign.facts.inventory.elodie?.[INTRO_KEY]
    && campaign.facts.flags.includes('apparition.seen')) {
    const pos = currentPos(character);
    if (Math.hypot(pos.x - INTRO_KEY_SPOT.x, pos.y - INTRO_KEY_SPOT.y) < INTRO_KEY_SPOT.radius) {
      send({ t: 'interact', object: INTRO_KEY }); return;
    }
  }
  const object = character ? nearbyObject(roomHere(), currentPos(character), actor) : null;
  if (object) send({ t: 'interact', object: object.id });
  updateInteraction();
});
$('btn-play-here').addEventListener('click', () => {
  replaced = false;
  conn.restart(); // a hello without our old id: the picker shows who can be continued
  render();
});

installBackGuard({ onBack });
onContentChange(render); // titles, doors and the tree come with the content
show('loading');
conn.start();
