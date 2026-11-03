// P2 end-to-end runtime test: drives a running server with WebSocket clients.
// Usage: PORT=3141 node e2e.ts
import { canPlace } from '../shared/board.js';
import { PIECES } from '../shared/pieces.js';

const URL_WS = `ws://localhost:${process.env.PORT ?? 3141}/ws`;
let failures = 0;
function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws!: WebSocket;
  msgs: any[] = [];
  closed = false;
  label: string;
  constructor(label: string) { this.label = label; }
  open(): Promise<void> {
    this.ws = new WebSocket(URL_WS);
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)));
    this.ws.onclose = () => { this.closed = true; };
    return new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = rej; });
  }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  mark(): number { return this.msgs.length; }
  since(i: number): any[] { return this.msgs.slice(i); }
  lastView(): any { return [...this.msgs].reverse().find((m) => m.t === 'view')?.state; }
  async waitFor(pred: (m: any) => boolean, from = 0, ms = 2000): Promise<any> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.msgs.slice(from).find(pred);
      if (hit) return hit;
      await sleep(10);
    }
    throw new Error(`${this.label}: timeout waiting (from ${from}); got ${JSON.stringify(this.since(from).map((m) => m.t))}`);
  }
}

function legalMoves(state: any, id: string): { piece: number; x: number; y: number }[] {
  const p = state.players[id];
  const out: { piece: number; x: number; y: number }[] = [];
  p.hand.forEach((pid: string | null, piece: number) => {
    if (pid === null) return;
    for (let y = 0; y < state.size; y++)
      for (let x = 0; x < state.size; x++)
        if (canPlace(p.board, state.size, PIECES[pid].cells, x, y)) out.push({ piece, x, y });
  });
  return out;
}
function illegalMove(state: any, id: string): { piece: number; x: number; y: number } {
  const p = state.players[id];
  const piece = p.hand.findIndex((h: string | null) => h !== null);
  return { piece, x: state.size, y: state.size }; // out of bounds origin
}

/** Plays `c` (player `id`) until done, random legal moves; every move must be broadcast to `other`. */
async function playToDone(c: Client, id: string, other: Client, rnd: () => number): Promise<number> {
  let n = 0;
  while (!c.lastView().players[id].done && c.lastView().phase === 'playing') {
    const moves = legalMoves(c.lastView(), id);
    const mv = moves[Math.floor(rnd() * moves.length)];
    const a = c.mark(), b = other.mark();
    c.send({ t: 'place', ...mv });
    await c.waitFor((m) => m.t === 'view' || m.t === 'err', a);
    await other.waitFor((m) => m.t === 'view', b);
    if (c.since(a).some((m) => m.t === 'err')) throw new Error(`legal move refused: ${JSON.stringify(mv)}`);
    if (++n > 2000) throw new Error('never got stuck');
  }
  return n;
}

let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// --- connect, hello ---
const screen = new Client('screen'); await screen.open();
await screen.waitFor((m) => m.t === 'view');
check(true, 'screen gets a view immediately on connect');
screen.send({ t: 'hello', role: 'screen' });

const A = new Client('A'); await A.open(); A.send({ t: 'hello', role: 'player' });
const B = new Client('B'); await B.open(); B.send({ t: 'hello', role: 'player' });
await A.waitFor((m) => m.t === 'view'); await B.waitFor((m) => m.t === 'view');

// unidentified start
let i = A.mark();
A.send({ t: 'start' });
check((await A.waitFor((m) => m.t === 'err', i)).code === 'unknown-player', 'start before join → err unknown-player');

// --- join ---
i = A.mark(); A.send({ t: 'join', name: 'Léa' });
const idA = (await A.waitFor((m) => m.t === 'welcome', i)).playerId;
await A.waitFor((m) => m.t === 'view' && m.state.players[idA], i);
i = B.mark(); B.send({ t: 'join', name: 'Tom' });
const idB = (await B.waitFor((m) => m.t === 'welcome', i)).playerId;
await B.waitFor((m) => m.t === 'view' && m.state.players[idB], i);
await screen.waitFor((m) => m.t === 'view' && m.state.order.length === 2);
check(B.lastView().hostId === idA && B.lastView().order.join() === `${idA},${idB}`, 'two joins → welcome each, A is host, view broadcast to all (incl. screen)');

// --- start: host guard ---
let ia = A.mark(), ib = B.mark();
B.send({ t: 'start' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-host', 'non-host start → err not-host');
await sleep(250);
check(A.since(ia).length === 0, 'non-host start → no broadcast');

ia = A.mark(); ib = B.mark();
A.send({ t: 'start' });
const v0 = (await A.waitFor((m) => m.t === 'view', ia)).state;
await B.waitFor((m) => m.t === 'view', ib);
check(v0.phase === 'playing', 'host start → phase playing, broadcast');
check(JSON.stringify(v0.players[idA].hand) === JSON.stringify(v0.players[idB].hand) && v0.players[idA].hand.every((h: any) => h), `both players get identical hand 0 (${v0.players[idA].hand.join(' ')})`);
const seed1 = v0.seed;

// --- illegal place ---
ia = A.mark(); ib = B.mark();
A.send({ t: 'place', ...illegalMove(A.lastView(), idA) });
check((await A.waitFor((m) => m.t === 'err', ia)).code === 'bad-place', 'illegal place → err bad-place');
await sleep(250);
check(A.since(ia).every((m) => m.t !== 'view') && B.since(ib).length === 0, 'illegal place → no broadcast');
ia = A.mark();
A.send({ t: 'place', piece: 7, x: 0, y: 0 });
check((await A.waitFor((m) => m.t === 'err', ia)).code === 'bad-place', 'out-of-range piece index → err bad-place');

// --- legal place ---
ia = A.mark(); ib = B.mark();
const mv = legalMoves(A.lastView(), idA)[0];
const pid = A.lastView().players[idA].hand[mv.piece];
A.send({ t: 'place', ...mv });
const v1 = (await B.waitFor((m) => m.t === 'view', ib)).state;
check(v1.players[idA].hand[mv.piece] === null && v1.players[idA].score === PIECES[pid].cells.length, `legal place (${pid}) accepted, broadcast to other player, score += cells`);

// --- mid-game rejoin: kill A's socket, re-hello on a fresh connection ---
A.ws.close(); await sleep(100);
const A2 = new Client('A2'); await A2.open();
i = A2.mark(); A2.send({ t: 'hello', role: 'player', playerId: idA });
const w = await A2.waitFor((m) => m.t === 'welcome', i);
const rv = (await A2.waitFor((m) => m.t === 'view', i)).state;
check(w.playerId === idA && JSON.stringify(rv) === JSON.stringify(B.lastView()), 'rejoin after socket death → welcome(same id) + current view');
i = A2.mark(); ib = B.mark();
const mv2 = legalMoves(A2.lastView(), idA)[0];
A2.send({ t: 'place', ...mv2 });
await B.waitFor((m) => m.t === 'view', ib);
check(A2.since(i).some((m) => m.t === 'view') && !A2.since(i).some((m) => m.t === 'err'), 'rejoined socket can place');

// --- replaced-socket path: second connection hellos with same id while first is alive ---
const A3 = new Client('A3'); await A3.open();
i = A3.mark(); A3.send({ t: 'hello', role: 'player', playerId: idA });
await A3.waitFor((m) => m.t === 'welcome', i);
await sleep(200);
check(A2.closed && !A3.closed, 'second hello with same playerId closes the first socket');
check(A3.lastView().order.length === 2, 'no duplicate player created by rejoin');
const Acur = A3;

// unknown playerId → fresh client
const X = new Client('X'); await X.open();
i = X.mark(); X.send({ t: 'hello', role: 'player', playerId: 'p-nope' });
await X.waitFor((m) => m.t === 'view', i); await sleep(150);
check(!X.since(i).some((m) => m.t === 'welcome'), 'unknown playerId → no welcome (fresh client)');
i = X.mark(); X.send({ t: 'join', name: 'Late' });
check((await X.waitFor((m) => m.t === 'err', i)).code === 'full', 'join during playing → err (full)');
X.ws.close();

// --- play both to done ---
const nA = await playToDone(Acur, idA, B, rnd);
check(Acur.lastView().players[idA].done && Acur.lastView().phase === 'playing', `A stuck → done after ${nA} more moves, game still playing`);
i = Acur.mark();
Acur.send({ t: 'place', ...legalMoves({ ...Acur.lastView(), players: { [idA]: { ...Acur.lastView().players[idA], board: new Array(64).fill(0) } } }, idA)[0] });
check((await Acur.waitFor((m) => m.t === 'err', i)).code === 'bad-place', 'place by done player → err bad-place');
ib = B.mark();
B.send({ t: 'again' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-host', 'again while playing (non-host) → err');

const nB = await playToDone(B, idB, Acur, rnd);
const fin = Acur.lastView();
await screen.waitFor((m) => m.t === 'view' && m.state.phase === 'finished');
check(fin.phase === 'finished', `B done after ${nB} moves → phase finished (scores A=${fin.players[idA].score}, B=${fin.players[idB].score})`);
i = B.mark();
B.send({ t: 'place', piece: 0, x: 0, y: 0 });
check((await B.waitFor((m) => m.t === 'err', i)).code === 'not-playing', 'place in finished → err not-playing');

// --- again ---
ib = B.mark();
B.send({ t: 'again' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-host', 'non-host again → err not-host');
ia = Acur.mark(); ib = B.mark();
Acur.send({ t: 'again' });
const va = (await B.waitFor((m) => m.t === 'view', ib)).state;
const pa = va.players[idA], pb = va.players[idB];
check(va.phase === 'playing' && va.seed !== seed1, `host again → playing, new seed (${seed1} → ${va.seed})`);
check(va.order.join() === `${idA},${idB}` && pa.score === 0 && pb.score === 0 && pa.board.every((c: number) => c === 0) && !pa.done && !pb.done
  && JSON.stringify(pa.hand) === JSON.stringify(pb.hand), 'again → same players, fresh boards/scores, identical new hand 0');

for (const c of [screen, Acur, B]) c.ws.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
