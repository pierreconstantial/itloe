// Table football's TV screen (shared/foosball.js), mounted by the plain lobby (./plain-lobby.js) while a match runs:
// the score with each team's players, the table seen from above, and each player's lag. The live match comes as
// snapshots from the server code (server/foosball.ts), SEND_HZ a second; the table is drawn DELAY_MS behind
// the newest, in between the two snapshots around that moment, so an irregular arrival doesn't stutter.

import { h, addStylesheet, playerColor } from './dom.js';
import { sfx } from './audio.js';
import { ROLES, TEAMS, TEAM_COLORS, TEAM_NAMES, TUNING, forfeitLine, holders, menY, rodX, summarizeFoosballSettings, winner } from '../../shared/foosball.js';

/** The round's view: its state without the seed (server/foosball.ts). @typedef {Omit<import('../../shared/foosball.js').FoosballState, 'seed'>} View */
/** @typedef {import('../../shared/foosball.js').Team} Team */
/** A snapshot, with when it arrived. @typedef {{ at: number, serves: number, ball: [number, number], rods: Record<Team, number[]>, armed: string[], lag: Record<string, [number, number]>, arrived: number }} Snapshot */

addStylesheet(new URL('./foosball.css', import.meta.url));

const DELAY_MS = 100;
/** The snapshots kept: a little over two seconds' worth. */
const KEPT = 50;
const GOAL_MS = 1600;
/** Room around the table for the goals, in centimetres. */
const MARGIN = 6;

const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;

/** @param {HTMLElement} root @param {import('./minigames.js').TvIo} io @returns {import('./minigames.js').RoundMounted} */
function mount(root, io) {
  const score = h('div', 'fb-score');
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', 'fb-table'));
  const goal = h('div', 'fb-goal');
  const lags = h('div', 'fb-lags');
  root.append(h('div', 'fb', [h('header', 'fb-head', [h('h1', 'fb-logo', ['TABLE FOOTBALL']), score]), h('div', 'fb-stage', [canvas, goal]), lags]));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  /** @type {View | null} */ let view = null;
  /** @type {Snapshot[]} */ let snaps = [];
  /** The smallest (arrival − server time) seen: the server's clock on this TV, with the least delay. */
  let offset = Infinity;
  /** @type {ReturnType<typeof setTimeout> | null} */ let goalTimer = null;
  /** The characters' colours, read once from the page's CSS for the canvas. @type {Map<number, string>} */
  const colors = new Map();
  /** @param {number} color */
  const colorOf = (color) => {
    if (!colors.has(color)) colors.set(color, getComputedStyle(root).getPropertyValue(`--p${color}`).trim() || '#fff');
    return /** @type {string} */ (colors.get(color));
  };

  /** The live match DELAY_MS behind the newest snapshot, in between the two around it. */
  function now() {
    const t = Date.now() - offset - DELAY_MS;
    const i = snaps.findIndex((s) => s.at > t);
    if (i < 0) return snaps[snaps.length - 1];
    if (i === 0) return snaps[0];
    const a = snaps[i - 1], b = snaps[i];
    if (a.serves !== b.serves) return a; // a new serve: the ball jumps to the middle, it doesn't roll there
    const k = (t - a.at) / (b.at - a.at);
    /** @type {Record<Team, number[]>} */
    const rods = { a: a.rods.a.map((p, r) => lerp(p, b.rods.a[r], k)), b: a.rods.b.map((p, r) => lerp(p, b.rods.b[r], k)) };
    return { ...b, ball: /** @type {[number, number]} */ ([lerp(a.ball[0], b.ball[0], k), lerp(a.ball[1], b.ball[1], k)]), rods };
  }

  function draw() {
    frame = requestAnimationFrame(draw);
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(box.width * dpr), hgt = Math.round(box.height * dpr);
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
    const T = TUNING;
    const scale = Math.min(w / (T.width + 2 * MARGIN), hgt / (T.height + 2 * MARGIN));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.setTransform(scale, 0, 0, scale, (w - T.width * scale) / 2, (hgt - T.height * scale) / 2);

    // the pitch, its lines and the goals
    ctx.fillStyle = '#2f7d3b';
    ctx.fillRect(0, 0, T.width, T.height);
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(T.width / 2, 0); ctx.lineTo(T.width / 2, T.height);
    ctx.moveTo(T.width / 2 + 9, T.height / 2); ctx.arc(T.width / 2, T.height / 2, 9, 0, Math.PI * 2);
    ctx.strokeRect(0, T.height / 2 - 16, 14, 32); ctx.strokeRect(T.width - 14, T.height / 2 - 16, 14, 32);
    ctx.stroke();
    for (const team of TEAMS) {
      ctx.fillStyle = TEAM_COLORS[team];
      ctx.fillRect(team === 'a' ? -4 : T.width, T.height / 2 - T.goal / 2, 4, T.goal);
    }
    ctx.strokeStyle = '#1b3d22';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, T.width, T.height);

    const s = snaps.length ? now() : null;
    const rodHolders = view ? holders(/** @type {any} */ (view)) : { a: [null, null, null, null], b: [null, null, null, null] };
    for (const team of TEAMS) {
      for (let role = 0; role < ROLES.length; role++) {
        const x = rodX(team, role);
        const id = rodHolders[team][role];
        ctx.fillStyle = '#c9ced4';
        ctx.fillRect(x - 0.4, -MARGIN, 0.8, T.height + 2 * MARGIN);
        if (id && view) {
          ctx.fillStyle = colorOf(view.players[id].color);
          ctx.font = 'bold 2.6px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(view.players[id].name, x, T.height + 4.2);
        }
        const armed = !!id && !!s?.armed.includes(id);
        for (const y of view ? menY(role, s ? s.rods[team][role] : 0.5, view.settings) : []) {
          ctx.fillStyle = armed ? '#ffd23f' : TEAM_COLORS[team];
          ctx.beginPath();
          ctx.roundRect(x - T.manHalfThickness, y - T.manHalfWidth, 2 * T.manHalfThickness, 2 * T.manHalfWidth, 0.8);
          ctx.fill();
          if (id && view) {
            ctx.fillStyle = colorOf(view.players[id].color);
            ctx.beginPath();
            ctx.arc(x, y, 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    if (s) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.ball[0], s.ball[1], T.ballRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  let frame = requestAnimationFrame(draw);

  /** Each team's players and the score. @param {View} s */
  function renderScore(s) {
    /** @param {Team} team */
    const side = (team) => h('div', `fb-side ${team}`, [
      Object.assign(h('b', '', [TEAM_NAMES[team]]), { style: `color:${TEAM_COLORS[team]}` }),
      h('span', 'fb-names', s.order.filter((id) => s.players[id].team === team).map((id) => {
        const p = s.players[id];
        const name = h('span', p.left ? 'left' : '', [p.name]);
        name.style.color = playerColor(p.color);
        return name;
      })),
    ]);
    score.replaceChildren(side('a'), h('div', 'fb-goals', [`${s.score.a} – ${s.score.b}`]), side('b'));
  }

  /** Each player's lag, as their phone measured it. */
  function renderLags() {
    const newest = snaps[snaps.length - 1];
    if (!view || !newest) return;
    const v = view;
    lags.replaceChildren(...v.order.filter((id) => !v.players[id].done).map((id) => {
      const lag = newest.lag[id];
      const dot = h('i');
      dot.style.background = playerColor(v.players[id].color);
      return h('span', 'fb-lag', [dot, v.players[id].name, ' ', lag ? `${lag[0]} ms · worst ${lag[1]}` : '…']);
    }));
  }

  return {
    update(round) {
      const s = /** @type {View} */ (round.view);
      const prev = io.continuous() ? view : null;
      view = s;
      renderScore(s);
      if (prev && s.goals.length > prev.goals.length) {
        const g = s.goals[s.goals.length - 1];
        const by = g.by ? s.players[g.by] : null;
        const own = by && by.team !== g.team;
        goal.replaceChildren(h('b', '', ['GOAL!']), h('span', '', [by ? `${by.name}${own ? ' (own goal)' : ''}` : TEAM_NAMES[g.team]]));
        goal.style.color = TEAM_COLORS[g.team];
        goal.classList.add('on');
        if (goalTimer) clearTimeout(goalTimer);
        goalTimer = setTimeout(() => goal.classList.remove('on'), GOAL_MS);
        sfx.cleanBoard();
      }
    },
    message(msg) {
      if (msg?.t !== 'unsaved' || msg.data?.t !== 'foosball') return;
      const arrived = Date.now();
      const snap = /** @type {Snapshot} */ ({ ...msg.data, arrived });
      offset = Math.min(offset, arrived - snap.at);
      snaps = [...snaps.filter((x) => x.at < snap.at), snap].slice(-KEPT);
      if (snaps.length % 10 === 0) renderLags();
    },
    unmount() {
      cancelAnimationFrame(frame);
      if (goalTimer) clearTimeout(goalTimer);
      root.replaceChildren();
    },
  };
}

/** Table football's round screen, wrapped in the plain lobby in the TV's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const FOOSBALL_SCREEN = {
  title: 'Table football',
  name: 'table football',
  settings: { summarize: summarizeFoosballSettings },
  mount,
  /** The winning team as the title, and why when the other had nobody left. */
  podium(round) {
    const s = /** @type {View} */ (round.view);
    const won = winner(s);
    const why = forfeitLine(s);
    return {
      title: won ? `${TEAM_NAMES[won]} wins!` : "It's a draw!",
      ...(why ? { lines: [h('p', 'fb-podium-line', [why])] } : {}),
      rowExtra: (id) => [h('span', '', [TEAM_NAMES[s.players[id].team]])],
    };
  },
};
