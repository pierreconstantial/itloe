// The phone's running screens: one entry per minigame, by kind (shared/minigames.js). Adding a minigame is
// one import line and one entry here. The frame (main.js) mounts an entry's screens into its root while a
// round of that kind runs, and replaces them with its own screens when the round ends.
import { BLOCK_SCREEN } from './blocks-ui.js';
import { QUIZ_SCREEN } from './quiz-ui.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */

/**
 * What the frame offers a minigame's phone screens. `joystick`: walking our avatar in the minigame's game
 * area (a shared/scene.js scene without furniture) from `start`, with the frame's stick placed at the end of
 * the screens' root, and no object button; null switches it off, and so does unmount. Our position there goes
 * to the server as `pos` (the start at once, so the TVs place the avatar); the server keeps it only for the
 * players the minigame's server code lets walk, apart from our position in the room, which waits for us.
 * @typedef {{
 *   send: (msg: unknown) => void,   // a plain message to the server (PROTOCOL.md)
 *   meId: () => string,             // this phone's player
 *   isHost: () => boolean,          // is this phone the party's host?
 *   online: () => readonly string[],  // players with a live socket
 *   connected: () => boolean,       // is this phone's socket up? (the frame calls update when it changes)
 *   joystick: (on: { area: import('../../shared/scene.js').Scene, start: { x: number, y: number, dir?: import('../../shared/world.js').Dir } } | null) => void,
 * }} PhoneIo
 */

/**
 * A minigame's screens, mounted. `update`: every view while they show, and on connection changes;
 * `message`: the server's messages for the running round (an `err` refusing this phone's message, an `unsaved`
 * from its server code: PROTOCOL.md);
 * `unmount`: removes the screens' markup, listeners, loops, sounds and timers.
 * @typedef {{ update: (round: RoundView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} Mounted
 */

/**
 * What a minigame adds to the frame's podium: a title in place of the frame's (win, tie, Podium), a kicker in
 * place of the ending's, lines under the title, and text after each player's score.
 * @typedef {{ title?: string, kicker?: string, lines?: string[], rowExtra?: (id: string) => string }} PodiumExtras
 */

/**
 * One minigame's phone screens. `title`: the minigame's name; `settings`: its settings schema and wording, for
 * the frame's settings sheet and summaries; `rules`: its lines in "How to play", each with an illustration;
 * `mount`: builds its screens inside `root` (CSS scoped under them, nothing added to index.html); `podium`:
 * its extras on the frame's podium.
 * @typedef {{
 *   title: string,
 *   settings: import('./settings-ui.js').SettingsKind,
 *   rules?: { icon: () => Node, text: string }[],
 *   mount: (root: HTMLElement, io: PhoneIo) => Mounted,
 *   podium?: (round: RoundView) => PodiumExtras,
 * }} PhoneScreen
 */

/** @type {Record<string, PhoneScreen>} */
export const SCREENS = {
  blocks: BLOCK_SCREEN,
  quiz: QUIZ_SCREEN,
};

/** A minigame's phone screens, or null (none registered). @param {string | null | undefined} kind @returns {PhoneScreen | null} */
export const screenOf = (kind) => (typeof kind === 'string' && Object.hasOwn(SCREENS, kind) ? SCREENS[kind] : null);
