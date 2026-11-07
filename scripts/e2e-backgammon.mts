// Backgammon end-to-end: a real server on backgammon's development start, four phone pages and a TV page in headless
// Chrome (each phone a separate device), and a screen socket that reads every view. The four players play the whole
// group phase: three rounds of two boards, then the podium.
// Checks: on the first board, a move by each side through the phones' own taps (each side counts its points its own
// way): the checkers the phone marks movable and the points it lights up are the ones the rules allow, on that phone
// only; the tapped move is the one the server applies and the TV draws; Undo takes it back; Done and Roll pass the
// turn. The rest of each round plays through the phones' own sockets (SOCKET_PROBE). Between rounds the TV shows the
// results and the next games, the phones wait for Pierre, and his phone's button starts the next round; after the
// last, it shows the podium, ranked as the standings.
// Usage: start Chrome with --remote-debugging-port=<CDP>, then
//        PORT=3194 CDP=9222 node scripts/e2e-backgammon.mts      (never PORT 3131: the live server)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backgammonOf, cdpConnect, check, Client, finish, HTTP, lobbyOf, openPage, type Page, type Server, SOCKET_PROBE, startServer, stop } from './e2e-lib.mts';
import { BAR, OFF, allowedSteps, nextPairs, other, reach, standings } from '../shared/backgammon.js';

const PORT = process.env.PORT ?? '3142';
const CDP = process.env.CDP ?? '9222';
const VAR = mkdtempSync(join(tmpdir(), 'itloe-backgammon-'));
const SHOTS = '/tmp/bg-shots-e2e';
const NAMES = ['pierre', 'elodie', 'sol', 'anna']; // Pierre first: the game master

let server: Server | null = null;
const pages: Page[] = [];
let T!: Client; // the screen socket: every view
let tv!: Page;
type Seat = { name: string, id: string, page: Page };
const seats: Record<string, Seat> = {};
const byId = (id: string): Seat => Object.values(seats).find((s) => s.id === id)!;
/** A message on a phone's own socket, as the phone would send it. */
const say = (id: string, m: object) => byId(id).page.ev(`window.__ws.send(${JSON.stringify(JSON.stringify(m))})`);
const round = (): any => backgammonOf(T.last());

/** A view of the screen socket whose round satisfies `pred`, after message `from`. */
async function untilRound(pred: (s: any) => boolean, from: number, ms = 5000): Promise<any> {
  return backgammonOf(await T.waitFor((m) => m.t === 'view' && !!backgammonOf(m) && pred(backgammonOf(m)), from, ms));
}

/** The data-q of a phone's board cells with a class (movable `can`, `lit`), sorted. */
const cells = (page: Page, cls: string): Promise<number[]> =>
  page.ev(`[...document.querySelectorAll('#view-backgammon .${cls}[data-q]')].map((e) => Number(e.dataset.q)).sort((a, b) => a - b)`);
const sorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const same = (a: number[], b: number[]) => a.join() === b.join();
/** A phone's cells with a class once they are `want` (the phone draws a view a moment after it arrives), else as they are after 3 s. */
async function settledCells(page: Page, cls: string, want: number[]): Promise<number[]> {
  let got = await cells(page, cls);
  for (let k = 0; k < 30 && !same(got, want); k++) {
    await new Promise((r) => setTimeout(r, 100));
    got = await cells(page, cls);
  }
  return got;
}

/**
 * What the TV draws of a board: per point of side a's numbering, the checkers shown and their colour, and each
 * side's bar and tray; compared with what the view holds.
 */
async function tvDraws(index: number, s: any): Promise<boolean> {
  const drawn: any = await tv.ev(`(() => {
    const board = document.querySelectorAll('.bgm-board')[${index}];
    if (!board) return null;
    const pts = {};
    for (const cell of board.querySelectorAll('.bgm-pt')) {
      const [row, col] = cell.style.gridArea.split('/').map((x) => Number(x.trim()));
      const p = row === 3 ? (col >= 8 ? 14 - col : 13 - col) : (col >= 8 ? col + 11 : col + 12);
      const cks = [...cell.querySelectorAll('.bgm-ck')];
      pts[p] = { n: cks.length, label: cks.at(-1)?.textContent ?? '', color: cks[0]?.style.background ?? '' };
    }
    const count = (sel) => [...board.querySelectorAll(sel)].map((x) => x.querySelectorAll('.bgm-ck, b').length);
    return { pts, bar: count('.bgm-bar > span'), trays: count('.bgm-tray') };
  })()`);
  if (!drawn) return false;
  const b = s.boards[index];
  const color = (side: 'a' | 'b') => `var(--p${s.players[b[side]].color})`;
  for (let p = 1; p <= 24; p++) {
    const na = b.c.a[p], nb = b.c.b[25 - p], n = na || nb;
    const want = { n: Math.min(n, 5), label: n > 5 ? String(n) : '', color: n ? color(na ? 'a' : 'b') : '' };
    const got = drawn.pts[p];
    if (got.n !== want.n || got.label !== want.label || got.color !== want.color) return false;
  }
  return same(drawn.bar, [Math.min(b.c.b[BAR], 5), Math.min(b.c.a[BAR], 5)]) && same(drawn.trays, [b.c.b[OFF], b.c.a[OFF]]);
}

/**
 * What a phone draws of its player's board, in its player's numbering: per point, the checkers shown and their
 * colour (its own on its points, the opponent's on their point 25 - q), and the bars; compared with the view.
 */
async function phoneDraws(page: Page, s: any, side: 'a' | 'b'): Promise<boolean> {
  const drawn: any = await page.ev(`(() => {
    const pts = {};
    for (const cell of document.querySelectorAll('#view-backgammon .bg-pt[data-q]')) {
      const cks = [...cell.querySelectorAll('.bg-ck')];
      pts[cell.dataset.q] = { n: cks.length, color: cks[0]?.style.background ?? '' };
    }
    const bars = [...document.querySelectorAll('#view-backgammon .bg-bar')].map((x) => x.querySelectorAll('.bg-ck').length);
    return { pts, bars };
  })()`);
  const b = s.boards[0];
  const mine = b.c[side], theirs = b.c[other(side)];
  const color = (sd: 'a' | 'b') => `var(--p${s.players[b[sd]].color})`;
  for (let q = 1; q <= 24; q++) {
    const n = mine[q] || theirs[25 - q];
    const want = { n: Math.min(n, 5), color: n ? color(mine[q] ? side : other(side)) : '' };
    if (drawn.pts[q]?.n !== want.n || drawn.pts[q]?.color !== want.color) return false;
  }
  return same(drawn.bars, [Math.min(theirs[BAR], 5), Math.min(mine[BAR], 5)]);
}

/**
 * One move on board 0 by its player to move, through their phone: the movable checkers and the lit points match the
 * rules and show on that phone only, the tapped move is applied and drawn on the TV. `label` names the side.
 */
async function tapMove(label: string): Promise<{ from: number, to: number }> {
  const s = round();
  const b = s.boards[0];
  const side = b.turn, mover = byId(b[side]);
  const mine = b.c[side], theirs = b.c[other(side)];
  const steps = allowedSteps(mine, theirs, b.dice);
  // a single movable checker is picked for the player: it lights its points without a tap
  const movable = await settledCells(mover.page, 'can', sorted(steps.map((x: any) => x.from)));
  check(same(movable, sorted(steps.map((x: any) => x.from))), `${label}: the phone marks the checkers the rules let move (${movable})`);
  const from = movable[0];
  if (movable.length > 1) await mover.page.tap(`#view-backgammon [data-q="${from}"]`);
  const want = sorted(reach(mine, theirs, b.dice, from).map((r: any) => r.to));
  const lit = await settledCells(mover.page, 'lit', want);
  check(same(lit, want), `${label}: from ${from}, the points it can reach light up (${lit})`);
  const others = await Promise.all(Object.values(seats).filter((x) => x !== mover).map((x) => cells(x.page, 'lit')));
  check(others.every((x) => x.length === 0), `${label}: no other phone lights anything`);
  const to = lit[0];
  const i = T.mark();
  await mover.page.tap(`#view-backgammon .lit[data-q="${to}"]`);
  const after = await untilRound((r) => r.boards[0].undo.length === b.undo.length + 1, i);
  const c = after.boards[0].c[side];
  check(c[from] === mine[from] - 1 && c[to] === mine[to] + 1, `${label}: the server applies the tapped move, ${from} → ${to === OFF ? 'off' : to}`);
  await tv.waitFor(`document.querySelectorAll('.bgm-board').length > 0`);
  let drawn = false;
  for (let k = 0; k < 20 && !drawn; k++) { drawn = await tvDraws(0, round()); if (!drawn) await new Promise((r) => setTimeout(r, 100)); }
  check(drawn, `${label}: the TV draws the board as the server has it`);
  let onPhone = false;
  for (let k = 0; k < 20 && !onPhone; k++) { onPhone = await phoneDraws(mover.page, round(), side); if (!onPhone) await new Promise((r) => setTimeout(r, 100)); }
  check(onPhone, `${label}: the phone draws its player's board as the server has it, from their side`);
  return { from, to };
}

/** The player to move on board 0 makes picked moves by tapping until none is left, then taps Done. */
async function finishTurnByTaps(): Promise<void> {
  for (;;) {
    const b = round().boards[0];
    const page = byId(b[b.turn]).page;
    if (allowedSteps(b.c[b.turn], b.c[other(b.turn)], b.dice).length === 0) {
      const i = T.mark();
      await page.tap('Done');
      await untilRound((r) => r.boards[0].turn !== b.turn, i);
      return;
    }
    const steps = allowedSteps(b.c[b.turn], b.c[other(b.turn)], b.dice);
    const movable = await settledCells(page, 'can', sorted(steps.map((x: any) => x.from)));
    if (movable.length > 1) await page.tap(`#view-backgammon [data-q="${movable[0]}"]`);
    const lit = await settledCells(page, 'lit', sorted(reach(b.c[b.turn], b.c[other(b.turn)], b.dice, movable[0]).map((r: any) => r.to)));
    const i = T.mark();
    await page.tap(`#view-backgammon .lit[data-q="${lit[0]}"]`);
    await untilRound((r) => r.boards[0].undo.length === b.undo.length + 1, i);
  }
}

/** Plays every board of the current round to its end through the players' own sockets: picked moves the rules allow. */
async function playRoundOut(): Promise<any> {
  for (let n = 0; n < 20000; n++) {
    const s = round();
    if (s.phase !== 'playing' || s.endReason) return s;
    const i = T.mark();
    for (const b of s.boards) {
      if (b.end) continue;
      const id = b[b.turn];
      if (!b.dice) { await say(id, { t: 'roll' }); continue; }
      const steps = allowedSteps(b.c[b.turn], b.c[other(b.turn)], b.dice);
      if (steps.length === 0) { await say(id, { t: 'done' }); continue; }
      // the checker furthest back, to its furthest point: games end sooner
      const from = Math.max(...steps.map((x: any) => x.from));
      const to = Math.min(...reach(b.c[b.turn], b.c[other(b.turn)], b.dice, from).map((r: any) => r.to));
      await say(id, { t: 'move', from, to });
    }
    await T.waitFor((m) => m.t === 'view', i);
  }
  throw new Error('the round never ended');
}

/** Between rounds: the TV's results and next games, the phones waiting for Pierre, his button. */
async function checkResults(s: any): Promise<void> {
  const next = nextPairs(s);
  const what = next ? `start round ${s.round + 1}` : 'show the podium';
  await tv.waitText(new RegExp(`Round ${s.round} results`, 'i'));
  const tvText = await tv.text();
  const names = (id: string) => s.players[id].name;
  check(s.boards.every((b: any) => tvText.includes(`${names(b[b.end.winner])} +${b.end.points}`)),
    `round ${s.round}: the TV crowns each board's winner with their points`);
  check(next ? next.pairs.every(([a, b]) => tvText.includes(names(a)) && tvText.includes(names(b))) && tvText.includes(`Up next · Round ${s.round + 1}`) : tvText.includes('That was the last round'),
    `round ${s.round}: the TV shows ${next ? 'the next round\'s games' : 'that it was the last round'}`);
  check(tvText.includes(`Waiting for Pierre to ${what}`), `round ${s.round}: the TV waits for Pierre to ${what}`);
  for (const seat of Object.values(seats)) {
    if (seat.name === 'pierre') continue;
    await seat.page.waitText(new RegExp(`Waiting for Pierre to ${what}`));
  }
  check(true, `round ${s.round}: the other phones wait for Pierre`);
  await seats.pierre.page.tap(next ? `▶ Start round ${s.round + 1}` : '▶ Show the podium');
}

try {
  server = await startServer(PORT, join(VAR, 'var'), 'minigame:backgammon', { stdio: 'pipe' });
  const room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  const cdp = await cdpConnect(CDP);
  const open = async (label: string, phone: boolean) => {
    const p = await openPage(cdp, label, phone, () => SHOTS, phone ? [SOCKET_PROBE] : []);
    pages.push(p);
    return p;
  };

  tv = await open('tv', false);
  await tv.goto(`${HTTP}/screen/`);
  for (const name of NAMES) {
    const page = await open(name, true);
    await page.goto(`${HTTP}/play?room=${room}`);
    await page.tap(`.pick-card[data-id="${name}"]`);
    await page.waitFor(`localStorage.getItem('bloko-id') && document.getElementById('view-pick')?.closest('[hidden]')`);
    seats[name] = { name, id: await page.ev(`localStorage.getItem('bloko-id')`), page };
  }
  T = new Client('T'); await T.open();
  T.send({ t: 'hello', role: 'screen' });
  await T.waitFor((m) => m.t === 'view');

  // ---------- the lobby: four ready, Pierre starts ----------
  let i = T.mark();
  await say(seats.pierre.id, { t: 'startMinigame' });
  await T.waitFor((m) => m.t === 'view' && !!lobbyOf(m), i);
  i = T.mark();
  for (const name of NAMES) await say(seats[name].id, { t: 'ready', on: true });
  await T.waitFor((m) => m.t === 'view' && lobbyOf(m)?.ready.length === 4, i);
  i = T.mark();
  await say(seats.pierre.id, { t: 'start' });
  let s = await untilRound((r) => r.phase === 'playing', i);
  check(s.boards.length === 2 && s.round === 1, 'four players: round 1 on two boards');

  // ---------- round 1, board 1: a move by each side through the phones' taps ----------
  const first = s.boards[0].turn;
  await byId(s.boards[0][first]).page.waitFor(`document.querySelectorAll('#view-backgammon .can').length > 0`);
  const moved = await tapMove('first side');
  i = T.mark();
  await byId(s.boards[0][first]).page.tap('Undo');
  const undone = await untilRound((r) => r.boards[0].undo.length === 0, i);
  check(undone.boards[0].c[first][moved.from] === s.boards[0].c[first][moved.from], 'Undo takes the move back');
  await finishTurnByTaps();
  const second = byId(round().boards[0][other(first)]);
  i = T.mark();
  await second.page.tap('🎲 Roll');
  await untilRound((r) => !!r.boards[0].dice, i);
  await tv.waitFor(`document.querySelectorAll('.bgm-board')[0]?.parentElement.querySelectorAll('.bgm-die').length > 0`);
  check(true, 'the other side rolls on its phone: the dice show on the TV');
  if (allowedSteps(round().boards[0].c[other(first)], round().boards[0].c[first], round().boards[0].dice).length) await tapMove('second side');

  // ---------- three rounds: played out, the results, Pierre starts the next ----------
  for (let r = 1; r <= 3; r++) {
    s = await playRoundOut();
    check(s.phase === 'results' && s.boards.every((b: any) => b.end), `round ${r}: every game played to its end`);
    i = T.mark();
    await checkResults(s);
    if (r < 3) await untilRound((x) => x.round === r + 1 && x.phase === 'playing', i);
  }

  // ---------- the podium, ranked as the standings ----------
  const podium = await T.waitFor((m) => m.t === 'view' && m.minigame?.status === 'podium');
  const final = backgammonOf(podium);
  check(final.games.length === 6, 'the group phase: every pair played once');
  const rows = standings(final);
  check(rows.every((row) => final.players[row.id].rank === row.rank && final.players[row.id].score === row.points), 'the podium ranks the players as the standings');
  const top = rows.filter((row) => row.rank === 1);
  await tv.waitText(top.length === 1 ? new RegExp(`${final.players[top[0].id].name} wins!`) : /It's a tie!/);
  check(true, 'the TV\'s podium names the winner');

  const errors = pages.flatMap((p) => p.errors);
  check(errors.length === 0, `no page threw${errors.length ? `: ${errors[0]}` : ''}`);
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${server?.log() ?? ''}`);
} finally {
  T?.ws.close();
  for (const p of pages) await p.close();
  await stop(server?.proc ?? null);
  rmSync(VAR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
