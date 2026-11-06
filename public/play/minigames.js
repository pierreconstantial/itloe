// The phone's minigame screens: one entry per minigame, by kind (shared/minigames.js). Adding a minigame is
// one import line and one entry here. The frame (main.js) mounts an entry's screens into its root from the
// minigame's start to its end. Blocks, quiz, Pyramide and backgammon wrap their round screens in the plain lobby (./plain-lobby.js).
import { BLOCK_SCREEN } from './blocks-ui.js';
import { QUIZ_SCREEN } from './quiz-ui.js';
import { plainLobbyScreen } from './plain-lobby.js';
import { PYRAMIDE_SCREEN } from './pyramide-ui.js';
import { BACKGAMMON_SCREEN } from './backgammon-ui.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/minigames.js').MinigameKind} MinigameKind */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */

/**
 * What the frame offers a minigame's phone screens.
 * @typedef {{
 *   send: (msg: unknown) => void,   // a plain message to the server (PROTOCOL.md)
 *   meId: () => string,             // this phone's player
 *   isGameMaster: () => boolean,    // is this phone the game master's?
 *   gameMasterName: () => string,   // the game master's name, for the hints
 *   online: () => readonly string[],  // players with a live socket
 *   connected: () => boolean,       // is this phone's socket up? (the frame calls update when it changes)
 * }} PhoneIo
 */

/**
 * A minigame's screens, mounted. `update`: every view while the minigame runs, and on connection changes;
 * `message`: the server's messages for the running minigame (an `err` refusing this phone's message, an
 * `unsaved` from its server code: PROTOCOL.md);
 * `unmount`: removes the screens' markup, listeners, loops, sounds and timers.
 * @typedef {{ update: (minigame: MinigameView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} Mounted
 */

/**
 * A minigame's round screens, mounted by its lobby while a round runs: the same, with the round.
 * @typedef {{ update: (round: RoundView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} RoundMounted
 */

/**
 * What a minigame adds to the shared podium (./podium.js): a title in place of the frame's (win, tie, Podium), a kicker in
 * place of the ending's, lines under the title, and text after each player's score.
 * @typedef {{ title?: string, kicker?: string, lines?: string[], rowExtra?: (id: string) => string }} PodiumExtras
 */

/**
 * One minigame's phone screens. `title`: its heading in "How to play"; `name`: the minigame in a sentence,
 * lower case ("block game": "▶ Start the block game"); `rules`: its lines in "How to play", each with an
 * illustration; `mount`: builds its screens inside `root` (CSS scoped under them, nothing added to index.html).
 * @typedef {{
 *   title: string,
 *   name: string,
 *   rules?: { icon: () => Node, text: string }[],
 *   mount: (root: HTMLElement, io: PhoneIo) => Mounted,
 * }} PhoneScreen
 */

/**
 * One minigame's round screens, for a lobby to wrap (./plain-lobby.js): a phone entry's fields, plus `settings`:
 * its settings schema and wording, for the settings sheet and summaries; `mount`: its running screens; `podium`:
 * its extras on the shared podium.
 * @typedef {Omit<PhoneScreen, 'mount'> & {
 *   settings: import('./settings-ui.js').SettingsKind,
 *   mount: (root: HTMLElement, io: PhoneIo) => RoundMounted,
 *   podium?: (round: RoundView) => PodiumExtras,
 * }} RoundScreen
 */

/** @type {Record<MinigameKind, PhoneScreen>} */
export const SCREENS = {
  blocks: plainLobbyScreen(BLOCK_SCREEN),
  quiz: plainLobbyScreen(QUIZ_SCREEN),
  pyramide: plainLobbyScreen(PYRAMIDE_SCREEN),
  backgammon: plainLobbyScreen(BACKGAMMON_SCREEN),
};

/** A minigame's phone screens, or null (none registered). @param {string | null | undefined} kind @returns {PhoneScreen | null} */
export const screenOf = (kind) => (typeof kind === 'string' && Object.hasOwn(SCREENS, kind) ? SCREENS[/** @type {MinigameKind} */ (kind)] : null);
