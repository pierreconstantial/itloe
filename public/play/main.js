// P3 — phone client /play: the frame around every minigame. Renders strictly from the last `view`
// (PROTOCOL.md); a running round's screens are the minigame's own (./minigames.js), mounted in #view-round.
// Path ../../shared: resolved on disk by tsc, normalized to /shared/ by the browser.
import { ranking } from '../../shared/ranking.js';
import { KEYS, load, save, forget } from './storage.js';
import { $, dotEl, toast } from './dom.js';
import * as haptics from './haptics.js';
import { initMenu } from './menu.js';
import { syncClock } from '../commun/clock.js';
import { createSettingsSheet, summarize } from './settings-ui.js';
import { CHARACTERS, ROSTER_SIZE, isCharacterId } from '../../shared/characters.js';
import { spawnPoint } from '../../shared/world.js';
import { roomAt } from '../../shared/campaign/content.js';
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
import { screenOf } from './minigames.js';
import { createBag } from './bag.js';
import { createSocial } from './social.js';
import { JOIN_QR_MS } from '../../shared/join-qr.js';
import { QUIZ_SETTINGS, summarizeQuiz } from './quiz-text.js';
import { childMarks, content, onContentChange, syncContent, titleOf } from './campaign-view.js';

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/campaign/types.js').PartyMember} PartyMember */
/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('./movement.js').Pos} Pos */
/** The round's players, as every minigame's view carries them (shared/minigames.js). @typedef {import('../../shared/minigames.js').RoundPlayers} RoundPlayers */
/** A party member in the room at a tableau. @typedef {{ id: string, name: string, color: number, character?: string | null, left?: boolean }} LobbyPlayer */

const MEDALS = ['🥇', '🥈', '🥉', ''];
const LOBBY_ME_SCALE = 4; // own avatar in the lobby header: 64 px
const LOBBY_CHIP_SCALE = 2; // other players' avatars: 32 px

/** @type {Record<string, string>} */
const ERR_TOASTS = {
  locked: 'Settings are locked while a game is on.',
  'not-host': 'Only the host can do that.',
};

/** What the podium's choice became, told to everyone (the host picks, guests follow); `room`: no round. @type {Record<string, string>} */
const PHASE_TOASTS = {
  'finished>room': 'Back to the room!',
  'finished>running': 'Rematch! Go go go!',
};

/** The podium's kicker, by how the round ended. @type {Record<string, string>} */
const ENDINGS = { time: "⏰ Time's up!", host: 'The host ended the game.' };

// ---------- pure helpers ----------

/** Room codes are typed loosely on phones: "ab cd" → "ABCD". @param {string} raw */
function normalizeRoom(raw) {
  return raw.replace(/\s+/g, '').toUpperCase();
}

// ---------- client state ----------

/** The view's running round, null between rounds or before the first view. @type {RoundView | null} */
let round = null;
/** The whole evening (slice 3), null from a pre-campaign server. @type {Campaign | null} */
let campaign = null;
/** The minigame screens mounted in #view-round while a round runs: their kind and handle, else null.
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
  } else if (m.t === 'say' || m.t === 'chatHistory') {
    social.onMessage(m);
  } else if (m.t === 'interact' && m.playerId === playerId && typeof m.object === 'string' && Object.hasOwn(OBJECT_ACTIONS, m.object)) {
    toast(OBJECT_ACTIONS[/** @type {keyof typeof OBJECT_ACTIONS} */ (m.object)].feedback);
  } else if (m.t === 'view') {
    syncClock(m.now);
    const prev = round;
    const prevNode = campaign?.at.node ?? null;
    round = m.round ?? null;
    campaign = m.campaign ?? null;
    viewed = true;
    syncContent(m.contentVersion); // fetches the content on the first view and whenever it changed
    online = Array.isArray(m.online) ? m.online.filter((/** @type {unknown} */ x) => typeof x === 'string') : [];
    // a podium we were on became a new round, or the room at the same tableau
    const next = round;
    const turn = prev && screenOf(prev.kind)?.podium && playerId && prev.view.players[playerId]
      && (next ? next.view.players[playerId] : campaign?.at.node === prevNode)
      ? PHASE_TOASTS[`${prev.status}>${next ? next.status : 'room'}`] : undefined;
    // the party moved (a door, the host): say where we are now
    const moved = prevNode !== null && campaign !== null && campaign.at.node !== prevNode && member() ? `→ ${titleOf(campaign.at.node)}` : undefined;
    if (turn || moved) { menu.close(); toast(/** @type {string} */ (moved ?? turn)); }
    render();
  } else if (m.t === 'err') {
    const refusedPick = pendingPick;
    pendingPick = null;
    if (m.code === 'refused') toast("That can't be done right now.");
    else if (m.code === 'full' && round) toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} is back online on another phone.`);
    else if (m.code === 'full') showPickError(`Sorry, the game is full (${ROSTER_SIZE} players max).`);
    else if (m.code === 'taken') toast(`${refusedPick ? CHARACTERS[refusedPick].name : 'That character'} was just picked. Choose someone else!`);
    else if (m.code === 'bad-room') onBadRoom();
    else if (ERR_TOASTS[m.code]) toast(ERR_TOASTS[m.code]);
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

/** The tableau's settings: the campaign keeps them (null where no minigame is). @returns {any} */
const tableauSettings = () => campaign?.at.settings ?? null;

/** The party's host (a minigame stores none). */
const partyHost = () => campaign?.party.hostId ?? null;

/** The party host steers the evening (game-master panel). */
const isStory = () => campaign?.facts.flags.includes('story.elo-50') ?? false;
/** The room where the party is: what the joystick walks in and the object button looks around. */
const roomHere = () => roomAt(content(), campaign?.at.node);
const isGameMaster = () => campaign !== null && playerId !== null && campaign.party.hostId === playerId
  && !!member() && (!isStory() || campaign.facts.flags.includes('portal.entered'));

/** Walking: a member, between rounds (on the hub, in a world, in the room at a tableau). */
const canWalk = () => member() !== null && round === null
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

const VIEWS = ['loading', 'pick', 'room', 'replaced', 'waiting', 'wait-lobby', 'place', 'round', 'lobby', 'podium'];

/** Shows one screen; the running minigame's screens go whenever another one shows. @param {string} name */
function show(name) {
  if (name !== 'round') unmountScreen();
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

/** What the frame offers a minigame's screens. @type {import('./minigames.js').PhoneIo} */
const io = {
  send,
  meId: () => playerId ?? '',
  isHost: () => playerId !== null && partyHost() === playerId,
  online: () => online,
  connected: () => conn.isOnline(),
};

/** The screens of a round of `kind`, mounted in #view-round (kept while the kind stays). @param {string} kind */
function mountScreen(kind) {
  if (running?.kind !== kind) {
    unmountScreen();
    running = { kind, screen: /** @type {import('./minigames.js').PhoneScreen} */ (screenOf(kind)).mount($('view-round'), io) };
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
  const hostId = partyHost();
  const v = round?.kind === 'blocks' ? round.view : null;
  const q = round?.kind === 'quiz' ? round.view : null;
  // the tableau's minigame (null on the hub, in a world, at a scene) and the room between its rounds
  const kind = campaign?.at.kind ?? null;
  const inRoom = kind !== null && round === null;

  // the settings sheet follows the tableau's minigame: the block game's schema, or the quiz's; the host
  // changes them except while a round runs
  const configurable = kind !== null && mem !== null && hostId === playerId && round?.status !== 'running';
  if (kind) settingsSheet.render(tableauSettings(), configurable, kind === 'quiz' ? QUIZ_SETTINGS : undefined);
  hostControls.render(v, q, online, playerId ?? '', hostId);
  if (!configurable) menu.close('settings');
  if (campaign && isGameMaster()) gmPanel.render(campaign, round?.status ?? null);
  else menu.close('gm');
  // 🎒 my items (Contract F): they hang on my character, so they follow me to any phone
  bag.render(campaign && mem ? campaign.facts : null, mem ? myCharacter() : null);
  if (!mem) menu.close('bag');

  // walking stops where it is not allowed (a game under way): final moving:false
  if (!canWalk()) joystick.cancel();

  if (!mem) {
    if (roomPrompt) { show('room'); renderRoomPrompt(roomPrompt); return; }
    // the picker shows whenever there is something to tap: a free character while no block game is
    // under way, or (anytime) a character whose phone is offline, to continue as
    const joinable = round === null;
    const states = campaign ? pickStates(campaign.party, joinable, online) : null;
    if (!states || (!anyPickable(states) && pendingPick === null)) {
      show('waiting');
      $('waiting-text').textContent = round?.status === 'finished' && screenOf(round.kind)?.podium ? 'A game just ended.' : 'A game is already running.';
      return;
    }
    show('pick');
    const last = load(KEYS.character);
    picker.render(states, pendingPick, isCharacterId(last) ? last : null);
    return;
  }
  if (inRoom && campaign) { // the room at the tableau: walk, the settings, the host's Start
    const party = campaign.party;
    const here = { order: party.order.filter((id) => !party.players[id].left && party.players[id].character), players: party.players };
    show('lobby');
    renderLobby(here, mem, hostId === playerId, kind === 'quiz' ? summarizeQuiz(tableauSettings()) : summarize(tableauSettings()));
    return;
  }
  if (round && campaign) { // a round: the minigame's screens while it runs, then the podium
    const screens = /** @type {import('./minigames.js').PhoneScreen} */ (screenOf(round.kind));
    if (!playerId || !round.view.players[playerId]) { // in the evening, but this round started before we joined
      show('waiting');
      $('waiting-text').textContent = "A game is on. You'll play the next one!";
      return;
    }
    if (round.status === 'finished' && screens.podium) {
      if (running?.kind === round.kind) running.screen.update(round, campaign); // the screens see their round end
      show('podium');
      renderPodium(round, screens, playerId, hostId === playerId);
      return;
    }
    show('round');
    mountScreen(round.kind).update(round, campaign);
    return;
  }
  if (isStory() && campaign?.at.node === 'hub' && mem.character !== 'elodie'
    && !campaign.facts.flags.includes(`person.${mem.character}.unlocked`)) {
    show('wait-lobby'); dockStick('wait-lobby'); return;
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

/** Our character, or the colour slot's character for a pre-M3 player. @param {LobbyPlayer} p @returns {CharacterId} */
function characterOf(p) {
  if (isCharacterId(p.character)) return p.character;
  return /** @type {CharacterId} */ (Object.values(CHARACTERS).find((c) => c.color === p.color)?.id ?? 'pierre');
}

/** Our character, from the party. @returns {CharacterId | null} */
function myCharacter() {
  const m = member();
  return m && isCharacterId(m.character) ? m.character : null;
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
  const object = pos && (!inHub || character === 'elodie') ? nearbyObject(roomHere(), pos) : null;
  const button = /** @type {HTMLButtonElement} */ ($('btn-interact'));
  button.dataset.object = canCollect ? INTRO_KEY : object?.id ?? '';
  button.disabled = !(canCollect || object) || !conn.isOnline();
  button.textContent = canCollect ? '🗝️ Pick up key'
    : object ? OBJECT_ACTIONS[/** @type {keyof typeof OBJECT_ACTIONS} */ (object.id)].label : 'Walk to an object';
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
 * The room at a tableau, between rounds: who's here (the party), the settings, the host's Start.
 * @param {{ order: string[], players: Record<string, LobbyPlayer> }} v
 * @param {LobbyPlayer} me @param {boolean} isHost @param {string} settings the settings summary
 */
function renderLobby(v, me, isHost, settings) {
  dockStick('lobby');
  const header = $('lobby-me');
  header.replaceChildren(
    avatarCanvas(characterOf(me), LOBBY_ME_SCALE, currentPos(characterOf(me)).dir),
    Object.assign(document.createElement('span'), {
      className: 'lobby-me-name',
      textContent: `You're ${me.name}${me.id === partyHost() ? ' 👑' : ''}`,
    }),
  );

  const ul = $('lobby-players');
  ul.replaceChildren();
  for (const id of v.order) {
    const p = v.players[id];
    if (id === me.id || p.left) continue;
    const li = document.createElement('li');
    li.append(avatarCanvas(characterOf(p), LOBBY_CHIP_SCALE), document.createTextNode(
      p.name + (id === partyHost() ? ' 👑' : '')));
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

/**
 * The podium, the same for every minigame: the round's players ranked, with the minigame's extras (./minigames.js).
 * @param {RoundView} r @param {import('./minigames.js').PhoneScreen} screens @param {string} meId @param {boolean} isHost
 */
function renderPodium(r, screens, meId, isHost) {
  const v = /** @type {RoundPlayers} */ (r.view);
  const extras = screens.podium?.(r) ?? {};
  const portalReady = isStory() && campaign?.at.node === content().start && campaign.facts.flags.includes('portal.ready');
  const kicker = extras.kicker ?? (v.endReason ? ENDINGS[v.endReason] ?? '' : '');
  $('podium-kicker').hidden = kicker === '';
  $('podium-kicker').textContent = kicker;
  const ranked = ranking(v);
  const myRank = ranked.find((x) => x.id === meId)?.rank;
  $('podium-title').textContent = extras.title ?? (myRank !== 1 ? 'Podium'
    : ranked.filter((x) => x.rank === 1).length > 1 ? "It's a tie! 🎉" : 'You win! 🎉');
  const lines = $('podium-lines');
  lines.replaceChildren(...(extras.lines ?? []).map((text) => Object.assign(document.createElement('p'), { className: 'dim', textContent: text })));
  lines.hidden = lines.childElementCount === 0;

  const ol = $('podium-list');
  ol.replaceChildren();
  for (const { id, rank, score } of ranked) {
    const p = v.players[id];
    const li = document.createElement('li');
    if (rank === 1) li.className = 'champion'; // ties share rank 1: co-champions
    if (id === meId) li.classList.add('me');
    li.append(
      document.createTextNode(`${MEDALS[rank - 1] || `${rank}.`} `),
      dotEl(p.color),
      document.createTextNode(` ${p.name} — ${score}${extras.rowExtra?.(id) ?? ''}`),
    );
    ol.append(li);
  }
  $('podium-settings').textContent = portalReady ? 'Return to the room together.'
    : `Next game: ${r.kind === 'quiz' ? summarizeQuiz(tableauSettings()) : summarize(tableauSettings())}`;
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
const bag = createBag();
const social = createSocial({
  send,
  canSend: () => member() !== null && conn.isOnline(),
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
  const object = character ? nearbyObject(roomHere(), currentPos(character)) : null;
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

installBackGuard({ onBack });
onContentChange(render); // titles, doors and the tree come with the content
show('loading');
conn.start();
