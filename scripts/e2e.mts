// P2 end-to-end runtime test: drives a running server with WebSocket clients.
// Usage: start the server, then: PORT=<same port> node scripts/e2e.mts
// (kill -9 / resume across phases: scripts/e2e-resume.mts, which runs its own server)
import { PIECES } from '../shared/pieces.js';
import { CHARACTERS, ROSTER_SIZE } from '../shared/characters.js';
import { blocksOf, check, Client, finish, gmOf, HTTP, illegalMove, lobbyOf, roomOf, legalMoves, playToDone, settled, sleep, URL_WS } from './e2e-lib.mts';

let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// --- connect, hello ---
const screen = new Client('screen'); await screen.open();
await screen.waitFor((m) => m.t === 'view');
check(true, 'screen gets a view immediately on connect');
screen.send({ t: 'hello', role: 'screen' });

// --- room code ---
const join = await (await fetch(URL_WS.replace(/^ws/, 'http').replace(/\/ws$/, '/api/join'))).json();
const room: string = join.code;
check(/^[A-Z]{4}$/.test(room) && join.url.endsWith(`/play?room=${room}`), `/api/join → 4-letter code + url with ?room= (${join.url})`);
// the QR's /play?room=CODE (no trailing slash) is redirected to the page: the code must survive the redirect
const redirects = await Promise.all(['/play', '/screen', '/sim'].map(async (p) => {
  const r = await fetch(`${HTTP}${p}?room=${room}&x=1`, { redirect: 'manual' });
  return r.status === 302 && r.headers.get('location') === `${p}/?room=${room}&x=1`;
}));
const landed = await fetch(`${HTTP}/play?room=${room}`);
check(redirects.every(Boolean) && landed.status === 200 && new URL(landed.url).search === `?room=${room}`,
  '/play?room=… (and /screen, /sim) redirect to the page keeping the query string');
const R = new Client('R'); await R.open();
R.send({ t: 'hello', role: 'player' });
let i = R.mark(); R.send({ t: 'join', character: 'elodie' });
check((await R.waitFor((m) => m.t === 'err', i)).code === 'bad-room', 'join without room → err bad-room');
R.send({ t: 'hello', role: 'player', room: room === 'ABCD' ? 'ABCE' : 'ABCD' });
i = R.mark(); R.send({ t: 'join', character: 'elodie' });
check((await R.waitFor((m) => m.t === 'err', i)).code === 'bad-room', 'join with wrong room → err bad-room');
R.ws.close();

const A = new Client('A'); await A.open(); A.send({ t: 'hello', role: 'player', room });
const B = new Client('B'); await B.open(); B.send({ t: 'hello', role: 'player', room: room.toLowerCase() });
await A.waitFor((m) => m.t === 'view'); await B.waitFor((m) => m.t === 'view');

// unidentified start
i = A.mark();
A.send({ t: 'startMinigame' });
check((await A.waitFor((m) => m.t === 'err', i)).code === 'unknown-player', 'startMinigame before join → err unknown-player');

// --- join ---
i = A.mark(); A.send({ t: 'join', character: 'pierre' });
const idA = (await A.waitFor((m) => m.t === 'welcome', i)).playerId;
await A.waitFor((m) => m.t === 'view' && roomOf(m)?.players[idA], i);
i = B.mark(); B.send({ t: 'join', character: 'sol' });
const idB = (await B.waitFor((m) => m.t === 'welcome', i)).playerId;
await B.waitFor((m) => m.t === 'view' && roomOf(m)?.players[idB], i);
await screen.waitFor((m) => m.t === 'view' && roomOf(m)?.order.length === 2);
check(true, 'room code accepted (B typed it in lower case)');
check(B.lastGm() === idA && B.lastRoom().order.join() === `${idA},${idB}`, 'two joins → welcome each, A (Pierre) is game master, view broadcast to all (incl. screen)');
const pA = B.lastRoom().players[idA];
check(pA.character === 'pierre' && pA.name === CHARACTERS.pierre.name && pA.color === CHARACTERS.pierre.color, 'join by character → name + colour from the roster');

// --- character already picked / not a character / roster exhausted ---
const T = new Client('T'); await T.open(); T.send({ t: 'hello', role: 'player', room });
i = T.mark(); T.send({ t: 'join', character: 'pierre' });
check((await T.waitFor((m) => m.t === 'err', i)).code === 'taken', 'join with a picked character → err taken');
i = T.mark(); T.send({ t: 'join', character: 'bowser' });
check((await T.waitFor((m) => m.t === 'err', i)).code === 'taken', 'join with an unknown character → err taken');

// --- leave in the room: player removed, its id can no longer rejoin ---
const L = new Client('L'); await L.open(); L.send({ t: 'hello', role: 'player', room });
i = L.mark(); L.send({ t: 'join', character: 'anna' });
const idL = (await L.waitFor((m) => m.t === 'welcome', i)).playerId;
const M = new Client('M'); await M.open(); M.send({ t: 'hello', role: 'player', room });
i = M.mark(); M.send({ t: 'join', character: 'elodie' });
const idM = (await M.waitFor((m) => m.t === 'welcome', i)).playerId;
await A.waitFor((m) => m.t === 'view' && roomOf(m)?.players[idL] && roomOf(m)?.players[idM]);
// the rest of the roster (Nico, …) is held too, so nothing is left to pick
const extra: { c: Client, id: string }[] = [];
for (const character of Object.keys(CHARACTERS).filter((c) => !['pierre', 'sol', 'anna', 'elodie'].includes(c))) {
  const c = new Client(character); await c.open(); c.send({ t: 'hello', role: 'player', room });
  i = c.mark(); c.send({ t: 'join', character });
  extra.push({ c, id: (await c.waitFor((m) => m.t === 'welcome', i)).playerId });
}

await A.waitFor((m) => m.t === 'view' && roomOf(m)?.order.length === ROSTER_SIZE);

i = T.mark(); T.send({ t: 'join', character: 'pierre' });
check((await T.waitFor((m) => m.t === 'err', i)).code === 'full', `every character held (${ROSTER_SIZE}) → err full`);
for (const { c, id } of extra) {
  i = A.mark(); c.send({ t: 'leave' });
  await A.waitFor((m) => m.t === 'view' && !roomOf(m)?.players[id], i);
  c.ws.close();
}
i = A.mark(); M.send({ t: 'leave' });
await A.waitFor((m) => m.t === 'view' && !roomOf(m)?.players[idM], i);
i = T.mark(); T.send({ t: 'join', character: 'elodie' });
const idT = (await T.waitFor((m) => m.t === 'welcome', i)).playerId;
check(!!idT, "a left player's character is free again");
M.ws.close();
i = A.mark(); T.send({ t: 'leave' });
await A.waitFor((m) => m.t === 'view' && !roomOf(m)?.players[idT], i);
T.ws.close();
i = A.mark(); L.send({ t: 'leave' });
const vl = roomOf(await A.waitFor((m) => m.t === 'view', i));
check(!vl.players[idL] && vl.order.join() === `${idA},${idB}`, 'leave in the room → player removed, broadcast');
L.ws.close();
const L2 = new Client('L2'); await L2.open();
i = L2.mark(); L2.send({ t: 'hello', role: 'player', room, playerId: idL });
await L2.waitFor((m) => m.t === 'view', i); await sleep(150);
check(!L2.since(i).some((m) => m.t === 'welcome'), 'left player id → no welcome on rejoin');
L2.ws.close();

// --- avatar positions: relayed to screens only, clamped, malformed/unjoined dropped ---
const posOf = (c: Client, from: number, id: string) => c.since(from).filter((m) => m.t === 'pos' && m.playerId === id);
let is = screen.mark(), ib = B.mark();
A.send({ t: 'jump', playerId: idB });
check((await screen.waitFor((m) => m.t === 'jump', is)).playerId === idA, 'jump is bound to the sender and relayed to screens');
await sleep(100);
check(!B.since(ib).some((m) => m.t === 'jump'), 'phones do not receive jump');
is = screen.mark(); ib = B.mark();
A.send({ t: 'pos', x: 20, y: -1, dir: 'left', moving: true });
const p1 = await screen.waitFor((m) => m.t === 'pos' && m.playerId === idA, is);
check(p1.x === 16 && p1.y === 0 && p1.dir === 'left' && p1.moving === true, 'pos relayed to the screen, clamped to the world (20,-1 → 16,0)');
await sleep(150);
check(!B.since(ib).some((m) => m.t === 'pos'), 'phones do not receive pos');
is = screen.mark();
A.send({ t: 'pos', x: 3, y: 3, dir: 'north', moving: true });
A.send({ t: 'pos', x: '3', y: 3, dir: 'up', moving: true });
const U = new Client('U'); await U.open(); U.send({ t: 'hello', role: 'player', room });
U.send({ t: 'pos', x: 1, y: 1, dir: 'up', moving: false });
await sleep(200);
check(screen.since(is).every((m) => m.t !== 'pos'), 'malformed pos and pos from a non-joined socket are dropped');
U.ws.close();
is = screen.mark();
for (let k = 0; k < 45; k++) B.send({ t: 'pos', x: k / 10, y: 2, dir: 'right', moving: true });
await sleep(300);
const burst = posOf(screen, is, idB).length;
check(burst >= 25 && burst <= 30, `pos flood capped per second (${burst}/45 relayed)`);
A.send({ t: 'pos', x: 5, y: 4, dir: 'down', moving: true });
await screen.waitFor((m) => m.t === 'pos' && m.playerId === idA && m.x === 5);
const S2 = new Client('S2'); await S2.open(); S2.send({ t: 'hello', role: 'screen' });
const snap = await S2.waitFor((m) => m.t === 'pos' && m.playerId === idA);
await S2.waitFor((m) => m.t === 'pos' && m.playerId === idB);
const firstPos = S2.msgs.findIndex((m) => m.t === 'pos'), lastView = S2.msgs.findLastIndex((m) => m.t === 'view');
check(snap.x === 5 && snap.y === 4 && posOf(S2, 0, idB).length === 1 && lastView < firstPos, 'new screen gets view, then one pos per known player');
S2.ws.close();

// a phone dropped while its avatar walks in the room: the screen must see it stop (then it comes back to
// leave the evening, so the round below seats A and B only)
const W = new Client('W'); await W.open(); W.send({ t: 'hello', role: 'player', room });
i = W.mark(); W.send({ t: 'join', character: 'anna' });
const idW = (await W.waitFor((m) => m.t === 'welcome', i)).playerId;
W.send({ t: 'pos', x: 7, y: 6, dir: 'up', moving: true });
await screen.waitFor((m) => m.t === 'pos' && m.playerId === idW && m.moving === true);
is = screen.mark();
W.ws.close();
const stopped = await screen.waitFor((m) => m.t === 'pos' && m.playerId === idW, is).catch(() => null);
check(stopped?.moving === false && stopped.x === 7 && stopped.y === 6, "a dropped phone's walking avatar is stopped on the screen, where it stood");
const W2 = new Client('W2'); await W2.open();
i = W2.mark(); W2.send({ t: 'hello', role: 'player', playerId: idW });
await W2.waitFor((m) => m.t === 'welcome', i);
i = A.mark(); W2.send({ t: 'leave' });
await A.waitFor((m) => m.t === 'view' && !roomOf(m)?.players[idW], i);
W2.ws.close();

// --- startMinigame, ready, start: game master guard ---
let ia = A.mark(); ib = B.mark();
B.send({ t: 'startMinigame' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-gm', 'non-game-master startMinigame → err not-gm');
await sleep(250);
check(A.since(ia).length === 0, 'non-game-master startMinigame → no broadcast');
ib = B.mark(); B.send({ t: 'ready', on: true });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-playing', 'ready with no minigame running → err not-playing');

ia = A.mark(); ib = B.mark();
A.send({ t: 'startMinigame' });
const lobby0 = lobbyOf(await B.waitFor((m) => m.t === 'view' && !!lobbyOf(m), ib));
await A.waitFor((m) => m.t === 'view' && !!lobbyOf(m), ia);
check(lobby0.players.map((p: any) => p.id).join() === `${idA},${idB}` && lobby0.ready.length === 0,
  'game master startMinigame → the lobby, both eligible, nobody ready, broadcast');
ib = B.mark(); B.send({ t: 'start' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-gm', 'non-game-master start → err not-gm');
ia = A.mark(); A.send({ t: 'start' });
check((await A.waitFor((m) => m.t === 'err', ia)).code === 'refused', 'game master start with nobody ready → err refused');
A.send({ t: 'ready', on: true }); B.send({ t: 'ready', on: true });
await A.waitFor((m) => m.t === 'view' && lobbyOf(m)?.ready.length === 2);

ia = A.mark(); ib = B.mark();
A.send({ t: 'start' });
const v0 = blocksOf(await A.waitFor((m) => m.t === 'view', ia));
await B.waitFor((m) => m.t === 'view', ib);
check(v0.phase === 'playing', 'game master start → phase playing, broadcast');
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
const v1 = blocksOf(await B.waitFor((m) => m.t === 'view', ib));
check(v1.players[idA].hand[mv.piece] === null && v1.players[idA].score === PIECES[pid].cells.length, `legal place (${pid}) accepted, broadcast to other player, score += cells`);

// --- mid-game rejoin: kill A's socket, re-hello on a fresh connection ---
A.ws.close(); await sleep(100);
const A2 = new Client('A2'); await A2.open();
i = A2.mark(); A2.send({ t: 'hello', role: 'player', playerId: idA });
const w = await A2.waitFor((m) => m.t === 'welcome', i);
const rv = blocksOf(await A2.waitFor((m) => m.t === 'view', i));
check(w.playerId === idA && JSON.stringify(rv) === JSON.stringify(B.lastView()), 'rejoin after socket death → welcome(same id) + current view');
const afterWelcome = A2.since(i).slice(A2.since(i).indexOf(w) + 1)[0];
const ownPos = A2.since(i).filter((m) => m.t === 'pos');
check(afterWelcome?.t === 'pos' && ownPos.length === 1 && ownPos[0].playerId === idA && ownPos[0].x === 5 && ownPos[0].moving === false,
  'rejoin → own last pos right after welcome (stopped), and no one else\'s');
i = A2.mark(); ib = B.mark();
const mv2 = legalMoves(A2.lastView(), idA)[0];
A2.send({ t: 'place', ...mv2 });
await B.waitFor((m) => m.t === 'view', ib);
await A2.waitFor((m) => m.t === 'view', i);
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
i = X.mark(); X.send({ t: 'hello', role: 'player', room, playerId: 'p-nope' });
await X.waitFor((m) => m.t === 'view', i); await sleep(150);
check(!X.since(i).some((m) => m.t === 'welcome'), 'unknown playerId → no welcome (fresh client)');
i = X.mark(); X.send({ t: 'join', character: 'anna' });
// A1: a newcomer joins the EVENING mid-game and watches: welcomed, in the party, not seated in the game
const xw = await X.waitFor((m) => m.t === 'welcome' || m.t === 'err', i);
const xv = await X.waitFor((m) => m.t === 'view' && m.campaign?.party.players[xw.playerId], i);
check(xw.t === 'welcome' && !blocksOf(xv).players[xw.playerId] && xv.minigame.view.players.some((p: any) => p.id === xw.playerId),
  'join during playing → joins the evening and the lobby\'s list, watching the round (not seated)');
i = X.mark(); X.send({ t: 'leave' });
await X.waitFor((m) => m.t === 'view' && m.campaign.party.players[xw.playerId].left, i);
X.ws.close();

// --- play both to done ---
const nA = await playToDone(Acur, idA, B, rnd);
check(Acur.lastView().players[idA].done && Acur.lastView().phase === 'playing', `A stuck → done after ${nA} more moves, game still playing`);
i = Acur.mark();
Acur.send({ t: 'place', ...legalMoves({ ...Acur.lastView(), players: { [idA]: { ...Acur.lastView().players[idA], board: new Array(64).fill(0) } } }, idA)[0] });
check((await Acur.waitFor((m) => m.t === 'err', i)).code === 'bad-place', 'place by done player → err bad-place');
ib = B.mark();
B.send({ t: 'lobby' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-gm', 'back to the lobby while playing (non-game-master) → err');

const nB = await playToDone(B, idB, Acur, rnd);
const fin = Acur.lastView();
await screen.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished');
check(fin.phase === 'finished', `B done after ${nB} moves → phase finished (scores A=${fin.players[idA].score}, B=${fin.players[idB].score})`);
i = B.mark();
B.send({ t: 'place', piece: 0, x: 0, y: 0 });
check((await B.waitFor((m) => m.t === 'err', i)).code === 'not-playing', 'place in finished → err not-playing');

// --- lobby: podium → the lobby, its players ready, newcomers can join, start works again ---
ib = B.mark();
B.send({ t: 'lobby' });
check((await B.waitFor((m) => m.t === 'err', ib)).code === 'not-gm', 'non-game-master lobby → err not-gm');
i = B.mark(); B.send({ t: 'endMinigame' });
check((await B.waitFor((m) => m.t === 'err', i)).code === 'not-gm', 'non-game-master endMinigame → err not-gm');
ia = Acur.mark(); Acur.send({ t: 'endMinigame' });
check((await Acur.waitFor((m) => m.t === 'err', ia)).code === 'refused', 'game master endMinigame on the podium → err refused');
ia = Acur.mark(); ib = B.mark();
Acur.send({ t: 'lobby' });
const vnMsg = await B.waitFor((m) => m.t === 'view', ib);
const vn = lobbyOf(vnMsg);
await screen.waitFor((m) => m.t === 'view' && !!lobbyOf(m));
check(!!vn && gmOf(vnMsg) === idA && vn.players.map((p: any) => p.id).join() === `${idA},${idB}` && vn.ready.join() === `${idA},${idB}`,
  'game master lobby → the lobby, same players ready + game master, broadcast');
check(vn.players[0].character === 'pierre' && vn.players[1].character === 'sol', 'the lobby keeps each character');
const joinAfter = await (await fetch(`${HTTP}/api/join`)).json();
check(joinAfter.code === room, 'the lobby keeps the room code');
ia = Acur.mark();
Acur.send({ t: 'lobby' });
check((await Acur.waitFor((m) => m.t === 'err', ia)).code === 'refused', 'game master lobby outside the podium (the lobby) → err refused');
const N = new Client('N'); await N.open(); N.send({ t: 'hello', role: 'player', room });
i = N.mark(); N.send({ t: 'join', character: 'anna' });
const idN = (await N.waitFor((m) => m.t === 'welcome', i)).playerId;
await Acur.waitFor((m) => m.t === 'view' && lobbyOf(m)?.players.some((p: any) => p.id === idN));
check(Acur.lastLobby().players.map((p: any) => p.id).join() === `${idA},${idB},${idN}` && !Acur.lastLobby().ready.includes(idN),
  'a newcomer joins the lobby, not ready');
i = N.mark(); N.send({ t: 'start' });
check((await N.waitFor((m) => m.t === 'err', i)).code === 'not-gm', 'newcomer (non-game-master) start → err not-gm');
N.send({ t: 'ready', on: true });
await settled([N], [Acur]);
ia = Acur.mark();
Acur.send({ t: 'start' });
const vs = blocksOf(await Acur.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'playing', ia));
check(vs.order.length === 3 && vs.seed !== fin.seed, 'game master start from the lobby → playing with 3 players, new seed');
await Promise.all([N, B].map((c) => c.waitFor((m) => m.t === 'view' && blocksOf(m)?.seed === vs.seed)));
await playToDone(N, idN, Acur, rnd);
await playToDone(B, idB, Acur, rnd);
await playToDone(Acur, idA, B, rnd);
await B.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished');
check(B.lastView().phase === 'finished', 'second game played to the podium');
ib = B.mark(); N.send({ t: 'leave' });
const vLeft = await B.waitFor((m) => m.t === 'view' && !blocksOf(m)?.players[idN], ib);
check(!vLeft.minigame.view.players.some((p: any) => p.id === idN), 'leaving on the podium → off the podium and the lobby\'s list');
N.ws.close();

// --- Play again: back to the lobby, then start at once ---
ia = Acur.mark();
Acur.send({ t: 'lobby' });
await Acur.waitFor((m) => m.t === 'view' && !!lobbyOf(m), ia);
ia = Acur.mark(); ib = B.mark();
Acur.send({ t: 'start' });
const va = blocksOf(await B.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'playing', ib));
const pa = va.players[idA], pb = va.players[idB];
check(va.phase === 'playing' && va.seed !== seed1, `game master lobby + start → playing, new seed (${seed1} → ${va.seed})`);
check(va.order.join() === `${idA},${idB}` && pa.score === 0 && pb.score === 0 && pa.board.every((c: number) => c === 0) && !pa.done && !pb.done
  && JSON.stringify(pa.hand) === JSON.stringify(pb.hand), 'start again → same players, fresh boards/scores, identical new hand 0');

// --- leave mid-game: player stays, marked done; the other keeps playing ---
ia = Acur.mark();
B.send({ t: 'leave' });
const vm = blocksOf(await Acur.waitFor((m) => m.t === 'view', ia));
check(!!vm.players[idB] && vm.players[idB].done && vm.phase === 'playing', 'mid-game leave → player kept, done; game goes on');
ia = Acur.mark();
Acur.send({ t: 'place', ...legalMoves(vm, idA)[0] });
check((await Acur.waitFor((m) => m.t === 'view' || m.t === 'err', ia)).t === 'view', 'remaining player can still place');

// --- the end: endGame, the lobby, endMinigame → the room; the three finished rounds recorded then ---
ia = Acur.mark(); Acur.send({ t: 'endGame' });
await Acur.waitFor((m) => m.t === 'view' && m.minigame?.status === 'podium', ia);
ia = Acur.mark(); Acur.send({ t: 'lobby' });
const vl3 = await Acur.waitFor((m) => m.t === 'view' && !!lobbyOf(m), ia);
check(vl3.campaign.at.results.length === 3 && !vl3.campaign.facts.counters['blocks.played'], 'three finished rounds kept, nothing recorded yet');
ia = Acur.mark(); Acur.send({ t: 'endMinigame' });
const vEnd = await Acur.waitFor((m) => m.t === 'view' && m.minigame === null, ia);
check(!!roomOf(vEnd) && vEnd.campaign.facts.counters['blocks.played'] === 3 && vEnd.campaign.at.results.length === 0,
  'game master endMinigame → the room at the tableau, the three rounds recorded');

for (const c of [screen, Acur, B]) c.ws.close();
finish();
