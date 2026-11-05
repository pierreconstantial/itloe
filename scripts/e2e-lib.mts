// Shared e2e helpers: WebSocket test client, PASS/FAIL tally, legal-move search, play-to-done.
import { canPlace } from '../shared/board.js';
import { PIECES } from '../shared/pieces.js';

export const URL_WS = `ws://localhost:${process.env.PORT ?? 3141}/ws`;
/** Timeout multiplier for a loaded machine: E2E_SLOW=3 triples every wait (default 1). */
export const SLOW = Math.max(1, Number(process.env.E2E_SLOW ?? 1) || 1);
export const HTTP = URL_WS.replace(/^ws/, 'http').replace(/\/ws$/, '');
let failures = 0;
export function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
/** Prints the verdict and exits 1 on any failure. */
export function finish(): never {
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A view's block game (its round's view while a block game runs), else null. */
export const blocksOf = (v: any): any => (v?.round?.kind === 'blocks' ? v.round.view : null);
/** A view's quiz (its round's view while a quiz runs: the public projection), else null. */
export const quizOf = (v: any): any => (v?.round?.kind === 'quiz' ? v.round.view : null);
/** Who is in the room at a tableau, between rounds (the party members who haven't left), in a round's
 *  { order, players } shape; null during a round or away from a minigame's tableau. */
export const roomOf = (v: any): any => {
  if (!v?.campaign?.at.kind || v.round) return null;
  const party = v.campaign.party;
  const order = party.order.filter((id: string) => !party.players[id].left);
  return { order, players: Object.fromEntries(order.map((id: string) => [id, party.players[id]])) };
};
/** A view's tableau settings (the campaign keeps them), else null. */
export const settingsOf = (v: any): any => v?.campaign?.at.settings ?? null;
/** A view's host: the party's (a minigame stores none). */
export const hostOf = (v: any): string | null => v?.campaign?.party.hostId ?? null;

export class Client {
  ws!: WebSocket;
  msgs: any[] = [];
  /** liveness ticks, kept apart so "no broadcast" checks never trip on one */
  ticks: any[] = [];
  closed = false;
  label: string;
  constructor(label: string) { this.label = label; }
  open(): Promise<void> {
    this.ws = new WebSocket(URL_WS);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      (m.t === 'tick' ? this.ticks : this.msgs).push(m);
    };
    this.ws.onclose = () => { this.closed = true; };
    return new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = rej; });
  }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  mark(): number { return this.msgs.length; }
  since(i: number): any[] { return this.msgs.slice(i); }
  /** The block game in the last view, or null. */
  lastView(): any { return blocksOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  /** Who is in the room in the last view (between rounds), or null. */
  lastRoom(): any { return roomOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  /** The tableau's settings in the last view, or null. */
  lastSettings(): any { return settingsOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  /** The party's host in the last view. */
  lastHost(): string | null { return hostOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  async waitFor(pred: (m: any) => boolean, from = 0, ms = 2000): Promise<any> {
    const end = Date.now() + ms * SLOW;
    while (Date.now() < end) {
      const hit = this.msgs.slice(from).find(pred);
      if (hit) return hit;
      await sleep(10);
    }
    throw new Error(`${this.label}: timeout waiting (from ${from}); got ${JSON.stringify(this.since(from).map((m) => m.t))}`);
  }
}

export function legalMoves(state: any, id: string): { piece: number; x: number; y: number }[] {
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
export function illegalMove(state: any, id: string): { piece: number; x: number; y: number } {
  const p = state.players[id];
  const piece = p.hand.findIndex((h: string | null) => h !== null);
  return { piece, x: state.size, y: state.size }; // out of bounds origin
}

/** Plays `c` (player `id`) until done, random legal moves; every move must be broadcast to `other`. */
export async function playToDone(c: Client, id: string, other: Client, rnd: () => number): Promise<number> {
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
