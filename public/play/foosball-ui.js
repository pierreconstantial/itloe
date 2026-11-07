// Table football's phone screens (shared/foosball.js), mounted by the plain lobby (./plain-lobby.js) while a match
// runs. The phone draws no table: the players watch the TV. A player gets the strip, where their finger's height is
// their rods' position, and the power button beside it. The phone sends both (`rod`) as they change, at most
// SEND_HZ times a second, and every HEARTBEAT_MS anyway; each `rod` is numbered, and the time until the TV's
// snapshots carry that number back is this phone's lag, shown here and sent along for the TV's readout.
import { addStylesheet } from './dom.js';
import * as haptics from './haptics.js';
import { FOOSBALL_SETTINGS_SCHEMA, ROLES, TEAM_COLORS, TEAM_NAMES, forfeitLine, holders, summarizeFoosballSettings, winner } from '../../shared/foosball.js';

/** The round's view: its state without the seed (server/foosball.ts). @typedef {Omit<import('../../shared/foosball.js').FoosballState, 'seed'>} View */

addStylesheet(new URL('./foosball.css', import.meta.url));

const SEND_HZ = 15;
const HEARTBEAT_MS = 500;
/** The lag shown is over this long. */
const LAG_WINDOW_MS = 10000;

/** @param {string} tag @param {string} [cls] @param {(Node | string)[]} [children] */
function el(tag, cls, children = []) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
}

/** The roles a player holds, in words ("Goalie + defence"). @param {View} s @param {string} id */
function rolesOf(s, id) {
  const team = s.players[id].team;
  const names = holders(/** @type {any} */ (s))[team].flatMap((holder, role) => (holder === id ? [ROLES[role].name] : []));
  const text = names.join(' + ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'No rod';
}

/** The settings' labels in the game master's sheet. @type {Record<string, string>} */
const SETTING_LABELS = {
  kick: 'Kick speed', power: 'Power shot speed', maxSpeed: 'Top speed', serve: 'Serve speed',
  friction: 'Slowing while rolling', midfieldMen: 'Men on each midfield rod',
  behind: 'A man hit from behind', deadAfter: 'Dead ball served again after',
};

/** The middle of a sorted list. @param {number[]} xs */
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Table football's round screens, wrapped in the plain lobby in the phone's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const FOOSBALL_SCREEN = {
  title: 'Table football',
  name: 'table football',
  rules: [
    ['⚽', 'Two teams, Blue and Red. Watch the TV: your rods are labelled with your name.'],
    ['👆', 'Slide your finger up and down the strip: your men follow it. Where the ball hits a man sets where it goes.'],
    ['💥', 'Hold the power button: your next touch is a strong shot.'],
  ].map(([emoji, text]) => ({ icon: () => el('span', 'rule-emoji', [emoji]), text })),
  settings: {
    schema: FOOSBALL_SETTINGS_SCHEMA,
    text: (key) => ({ label: SETTING_LABELS[key] ?? key }),
    format: (key, value) => (key === 'midfieldMen' ? String(value) : key === 'friction' ? `${value} cm/s²`
      : key === 'behind' ? (value === 'block' ? 'Blocks it' : 'Kicks it on') : key === 'deadAfter' ? `${value} s` : `${value} cm/s`),
    summarize: summarizeFoosballSettings,
  },

  mount(root, io) {
    const screen = el('section', '', []);
    screen.id = 'view-foosball';
    root.append(screen);

    const team = el('span', 'fb-team');
    const roles = el('span', 'fb-roles');
    const lag = el('span', 'fb-lag');
    const handle = el('div', 'fb-handle');
    const rod = el('div', 'fb-rod');
    const strip = el('div', 'fb-strip', [rod, handle]);
    const power = /** @type {HTMLButtonElement} */ (el('button', 'fb-power', ['💥', el('span', '', ['Power'])]));
    power.type = 'button';
    const watching = el('p', 'fb-watching', ['You’re watching this match.']);
    screen.append(el('header', 'fb-top', [team, roles, lag]), el('div', 'fb-pad', [strip, power]), watching);

    /** @type {View | null} */ let last = null;
    let y = 0.5, pressed = false;
    let n = 0, sentAt = 0;
    /** When each numbered `rod` left, until the snapshots carry it back. @type {Map<number, number>} */
    const sent = new Map();
    /** @type {{ at: number, ms: number }[]} */ let samples = [];
    /** @type {[number, number] | null} */ let measured = null;
    /** @type {ReturnType<typeof setTimeout> | null} */ let pending = null;

    const playing = () => !!last && !!last.players[io.meId()] && !last.players[io.meId()].done;

    function send() {
      if (pending) { clearTimeout(pending); pending = null; }
      if (!playing() || !io.connected()) return;
      n += 1;
      sentAt = performance.now();
      sent.set(n, sentAt);
      if (sent.size > 100) sent.delete(/** @type {number} */ (sent.keys().next().value));
      io.send({ t: 'rod', y, power: pressed, n, ...(measured ? { lag: measured } : {}) });
    }
    /** Sends now, or as soon as the rate allows. */
    function sendSoon() {
      const wait = sentAt + 1000 / SEND_HZ - performance.now();
      if (wait <= 0) send();
      else pending ??= setTimeout(send, wait);
    }
    const heartbeat = setInterval(() => { if (performance.now() - sentAt >= HEARTBEAT_MS) send(); }, HEARTBEAT_MS / 2);

    /** @param {PointerEvent} e */
    function follow(e) {
      const box = strip.getBoundingClientRect();
      y = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height));
      handle.style.top = `${y * 100}%`;
      sendSoon();
    }
    strip.addEventListener('pointerdown', (e) => { strip.setPointerCapture(e.pointerId); follow(e); });
    strip.addEventListener('pointermove', (e) => { if (strip.hasPointerCapture(e.pointerId)) follow(e); });
    /** @param {boolean} on */
    const setPower = (on) => {
      if (pressed === on) return;
      pressed = on;
      power.classList.toggle('on', on);
      if (on) haptics.buzz('pickup');
      send();
    };
    power.addEventListener('pointerdown', (e) => { power.setPointerCapture(e.pointerId); setPower(true); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) power.addEventListener(type, () => setPower(false));
    power.addEventListener('contextmenu', (e) => e.preventDefault());

    /** A snapshot from the server code: this phone's lag, and its rods' actual position. @param {any} d */
    function snapshot(d) {
      const me = io.meId();
      const back = d.seen?.[me];
      const at = sent.get(back);
      if (at !== undefined) {
        sent.delete(back);
        const now = performance.now();
        samples = [...samples.filter((x) => now - x.at < LAG_WINDOW_MS), { at: now, ms: now - at }];
        measured = [median(samples.map((x) => x.ms)), Math.max(...samples.map((x) => x.ms))];
        lag.textContent = `${Math.round(measured[0])} ms · worst ${Math.round(measured[1])}`;
      }
      if (!last?.players[me]) return;
      const mine = holders(/** @type {any} */ (last))[last.players[me].team];
      const role = mine.indexOf(me);
      if (role >= 0) rod.style.top = `${d.rods[last.players[me].team][role] * 100}%`;
    }

    function render() {
      const s = /** @type {View} */ (last);
      const me = s.players[io.meId()];
      const on = playing();
      screen.classList.toggle('playing', on);
      if (!me) { team.textContent = `${TEAM_NAMES.a} ${s.score.a} – ${s.score.b} ${TEAM_NAMES.b}`; roles.textContent = ''; return; }
      screen.style.setProperty('--team', TEAM_COLORS[me.team]);
      const other = me.team === 'a' ? 'b' : 'a';
      team.textContent = `${TEAM_NAMES[me.team]} ${s.score[me.team]} – ${s.score[other]}`;
      roles.textContent = on ? rolesOf(s, io.meId()) : '';
    }

    return {
      update(round) {
        const s = /** @type {View} */ (round.view);
        const wasPlaying = playing();
        const goals = last?.goals.length ?? s.goals.length;
        last = s;
        render();
        if (s.goals.length > goals) haptics.buzz(s.goals[s.goals.length - 1].team === s.players[io.meId()]?.team ? 'win' : 'wrong');
        if (playing() && !wasPlaying) send(); // the server's match starts with a phone's first `rod`
      },
      message(msg) {
        if (msg?.t === 'unsaved' && msg.data?.t === 'foosball') snapshot(msg.data);
      },
      unmount() {
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        root.replaceChildren();
      },
    };
  },

  /** The winning team as the title, and why when the other had nobody left. */
  podium(round) {
    const s = /** @type {View} */ (round.view);
    const won = winner(s);
    const why = forfeitLine(s);
    return {
      title: won ? `${TEAM_NAMES[won]} wins! 🎉` : "It's a draw!",
      ...(why ? { kicker: why } : {}),
      rowExtra: (id) => ` · ${TEAM_NAMES[s.players[id].team]}`,
    };
  },
};
