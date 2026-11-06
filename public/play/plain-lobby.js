// The plain lobby's phone screens (shared/plain-lobby.js): a building block that wraps a minigame's round
// screens into the screens of a running minigame. The frame mounts them from the minigame's start to its end
// (./minigames.js). They draw the lobby (the eligible players and who is ready, "I'm ready", the game
// master's settings, Start and the end of the minigame, the last round's winner), the round screens while a
// round runs (mounted inside, with the same update and message as before), and the shared podium (./podium.js)
// with the game master's "Back to the lobby". The frame mounts them for the players the minigame shows, and
// for the game master; everyone else floats over it as a wisp. The round controls in ☰ follow the running round.
import { $, addStylesheet, dotEl } from './dom.js';
import { createConfirm } from './confirm.js';
import { createSettingsSheet } from './settings-ui.js';
import { createRoundControls } from './round-controls.js';
import { renderPodium } from './podium.js';
import { CHARACTERS } from '../../shared/characters.js';
import { readyRuleMet } from '../../shared/campaign/index.js';

/** @typedef {import('../../shared/minigames.js').MinigameView} MinigameView */
/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/plain-lobby.js').PlainLobbyState} PlainLobbyState */
/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** The plain lobby's view (server/plain-lobby.ts): its state, with `round` as the round server's view. @typedef {Omit<PlainLobbyState, 'seed'>} PlainLobbyView */

addStylesheet(new URL('./plain-lobby.css', import.meta.url));

const MARKUP = `
  <section id="view-minigame-lobby" class="menu minigame-lobby" hidden>
    <h2 id="minigame-lobby-title"></h2>
    <button id="btn-ready" type="button" hidden></button>
    <p id="minigame-lobby-settings" class="settings-summary"></p>
    <p id="minigame-lobby-last" hidden></p>
    <ul id="minigame-lobby-players" class="player-list minigame-lobby-players"></ul>
    <div id="minigame-lobby-gm" class="lobby-actions" hidden>
      <button id="btn-settings-lobby" type="button" data-open="settings">⚙ Settings</button>
      <button id="btn-start" type="button" class="primary"></button>
      <button id="btn-end-minigame" type="button" class="danger"></button>
    </div>
    <p id="minigame-lobby-hint" class="dim"></p>
  </section>
  <div id="minigame-round" class="minigame-round"></div>
  <section id="view-podium" class="menu" hidden>
    <div id="podium-body" class="podium-body"></div>
    <button id="btn-back-to-lobby" type="button" class="primary" hidden>Back to the lobby</button>
    <p id="podium-hint" class="dim"></p>
  </section>
`;

/** "block game" → "Block game". @param {string} name */
const capitalized = (name) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * A minigame's phone screens: its round screens in a plain lobby.
 * @param {import('./minigames.js').RoundScreen} roundScreen
 * @returns {import('./minigames.js').PhoneScreen}
 */
export function plainLobbyScreen(roundScreen) {
  return {
    title: roundScreen.title,
    name: roundScreen.name,
    rules: roundScreen.rules,
    mount(root, io) {
      root.insertAdjacentHTML('beforeend', MARKUP);
      const roundRoot = $('minigame-round');
      const settingsSheet = createSettingsSheet({ send: io.send });
      const roundControls = createRoundControls({ send: io.send });
      const confirm = createConfirm(() => { if (last) draw(last.minigame, last.campaign); });
      /** The round screens mounted while a round runs. @type {import('./minigames.js').RoundMounted | null} */
      let round = null;
      /** @type {{ minigame: MinigameView, campaign: Campaign } | null} */
      let last = null;

      $('btn-ready').addEventListener('click', () => {
        const v = /** @type {PlainLobbyView | undefined} */ (last?.minigame.view);
        if (v) io.send({ t: 'ready', on: !v.ready.includes(io.meId()) });
      });
      $('btn-start').addEventListener('click', () => io.send({ t: 'start' }));
      $('btn-end-minigame').addEventListener('click', () => confirm.tap('end', () => io.send({ t: 'endMinigame' })));
      $('btn-back-to-lobby').addEventListener('click', () => io.send({ t: 'lobby' }));

      /** @param {PlainLobbyView} v @returns {RoundView} the round as its screens see it */
      const roundView = (v) => ({ kind: last?.minigame.kind ?? /** @type {any} */ (''), status: v.stage === 'running' ? 'running' : 'finished', view: v.round });

      function unmountRound() {
        const r = round;
        round = null;
        r?.unmount();
      }

      /** @param {'lobby' | 'round' | 'podium'} which */
      function showOnly(which) {
        $('view-minigame-lobby').hidden = which !== 'lobby';
        roundRoot.hidden = which !== 'round';
        $('view-podium').hidden = which !== 'podium';
      }

      /** @param {MinigameView} m @param {Campaign} c */
      function draw(m, c) {
        const v = /** @type {PlainLobbyView} */ (m.view);
        const isGm = io.isGameMaster();
        roundControls.render(v.stage === 'running' && v.round ? roundView(v) : null, io.online(), isGm);
        settingsSheet.render(v.settings, isGm && v.stage === 'lobby', roundScreen.settings);
        if (v.stage === 'running' && v.round) {
          if (!round) round = roundScreen.mount(roundRoot, io);
          showOnly('round');
          round.update(roundView(v), c);
          return;
        }
        if (v.stage === 'podium' && v.round) {
          if (round) { round.update(roundView(v), c); unmountRound(); } // the round screens see their round end
          showOnly('podium');
          drawPodium(v, isGm);
          return;
        }
        unmountRound();
        showOnly('lobby');
        drawLobby(m, v, c, isGm);
      }

      /** @param {PlainLobbyView} v @param {boolean} isGm */
      function drawPodium(v, isGm) {
        const r = roundView(v);
        $('podium-body').replaceChildren(...renderPodium(r, roundScreen.podium?.(r) ?? {}, io.meId()));
        $('btn-back-to-lobby').hidden = !isGm;
        $('podium-hint').hidden = isGm;
        $('podium-hint').textContent = `Waiting for ${io.gameMasterName()} to go back to the lobby…`;
      }

      /** @param {MinigameView} m @param {PlainLobbyView} v @param {Campaign} c @param {boolean} isGm */
      function drawLobby(m, v, c, isGm) {
        const me = io.meId();
        const online = new Set(io.online());
        const eligible = v.players.some((p) => p.id === me);
        const isReady = v.ready.includes(me);
        $('minigame-lobby-title').textContent = capitalized(roundScreen.name);

        const ready = /** @type {HTMLButtonElement} */ ($('btn-ready'));
        ready.hidden = !eligible;
        ready.className = isReady ? 'on' : 'primary';
        ready.textContent = isReady ? "✓ I'm ready" : "I'm ready";
        ready.disabled = !io.connected();

        $('minigame-lobby-settings').textContent = roundScreen.settings.summarize(v.settings);
        const winners = lastWinners(c);
        $('minigame-lobby-last').hidden = winners === '';
        $('minigame-lobby-last').textContent = `Last game: 🥇 ${winners}`;

        $('minigame-lobby-players').replaceChildren(...v.players.map(({ id, character }) => {
          const li = document.createElement('li');
          li.dataset.id = id;
          li.classList.toggle('offline', !online.has(id));
          const status = Object.assign(document.createElement('small'), {
            className: v.ready.includes(id) ? 'is-ready' : 'dim',
            textContent: v.ready.includes(id) ? '✓ ready' : 'not ready',
          });
          li.append(dotEl(CHARACTERS[character].color), document.createTextNode(` ${CHARACTERS[character].name}`), status);
          return li;
        }));

        // the content's ready rule (the main game's) and the plain lobby's own: one ready player or more
        const canStart = v.ready.length >= 1 && readyRuleMet(m.required, v.players, v.ready);
        $('minigame-lobby-gm').hidden = !isGm;
        const start = /** @type {HTMLButtonElement} */ ($('btn-start'));
        start.textContent = `▶ ${c.at.results.length ? 'Play again' : 'Start'} (${v.ready.length}/${v.players.length} ready)`;
        start.disabled = !canStart;
        $('btn-end-minigame').textContent = confirm.isArmed('end') ? `Tap again to end the ${roundScreen.name}` : `End the ${roundScreen.name}`;
        if (!isGm) confirm.disarm();

        const missing = (m.required.eligible ?? []).filter((ch) => !v.players.some((p) => p.character === ch));
        $('minigame-lobby-hint').textContent = !isGm ? `${io.gameMasterName()} starts the game.`
          : canStart ? ''
            : m.required.allReady && missing.length ? `Waiting for ${names(missing)} to join.`
              : m.required.allReady ? 'Everyone must be ready to start.'
                : 'Waiting for someone to be ready.';
      }

      return {
        update(m, c) {
          last = { minigame: m, campaign: c };
          draw(m, c);
        },
        message(msg) {
          round?.message(msg);
        },
        unmount() {
          confirm.disarm();
          unmountRound();
          roundControls.render(null, [], false);
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
