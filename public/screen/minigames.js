// The TV's running screens: one entry per minigame, by kind (shared/minigames.js). Adding a minigame is one
// import line and one entry here. The frame (main.js) mounts an entry's screen into #app while a round of
// that kind runs, and draws its own podium when the round ends.
import { BLOCK_SCREEN } from './blocks-screen.js';
import { QUIZ_SCREEN } from './quiz-screen.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').MinigameKind} MinigameKind */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {ReturnType<typeof import('./avatar-layer.js').createAvatarLayer>} AvatarLayer */

/**
 * What the frame offers a minigame's TV screen. `continuous`: this view directly follows the last one the
 * TV showed — false after a page load or a reconnect, when what happened in between is not replayed (no
 * sounds for missed events). The first view of a round is continuous when the TV watched it start.
 * `avatars`: the players' avatars (./avatar-layer.js), whose `pos` the TV gets whatever screen shows; a
 * screen with a game area steps them from its loop (`update`), draws them on top of its canvas with the
 * players it names (`draw(g, view, alpha, now, area, {}, ids)`), and can show a bubble or an emote over
 * one (`say`, `emote`, e.g. from its unsaved message). `worldView`: the world-to-screen projection for its
 * canvas (the 16 × 9 world, letterboxed): what the avatars line up with is placed in world coordinates.
 * @typedef {{
 *   continuous: () => boolean,
 *   avatars: Pick<AvatarLayer, 'update' | 'draw' | 'say' | 'emote'>,
 *   worldView: typeof import('./avatar-layer.js').worldView,
 * }} TvIo
 */

/**
 * A minigame's screen, mounted. `update`: every view while it shows, and the view that ends its round,
 * just before the frame's podium replaces it; `message`: the server's messages for the running round (`unsaved`, from its server code: PROTOCOL.md);
 * `unmount`: removes the screen's markup, listeners, loops, sounds and timers.
 * @typedef {{ update: (round: RoundView, campaign: Campaign) => void, message: (msg: any) => void, unmount: () => void }} Mounted
 */

/**
 * What a minigame adds to the frame's podium: a title in place of "Podium", cells after each player's
 * score, lines under the podium, and how long its end holds the screen before the reveal starts.
 * @typedef {{ title?: string, rowExtra?: (id: string) => (Node | string)[], lines?: Node[], delayMs?: number }} PodiumExtras
 */

/**
 * One minigame's TV screen. `title`: the band of the room at its tableaux; `settings.summarize`: the
 * tableau's settings in one line (the band, the podium's "Next game"); `mount`: builds its screen inside
 * `root` (CSS scoped under it); `podium`: its extras on the frame's podium.
 * @typedef {{
 *   title: string,
 *   settings: { summarize: (settings: any) => string },
 *   mount: (root: HTMLElement, io: TvIo) => Mounted,
 *   podium?: (round: RoundView) => PodiumExtras,
 * }} TvScreen
 */

/** @type {Record<MinigameKind, TvScreen>} */
export const SCREENS = {
  blocks: BLOCK_SCREEN,
  quiz: QUIZ_SCREEN,
};

/** A minigame's TV screen, or null (none registered). @param {string | null | undefined} kind @returns {TvScreen | null} */
export const screenOf = (kind) => (typeof kind === 'string' && Object.hasOwn(SCREENS, kind) ? SCREENS[/** @type {MinigameKind} */ (kind)] : null);
