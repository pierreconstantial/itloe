// The plain lobby's TV screen (shared/plain-lobby.js): a building block that wraps a minigame's round screen
// into the screen of a running minigame. The frame mounts it in #app from the minigame's start to its end
// (./minigames.js). It draws the lobby (a panel with the settings or the last round's winner, who is ready and
// what Start waits for; in a lobby with spots, the spots instead of who is ready; the frame draws the eligible
// players walking over it), the round screen while a round runs (mounted inside, with the same update and message
// as before), and the shared podium (./podium-view.js) with its reveal, sounds and confetti.
import { h, colorDot, addStylesheet, worldBox, placeInWorld } from './dom.js';
import { renderPodium, podiumSequence } from './podium-view.js';
import { sfx } from './audio.js';
import * as fx from './fx.js';
import { resetScores } from './score-ticker.js';
import { CHARACTERS } from '../../shared/characters.js';
import { readyRuleMet } from '../../shared/campaign/index.js';

/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').RoundPlayers} RoundPlayers */
/** @typedef {import('../../shared/plain-lobby.js').PlainLobbyState} PlainLobbyState */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** The plain lobby's view (server/plain-lobby.ts): its state, with `round` as the round server's view. @typedef {Omit<PlainLobbyState, 'seed'>} PlainLobbyView */

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
        // the frame draws the players walking over the lobby; a lobby with spots draws them under the walkers
        const spots = m.spots?.length ? m.spots : null;
        const summary = roundScreen.settings.summarize(v.settings);
        const winners = lastWinners(c);
        const panel = h('aside', 'minigame-lobby-panel', winners
          ? [h('h2', '', ['Last game']), h('p', 'minigame-lobby-big', [`🥇 ${winners}`]), h('p', 'minigame-lobby-dim', [summary])]
          : [h('h2', '', ['Settings']), h('p', 'minigame-lobby-big', [summary])]);
        if (!spots) panel.append(h('ul', 'minigame-lobby-players', v.players.map(({ id, character }) => {
          const ready = v.ready.includes(id);
          const li = h('li', ready ? 'is-ready' : '', [
            h('span', 'minigame-lobby-name', [colorDot(CHARACTERS[character].color), ` ${CHARACTERS[character].name}`]),
            h('span', 'minigame-lobby-ready', [ready ? '✓ ready' : 'not ready']),
          ]);
          li.dataset.id = id;
          return li;
        })));
        panel.append(h('p', 'minigame-lobby-dim minigame-lobby-status', [startLine(m, spots, v, io.gameMasterName())]));
        if (spots) panel.append(h('p', 'minigame-lobby-dim', ['Walk onto a spot to take your place, or tap it on your phone']));
        const lobby = h('section', 'minigame-lobby', [
          h('h1', 'minigame-lobby-title', [capitalized(roundScreen.name)]),
          h('div', `minigame-lobby-body${spots ? ' has-spots' : ''}`, spots ? [panel, spotsBoard(spots, v)] : [panel]),
        ]);
        lobby.dataset.kind = m.kind;
        root.replaceChildren(lobby);
      }

      return {
        update(m, c) {
          const v = /** @type {PlainLobbyView} */ (m.view);
          if (v.stage === 'running' && v.round) {
            if (!round) {
              cancelPodium();
              root.replaceChildren();
              resetScores(); // a round's scores count from 0, not from the last round's
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
 * A walkable lobby's spots in the world's projection, with who holds each. The characters walking onto them are
 * the frame's, drawn over the screen: only the spots are drawn here.
 * @param {NonNullable<MinigameView['spots']>} spots @param {PlainLobbyView} v
 */
function spotsBoard(spots, v) {
  const board = worldBox('minigame-lobby-spots');
  for (const spot of spots) {
    const holder = v.players.find((p) => p.id === spot.holder);
    const el = h('div', `minigame-lobby-spot${holder ? ' is-taken' : ''}`, [
      h('div', 'minigame-lobby-spot-caption', [
        h('span', 'minigame-lobby-spot-label', [spot.label]),
        h('span', 'minigame-lobby-spot-holder', [holder ? CHARACTERS[holder.character].name : 'free']),
      ]),
    ]);
    el.dataset.spot = spot.id;
    placeInWorld(el, spot);
    board.append(el);
  }
  return board;
}

/**
 * What the game master's Start waits for: the content's ready rule (the main game's) and the plain lobby's own,
 * one ready player or more.
 * @param {MinigameView} m @param {MinigameView['spots']} spots a lobby's spots, null without
 * @param {PlainLobbyView} v @param {string} gm the game master's name
 */
function startLine(m, spots, v, gm) {
  if (spots) { // a lobby with spots: ready is holding one
    const taken = spots.filter((s) => s.holder).length;
    return taken === spots.length ? `${gm} can start` : `${gm} starts when every spot is taken (${taken}/${spots.length})`;
  }
  const count = `(${v.ready.length}/${v.players.length})`;
  const missing = (m.required.eligible ?? []).filter((ch) => !v.players.some((p) => p.character === ch));
  if (m.required.allReady && missing.length) return `Waiting for ${names(missing)} to join`;
  if (v.ready.length >= 1 && readyRuleMet(m.required, v.players, v.ready)) return `${gm} can start ${count}`;
  if (m.required.allReady) return `${gm} starts when all ${v.players.length} are ready ${count}`;
  return `${gm} starts when someone is ready`;
}
