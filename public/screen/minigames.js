// The TV's minigame screens: one entry per minigame, by kind (shared/minigames.js). Adding a minigame is one
// import line and one entry here. The frame (main.js) mounts an entry's screen into #app from the minigame's
// start to its end. Blocks, quiz, Pyramide and backgammon wrap their round screens in the plain lobby (./plain-lobby.js).
import { BLOCK_SCREEN } from './blocks-screen.js';
import { QUIZ_SCREEN } from './quiz-screen.js';
import { PYRAMIDE_SCREEN } from './pyramide-screen.js';
import { BACKGAMMON_SCREEN } from './backgammon-screen.js';
import { plainLobbyScreen } from './plain-lobby.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/minigames.js').MinigameKind} MinigameKind */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */

/**
 * What the frame offers a minigame's TV screen. `continuous`: this view directly follows the last one the
 * TV showed — false after a page load or a reconnect, when what happened in between is not replayed (no
 * sounds for missed events). The first view of a round is continuous when the TV watched it start.
 * `gameMasterName`: the game master's name, for the hints.
 * @typedef {{
 *   continuous: () => boolean,
 *   gameMasterName: () => string,
 * }} TvIo
 */

/**
 * A minigame's screen, mounted. `update`: every view while the minigame runs; `message`: the server's messages
 * for it (`unsaved`, from its server code: PROTOCOL.md);
 * `unmount`: removes the screen's markup, listeners, loops, sounds and timers.
 * @typedef {{ update: (minigame: MinigameView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} Mounted
 */

/**
 * A minigame's round screen, mounted by its lobby while a round runs: the same, with the round, and the
 * view that ends it, just before the podium replaces it.
 * @typedef {{ update: (round: RoundView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} RoundMounted
 */

/**
 * What a minigame adds to the shared podium (./podium-view.js): a title in place of "Podium", cells after each player's
 * score, lines under the podium, and how long its end holds the screen before the reveal starts.
 * @typedef {{ title?: string, rowExtra?: (id: string) => (Node | string)[], lines?: Node[], delayMs?: number }} PodiumExtras
 */

/**
 * One minigame's TV screen. `title`: the band of the room at its tableaux; `name`: the minigame in a sentence,
 * lower case ("block game"); `mount`: builds its screen inside `root` (CSS scoped under it).
 * @typedef {{
 *   title: string,
 *   name: string,
 *   mount: (root: HTMLElement, io: TvIo) => Mounted,
 * }} TvScreen
 */

/**
 * One minigame's round screen, for a lobby to wrap (./plain-lobby.js): a TV entry's fields, plus
 * `settings.summarize`: its settings in one line; `mount`: its running screen; `podium`: its extras on the
 * shared podium.
 * @typedef {Omit<TvScreen, 'mount'> & {
 *   settings: { summarize: (settings: any) => string },
 *   mount: (root: HTMLElement, io: TvIo) => RoundMounted,
 *   podium?: (round: RoundView) => PodiumExtras,
 * }} RoundScreen
 */

/** @type {Record<MinigameKind, TvScreen>} */
export const SCREENS = {
  blocks: plainLobbyScreen(BLOCK_SCREEN),
  quiz: plainLobbyScreen(QUIZ_SCREEN),
  pyramide: plainLobbyScreen(PYRAMIDE_SCREEN),
  backgammon: plainLobbyScreen(BACKGAMMON_SCREEN),
};

/** A minigame's TV screen, or null (none registered). @param {string | null | undefined} kind @returns {TvScreen | null} */
export const screenOf = (kind) => (typeof kind === 'string' && Object.hasOwn(SCREENS, kind) ? SCREENS[/** @type {MinigameKind} */ (kind)] : null);
