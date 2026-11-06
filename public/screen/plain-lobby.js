// The plain lobby's TV screen (shared/plain-lobby.js): a building block that wraps a minigame's round screen
// into the screen of a running minigame. The frame mounts it in #app from the minigame's start to its end
// (./minigames.js). It draws the lobby (the eligible players standing, who is ready, the settings, the last
// round's winner and what Start waits for), the round screen while a round runs (mounted inside, with the same
// update and message as before), and the shared podium (./podium-view.js) with its reveal, sounds and confetti.
import { h, colorDot, addStylesheet } from './dom.js';
import { renderPodium, podiumSequence } from './podium-view.js';
import { sfx } from './audio.js';
import * as fx from './fx.js';
import { avatarCanvas } from '../commun/avatar.js';
import { CHARACTERS } from '../../shared/characters.js';
import { readyRuleMet } from '../../shared/campaign/index.js';

/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').RoundPlayers} RoundPlayers */
/** @typedef {import('../../shared/plain-lobby.js').PlainLobbyState} PlainLobbyState */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** The plain lobby's view (server/plain-lobby.ts): its state, with `round` as the round server's view. @typedef {Omit<PlainLobbyState, 'seed'>} PlainLobbyView */

const AVATAR_SCALE = 10; // a standing player in the lobby: 160 px at 1080p

addStylesheet(new URL('./plain-lobby.css', import.meta.url));

/** "block game" → "Block game". @param {string} name */
const capitalized = (name) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * A minigame's TV screen: its round screen in a plain lobby.
 * @param {import('./minigames.js').RoundScreen} roundScreen
 * @returns {import('./minigames.js').TvScreen}
 */
export function plainLobbyScreen(roundScreen) {
  return {
    title: roundScreen.title,
    name: roundScreen.name,
    mount(root, io) {
      /** The round screen mounted while a round runs. @type {import('./minigames.js').RoundMounted | null} */
      let round = null;
      /** The stage last drawn, and how many were ready then (a newly ready player gets a sound). */
      let lastStage = /** @type {PlainLobbyView['stage'] | null} */ (null);
      let lastReady = 0;
      /** performance.now() when the shown podium's reveal starts (-Infinity: settled, shown without animation). */
      let finishedAt = -Infinity;
      /** The podium's pending sounds and confetti: cancelled as soon as it goes. */
      const timers = new Set();
      /** @param {() => void} fn @param {number} ms */
      const later = (fn, ms) => {
        const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
        timers.add(id);
      };
      const cancelPodium = () => { for (const id of timers) clearTimeout(id); timers.clear(); };

      /** @param {MinigameView} m @param {PlainLobbyView} v @returns {RoundView} the round as its screen sees it */
      const roundView = (m, v) => ({ kind: m.kind, status: v.stage === 'running' ? 'running' : 'finished', view: v.round });

      function unmountRound() {
        const r = round;
        round = null;
        r?.unmount();
      }

      /** @param {MinigameView} m @param {PlainLobbyView} v @param {Campaign} c */
      function drawPodium(m, v, c) {
        const r = roundView(m, v);
        const extras = roundScreen.podium?.(r) ?? {};
        if (round) { // the round ends on this TV: the screen plays its end, then the podium reveals
          round.update(r, c);
          unmountRound();
          cancelPodium();
          if (io.continuous() && lastStage === 'running') {
            const delay = extras.delayMs ?? 0;
            finishedAt = performance.now() + delay;
            later(() => podiumSequence(/** @type {RoundPlayers} */ (v.round), later), delay);
          } else finishedAt = -Infinity;
        } else if (lastStage !== 'podium') finishedAt = -Infinity; // arrived on a finished podium: settled
        const podium = renderPodium(/** @type {RoundPlayers} */ (v.round), performance.now() - finishedAt, {
          title: extras.title, rowExtra: extras.rowExtra,
          hint: `Back to the lobby on ${io.gameMasterName()}'s phone`,
        });
        podium.append(...(extras.lines ?? []));
        root.replaceChildren(podium);
      }

      /** @param {MinigameView} m @param {PlainLobbyView} v @param {Campaign} c */
      function drawLobby(m, v, c) {
        unmountRound();
        if (lastStage === 'podium') { cancelPodium(); fx.clearAll(); }
        if (lastStage === 'lobby' && v.ready.length > lastReady && io.continuous()) sfx.joined();
        const players = h('div', 'minigame-lobby-players', v.players.map(({ id, character }) => {
          const ready = v.ready.includes(id);
          const figure = h('figure', ready ? 'is-ready' : '', [
            avatarCanvas(character, AVATAR_SCALE),
            h('figcaption', '', [
              h('span', 'minigame-lobby-name', [colorDot(CHARACTERS[character].color), ` ${CHARACTERS[character].name}`]),
              h('span', 'minigame-lobby-ready', [ready ? '✓ ready' : 'not ready']),
            ]),
          ]);
          figure.dataset.id = id;
          return figure;
        }));
        const summary = roundScreen.settings.summarize(v.settings);
        const winners = lastWinners(c);
        const panel = h('aside', 'minigame-lobby-panel', winners
          ? [h('h2', '', ['Last game']), h('p', 'minigame-lobby-big', [`🥇 ${winners}`]), h('p', 'minigame-lobby-dim', [summary])]
          : [h('h2', '', ['Settings']), h('p', 'minigame-lobby-big', [summary])]);
        panel.append(h('p', 'minigame-lobby-dim minigame-lobby-status', [startLine(m, v, io.gameMasterName())]));
        root.replaceChildren(h('section', 'minigame-lobby', [
          h('h1', 'minigame-lobby-title', [capitalized(roundScreen.name)]),
          h('div', 'minigame-lobby-body', [players, panel]),
        ]));
      }

      return {
        update(m, c) {
          const v = /** @type {PlainLobbyView} */ (m.view);
          if (v.stage === 'running' && v.round) {
            if (!round) {
              cancelPodium();
              root.replaceChildren();
              round = roundScreen.mount(root, io);
            }
            round.update(roundView(m, v), c);
          } else if (v.stage === 'podium' && v.round) drawPodium(m, v, c);
          else drawLobby(m, v, c);
          lastStage = v.stage;
          lastReady = v.ready.length;
        },
        message(msg) {
          round?.message(msg);
        },
        unmount() {
          unmountRound();
          cancelPodium();
          fx.clearAll();
          root.replaceChildren();
        },
      };
    },
  };
}

/** @param {CharacterId[]} characters @returns {string} "Sol and Anna" */
function names(characters) {
  const list = characters.map((ch) => CHARACTERS[ch].name);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list.join('');
}

/** The last finished round's winners, by name ('' before the first). @param {Campaign} c */
function lastWinners(c) {
  const result = c.at.results[c.at.results.length - 1];
  return result ? names(result.ranking.filter((r) => r.rank === 1).map((r) => r.character)) : '';
}

/**
 * What the game master's Start waits for: the content's ready rule (the main game's) and the plain lobby's own,
 * one ready player or more.
 * @param {MinigameView} m @param {PlainLobbyView} v @param {string} gm the game master's name
 */
function startLine(m, v, gm) {
  const count = `(${v.ready.length}/${v.players.length})`;
  const missing = (m.required.eligible ?? []).filter((ch) => !v.players.some((p) => p.character === ch));
  if (m.required.allReady && missing.length) return `Waiting for ${names(missing)} to join`;
  if (v.ready.length >= 1 && readyRuleMet(m.required, v.players, v.ready)) return `${gm} can start ${count}`;
  if (m.required.allReady) return `${gm} starts when all ${v.players.length} are ready ${count}`;
  return `${gm} starts when someone is ready`;
}
