// TV end-to-end (slice 2/2b, screen side): a real /screen/ page in headless Chrome (CDP), a real
// server this script kill -9s, and phones as WebSocket clients. Checks the minigame's lobby (who is ready,
// the last game), the room again after the game master ends it, auto-reconnect after a restart in every phase,
// presence dimming (debounced), screens never bumped, and the wake-from-sleep reconnect.
// ONLY=connection|campaign|quiz runs just that section (an unknown one is refused).
// Usage: start Chrome with --remote-debugging-port=<CDP>, then
//        PORT=3180 CDP=9222 [SHOTS=dir] node scripts/e2e-tv.mts       (never PORT 3131: the live server)
// SHOTS=<dir> saves screenshots, each with its visible text (<name>.txt).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnPoint } from '../shared/world.js';
import { SAMPLE_CONTENT } from '../shared/campaign/index.js';
import { PLAIN_LOBBY_START_POSITIONS } from '../shared/plain-lobby.js';

/** A node's title (the server runs the sample content). @param {string} id */
const C_TITLE = (id: string): string => SAMPLE_CONTENT.nodes[id].title;
import { backToLobby, blocksOf, cdpConnect, check, Client, endMinigame, finish, gmOf, HTTP, legalMoves, openPage, type Page, player as playerIn, quizOf, onlyPart, rejoin as rejoinIn, roomCode, roomOf, type Server, settled, sleep, SOCKET_PROBE, startRound, startServer, stop, TEARDOWN_PROBE } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
const CDP = process.env.CDP ?? '9222';
const SHOTS = process.env.SHOTS;
const ONLY = onlyPart(['connection', 'campaign', 'quiz']);
const VAR = mkdtempSync(join(tmpdir(), 'bloko-tv-'));

// ---------- server ----------
let server: Server | null = null;
const log = () => server?.log() ?? '';
const boot = async (fresh = false) => { server = await startServer(PORT, VAR, 'sample', { fresh, stdio: 'pipe' }); };
const kill9 = () => stop(server!.proc, 'SIGKILL');

// ---------- phones ----------
let room = '';
const player = (label: string, character: string) => playerIn(label, character, room);
const rejoin = (label: string, playerId: string) => rejoinIn(label, playerId, room);
const drop = async (c: Client) => { c.ws.close(); for (let k = 0; k < 100 && !c.closed; k++) await sleep(10); };

/** The block game the TV shows: the running minigame's round (null in its lobby, or while none runs). */
const tvState = 'window.bloko.minigame()?.view.round';
/** The TV shows the room at a tableau: no minigame running, a minigame's tableau, the party room under the band. */
const tvRoom = "(window.bloko?.minigame() === null && !!window.bloko.campaign()?.at.kind && document.body.classList.contains('party') && !!document.querySelector('section.lobby'))";
/** The TV shows the running minigame's lobby. */
const tvLobby = "(window.bloko?.minigame()?.status === 'lobby' && !!document.querySelector('section.minigame-lobby'))";
/** The lobby's players in the TV's panel, as "<name>:<ready line>". */
const tvLobbyPlayers = `JSON.stringify([...document.querySelectorAll('.minigame-lobby-players li')].map((f) => f.querySelector('.minigame-lobby-name').textContent.trim() + ':' + f.querySelector('.minigame-lobby-ready').textContent))`;
const tvOnlineBanner = "document.body.classList.contains('offline')";
const tvOffline = 'JSON.stringify(window.bloko.offline().sort())';
/** Records the frequency each of the TV's tones starts at (public/screen/audio.js), to hear which sounds played. */
const SOUND_PROBE = `(() => {
  const set = AudioParam.prototype.setValueAtTime;
  window.__tones = [];
  AudioParam.prototype.setValueAtTime = function (v, t) { if (v > 20) window.__tones.push(Math.round(v)); return set.call(this, v, t); };
})()`;
/** How many times the TV played the "joined" sound (sfx.joined: two notes, 784 then 1175 Hz). */
const tvJoined = 'window.__tones.filter((f, k, all) => f === 784 && all[k + 1] === 1175).length';
/** A key press on the TV unlocks its sound (a page load locks it again). */
async function soundOn(tv: Page): Promise<boolean> {
  for (const type of ['keyDown', 'keyUp']) await tv.command('Input.dispatchKeyEvent', { type, key: 'a' });
  return tv.waitFor(`document.getElementById('sound-hint').dataset.state === 'on'`);
}
const boardsOf = (s: any) => JSON.stringify(s.order.map((id: string) => [id, s.players[id].board, s.players[id].score, s.players[id].hand]));


/** kill -9 in the room at a tableau, check the TV shows the banner, restart, check the same room comes back. */
async function killAndBackRoom(tv: Page): Promise<void> {
  const partyJs = 'JSON.stringify(window.bloko.campaign().party)';
  const before = await tv.ev(partyJs);
  await kill9();
  check(await tv.waitFor(tvOnlineBanner), 'room: kill -9 → TV shows the "Connecting…" banner');
  await tv.shot('kill-lobby-banner');
  await boot();
  check(await tv.waitFor(`!${tvOnlineBanner}`, 6000), 'room: restart → TV reconnects by itself, banner gone');
  check(await tv.waitFor(tvRoom) && await tv.ev(partyJs) === before,
    'room: the room at the tableau again, same party and game master after the restart');
}

/** The game master the TV's campaign view names (the player holding Pierre), or null. */
const tvGm = async (tv: Page): Promise<string | null> =>
  gmOf({ campaign: JSON.parse(await tv.ev('JSON.stringify(window.bloko.campaign() ?? null)')) });

/** kill -9, check the TV shows the banner, restart, check it comes back with the same game. */
async function killAndBack(tv: Page, phase: string, ref: Client): Promise<void> {
  // the TV must have caught up with the last move before the snapshot (views race the kill)
  const want = boardsOf(ref.lastView());
  await tv.waitFor(`(() => { const s = window.bloko.minigame()?.view.round; return !!s && JSON.stringify(s.order.map((id) => [id, s.players[id].board, s.players[id].score, s.players[id].hand])) === ${JSON.stringify(want)}; })()`);
  const before = await tv.ev(`JSON.stringify(${tvState})`);
  const gmBefore = await tvGm(tv);
  await kill9();
  check(await tv.waitFor(tvOnlineBanner), `${phase}: kill -9 → TV shows the "Connecting…" banner`);
  await tv.shot(`kill-${phase}-banner`);
  await boot();
  const t0 = Date.now();
  const back = await tv.waitFor(`!${tvOnlineBanner}`, 6000);
  console.log(`      (${phase}: TV back ${Date.now() - t0} ms after the server answered)`);
  check(back, `${phase}: restart → TV reconnects by itself, banner gone`);
  await tv.waitFor(`(() => { const s = window.bloko.minigame()?.view.round; return s?.phase === ${JSON.stringify(phase)} && JSON.stringify(s.order.map((id) => [id, s.players[id].board, s.players[id].score, s.players[id].hand])) === ${JSON.stringify(want)}; })()`);
  const after = await tv.ev(`JSON.stringify(${tvState})`);
  const gmAfter = await tvGm(tv);
  const a = JSON.parse(after), b = JSON.parse(before);
  const same = a.phase === phase && boardsOf(a) === boardsOf(b) && gmAfter === gmBefore && gmAfter !== null;
  if (!same) {
    const diff = a.order.map((id: string) => `${id}: score ${b.players[id]?.score}→${a.players[id]?.score} hand ${JSON.stringify(b.players[id]?.hand)}→${JSON.stringify(a.players[id]?.hand)} done ${b.players[id]?.done}→${a.players[id]?.done}`);
    console.log(`      diff: phase ${b.phase}→${a.phase} game master ${gmBefore}→${gmAfter} seed ${b.seed}→${a.seed} | ${diff.join(' | ')}`);
  }
  check(same, `${phase}: same phase, boards/scores/hands, game master after the restart`);
}

let cdp: Awaited<ReturnType<typeof cdpConnect>> | null = null;
/** A TV: the /screen/ page, its own device, with the teardown, sound and socket probes. */
async function openTv(label: string): Promise<Page> {
  const p = await openPage(cdp!, label, false, () => SHOTS, [TEARDOWN_PROBE, SOUND_PROBE, SOCKET_PROBE]);
  await p.goto(`${HTTP}/screen/`);
  return p;
}
/** Marks the TV's socket, then waits until the TV has opened another one (it gave up on the marked one). */
const markSocket = (tv: Page) => tv.ev('window.__ws.__marked = true');
const newSocket = (tv: Page, ms: number) => tv.waitFor('!window.__ws.__marked', ms);

let tv: Page | null = null, tv2: Page | null = null;
try {
  await boot(true);
  room = await roomCode();
  cdp = await cdpConnect(CDP);
  tv = await openTv('tv');
  check(await tv.waitFor(`${tvRoom} && !${tvOnlineBanner}`, 8000), 'TV opens on the room at the false start');
  check(await soundOn(tv), 'a key press turns the TV\'s sound on');

  const cardOn = `!document.querySelector('.join-qr-card').hidden`;
  const noOverlap = (sel: string) => `(() => { const c = document.querySelector('.join-qr-card').getBoundingClientRect();
    return [...document.querySelectorAll('${sel}')].every((e) => { const r = e.getBoundingClientRect(); return r.right <= c.left || r.bottom <= c.top || r.left >= c.right || r.top >= c.bottom; }); })()`;

  // ---------- lobby, avatars, presence ----------
  const { c: A, id: idA } = await player('A', 'pierre'); // the game master
  check(await tv.waitFor(`${tvJoined} === 1`), 'the first guest arriving in the room gets the "joined" sound');
  if (SHOTS) { // the evening's first screen, with its first guest
    await tv.waitFor('window.bloko.avatars().length === 1');
    await tv.shot('start-room');
  }
  let { c: B } = await player('B', 'sol'); const idB = B.id!;
  check(await tv.waitFor(`${tvJoined} === 2`), '…and so does the second');
  let A2 = A;
  let N: Client | undefined, E: Client | undefined;
  let i = 0;

  if (!ONLY || ONLY === 'connection') {
  check(await tv.waitFor('window.bloko.avatars().length === 2'), 'two guests → two avatars in the party room');
  await drop(B);
  await sleep(1200);
  check(await tv.ev(tvOffline) === '[]', 'lobby drop: not tagged yet within the 2 s grace');
  check(await tv.waitFor(`${tvOffline} === ${JSON.stringify(JSON.stringify([idB]))}`, 3000), 'lobby drop: tagged offline after ~2 s');
  check(await tv.ev(`window.bloko.avatars().find((a) => a.id === '${idB}').offline === true`), "…the dropped guest's avatar is dimmed");
  await tv.shot('lobby-offline');
  B = (await player('B2', 'sol')).c;
  check(await tv.waitFor(`${tvOffline} === '[]'`, 1500), 'reclaim → back to normal at once');
  // blip: drop + back within 1 s → never tagged
  let flicker = false;
  await drop(B);
  const watch = (async () => { const end = Date.now() + 3500; while (Date.now() < end) { if ((await tv!.ev(tvOffline)) !== '[]') flicker = true; await sleep(50); } })();
  await sleep(700);
  B = await rejoin('B3', idB);
  await watch;
  check(!flicker, 'reconnect blip (0.7 s) → the offline tag never flickers');

  // ---------- screens are never bumped ----------
  tv2 = await openTv('tv2');
  await tv2.waitFor(tvRoom);
  const B4 = await rejoin('B4', idB); // bumps B3 (replaced) — the TVs must not care
  await B.waitFor((m) => m.t === 'replaced');
  await sleep(300);
  check(!(await tv.ev(tvOnlineBanner)) && !(await tv2.ev(tvOnlineBanner)), 'a phone bump (replaced) leaves both TVs connected');
  await tv2.close(); tv2 = null;
  check(await tv.waitFor("document.visibilityState === 'visible'", 2000), 'TV tab is visible again (test setup)');
  B = B4;

  // ---------- kill -9 in the room ----------
  const joinedBeforeKill = await tv.ev(tvJoined);
  await killAndBackRoom(tv);
  A2 = await rejoin('A2', idA); B = await rejoin('B5', idB);
  const spawnOk = async () => tv!.ev(`JSON.stringify(window.bloko.avatars().map((a) => [a.id, Math.round(a.x * 10), Math.round(a.y * 10)]))`);
  const exp = JSON.stringify([[idA, Math.round(spawnPoint('pierre').x * 10), Math.round(spawnPoint('pierre').y * 10)], [idB, Math.round(spawnPoint('sol').x * 10), Math.round(spawnPoint('sol').y * 10)]]);
  await tv.waitFor(`window.bloko.avatars().length === 2`);
  await sleep(500);
  check((await spawnOk()) === exp, 'lobby restart: avatars back, at their spawn points');
  check(await tv.ev(tvJoined) === joinedBeforeKill, '…with no "joined" sound: the guests coming back are not newcomers');

  // ---------- Contract G: depth — the avatar goes behind or in front of the furniture ----------
  // `drawOrder()` is the ids painted this frame, back to front; an avatar listed BEFORE a prop is
  // drawn behind it. Everything is derived from `scene()` so nudging the furniture cannot quietly
  // turn this into a test of nothing.
  {
    const scene = JSON.parse(await tv.ev('JSON.stringify(window.bloko.scene())'));
    const propOf = (id: string) => scene.props.find((p: any) => p.id === id);
    const table = propOf('table');
    check(!!table?.solid && typeof table.anchorY === 'number' && scene.id === 'party-room'
      && ['sofa', 'table', 'plant'].every((id) => !!propOf(id)),
      `TV exposes the room: floor, colliders and the three props with their anchors (${JSON.stringify(scene.props?.map((p: any) => [p.id, p.anchorY, p.layer]))})`);

    const tx = table.solid.x + table.solid.w / 2;      // straight at the table
    const behindY = table.anchorY - 1;                 // feet above its floor contact → behind it
    const frontY = table.anchorY + 0.6;                // feet below it → in front of it
    // the door rugs stop at y 5.9 and a `pos` inside one would enter that node, ending the lobby
    check(behindY > 6, `the depth check stays clear of the door rugs (behindY=${behindY})`);

    const order = async (): Promise<string[]> => JSON.parse(await tv!.ev('JSON.stringify(window.bloko.drawOrder())'));
    /** Put A's avatar at (tx, y) and wait for the TV's eased avatar to actually arrive there. */
    const stand = async (y: number) => {
      A2.send({ t: 'pos', x: tx, y, dir: 'down', moving: false });
      return tv!.waitFor(`(() => { const a = window.bloko.avatars().find((a) => a.id === '${idA}'); return !!a && Math.abs(a.x - ${tx}) < 0.05 && Math.abs(a.y - ${y}) < 0.05; })()`);
    };

    check(await stand(behindY), 'the avatar walks up behind the table (TV eased it into place)');
    const back = await order();
    check(back.indexOf(idA) >= 0 && back.indexOf('table') >= 0 && back.indexOf(idA) < back.indexOf('table'),
      `standing above the table's anchor → the avatar is drawn BEHIND it (${back.join(' → ')})`);
    check(back.indexOf(idA) > back.indexOf('sofa') && back.indexOf(idA) > back.indexOf('plant'),
      `…and still in front of the sofa and the plant, whose anchors are higher up the room (${back.join(' → ')})`);

    check(await stand(frontY), 'the avatar walks back down in front of the table');
    const front = await order();
    check(front.indexOf(idA) > front.indexOf('table'),
      `standing below the table's anchor → the avatar is drawn IN FRONT of it (${front.join(' → ')})`);

    // the other avatar never moved, so the two must have swapped around the table and nothing else
    check(front.length === back.length && new Set(front).size === front.length
      && ['sofa', 'table', 'plant', idA, idB].every((id) => front.includes(id)),
      `the draw list holds every prop and every avatar exactly once (${front.join(' → ')})`);
    await tv.shot('hub-depth-front');

    // a speech bubble and an emote over the avatars: screenshot only, since window.bloko exposes
    // neither (they live inside the party room's drawing)
    const a = A2.mark(), b = B.mark();
    A2.send({ t: 'say', text: 'Joyeux anniversaire !' });
    B.send({ t: 'emote', kind: 'victory' });
    await A2.waitFor((m) => m.t === 'say', a);
    await B.waitFor((m) => m.t === 'emote', b);
    if (SHOTS) await sleep(400); // the TV got both with the phones: a few frames to draw them
    await tv.shot('lobby-say-emote');
  }

  // ---------- the block game's lobby: who is ready, Start waits ----------
  i = A2.mark(); A2.send({ t: 'startMinigame' });
  await A2.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby', i);
  check(await tv.waitFor(`${tvLobby} && document.querySelector('.minigame-lobby-title')?.textContent === 'Block game'`),
    'the game master starts the block game → the TV shows its lobby');
  check(await tv.waitFor(`${tvLobbyPlayers} === ${JSON.stringify(JSON.stringify(['Pierre:not ready', 'Sol:not ready']))}`),
    `…the eligible players listed, each "not ready" (${await tv.ev(tvLobbyPlayers)})`);
  // the lobby is walkable: its players are drawn as their characters, placed on the plain lobby's first start positions
  const firstStarts = JSON.stringify(PLAIN_LOBBY_START_POSITIONS.slice(0, 2).map((p) => [p.x, p.y]));
  const lobbyWalkers = `JSON.stringify(window.bloko.avatars().filter((a) => a.drawnAs === 'character').map((a) => [Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10]).sort((p, q) => p[0] - q[0]))`;
  check(await tv.waitFor(`${lobbyWalkers} === ${JSON.stringify(firstStarts)}`),
    `…walking the lobby as their characters, from its start positions (${await tv.ev(lobbyWalkers)})`);
  i = A2.mark(); B.send({ t: 'ready', on: true });
  await A2.waitFor((m) => m.t === 'view' && m.minigame?.view.ready.length === 1, i);
  check(await tv.waitFor(`${tvLobbyPlayers} === ${JSON.stringify(JSON.stringify(['Pierre:not ready', 'Sol:✓ ready']))}`)
    && await tv.waitFor(`(document.querySelector('.minigame-lobby-status')?.textContent ?? '').includes('Pierre can start (1/2)')`),
    'Sol is ready → "✓ ready" under Sol, "Pierre can start (1/2)"');
  check(await tv.waitFor(`${tvJoined} === ${joinedBeforeKill + 1}`), '…with a sound');
  await tv.shot('minigame-lobby');

  // ---------- playing: presence on boards, kill -9 ----------
  await startRound(A2, [A2, B]);
  check(await tv.waitFor(`${tvState}?.phase === 'playing'`), 'TV shows the game');

  // ---------- "show the QR again": any player asks → side card on the TVs, never over a board ----------
  // (the window's rules: test/join-qr.test.js; the server's: the presence suite)
  const qrMark = B.mark();
  B.send({ t: 'showJoin', requestId: 1 }); // not the game master
  const joinAck = await B.waitFor((m) => m.t === 'joinQrAck' && m.requestId === 1, qrMark);
  const code = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  check(await tv.waitFor(`${cardOn} && document.querySelector('.join-qr-code')?.textContent === ${JSON.stringify(code)} && !!document.querySelector('.join-qr-img')?.getAttribute('src')`),
    `a player asks → the TV shows the join card mid-game, with the QR and the room code (${code})`);
  check(await tv.waitFor(noOverlap('.board-wrap')), '…and the boards make room: no board under the card');
  await tv.shot('join-qr-game');
  B.send({ t: 'hideJoin', token: joinAck.token, requestId: 2 }); // closed again for what follows
  await tv.waitFor(`!${cardOn}`, 2000);
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] }); await B.waitFor((m) => m.t === 'view', i);
  await drop(B);
  check(await tv.waitFor(`document.querySelector('.panel[data-id="${idB}"]')?.classList.contains('is-offline')`, 3500),
    "mid-game drop → that player's board is dimmed + tagged");
  check(!(await tv.ev(`document.querySelector('.panel[data-id="${idA}"]').classList.contains('is-offline')`)), '…the online player is not');
  const tag = await tv.ev(`getComputedStyle(document.querySelector('.panel[data-id="${idB}"] .panel-head'), '::after').content`);
  check(String(tag).includes('offline'), `…with the "offline" tag (${tag})`);
  await tv.shot('playing-offline');
  B = (await player('B6', 'sol')).c;
  check(await tv.waitFor(`!document.querySelector('.panel[data-id="${idB}"]').classList.contains('is-offline')`, 1500), 'reclaim mid-game → board back to normal');
  i = A2.mark(); B.send({ t: 'place', ...legalMoves(B.lastView(), idB)[0] }); await A2.waitFor((m) => m.t === 'view', i);
  await killAndBack(tv, 'playing', A2);
  check(await tv.waitFor(`document.querySelectorAll('.panel.is-offline').length === 2`, 3500),
    'after a restart, nobody reconnected yet → both boards tagged offline (true: online is empty)');
  A2 = await rejoin('A3', idA); B = await rejoin('B7', idB);
  check(await tv.waitFor(`document.querySelectorAll('.panel.is-offline').length === 0`), 'phones reconnect → tags clear');

  // ---------- wake from sleep: JS paused 6 s (timers stop, wall time runs) ----------
  await markSocket(tv);
  await tv.command('Debugger.enable');
  await tv.command('Debugger.pause');
  await sleep(6000);
  await tv.command('Debugger.resume');
  check(await newSocket(tv, 3000), 'wake after a 6 s freeze → TV drops the old socket and reconnects');
  check(await tv.waitFor(`!${tvOnlineBanner}`), '…and is live again');
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] });
  const sc = blocksOf(await B.waitFor((m) => m.t === 'view', i)).players[idA].score;
  check(await tv.waitFor(`${tvState}.players['${idA}'].score === ${sc}`), 'a move after the wake reaches the TV');

  // ---------- silent socket (half-open): SIGSTOP the server, TCP stays up but nothing arrives ----------
  const t0 = A2.ticks.length;
  for (let k = 0; k < 120 && A2.ticks.length === t0; k++) await sleep(100);
  const tk = A2.ticks.at(-1);
  check(A2.ticks.length > t0 && typeof tk?.now === 'number' && Math.abs(tk.now - Date.now()) < 2000, "server sends {t:'tick', now} to every socket, at least every 10 s");
  await markSocket(tv);
  const stoppedAt = Date.now();
  server!.proc.kill('SIGSTOP');
  await newSocket(tv, 36_000);
  const silentAfter = Date.now() - stoppedAt;
  check(silentAfter <= 26_000, `silent socket → TV gives up on it by itself (${Math.round(silentAfter / 1000)} s after the server froze; ≤ 25 s of silence)`);
  server!.proc.kill('SIGCONT');
  check(await tv.waitFor(`!${tvOnlineBanner}`, 8000), '…server back → TV live again');
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] });
  const sc2 = blocksOf(await B.waitFor((m) => m.t === 'view', i)).players[idA].score;
  check(await tv.waitFor(`${tvState}.players['${idA}'].score === ${sc2}`), '…and the next move reaches it');

  // ---------- game master controls: retire shows "Out", endGame shows the podium with its line ----------
  i = A2.mark(); A2.send({ t: 'retire', target: idB });
  await A2.waitFor((m) => m.t === 'view' && blocksOf(m)?.players[idB].retired, i);
  check(await tv.waitFor(`document.querySelector('.panel[data-id="${idB}"] .done-overlay')?.textContent.includes('Out')`),
    'the game master retires a player → their board shows "🚪 Out" on the TV');
  await tv.shot('retired');
  i = A2.mark(); A2.send({ t: 'endGame' });
  await A2.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished', i);
  check(await tv.waitFor(`${tvState}?.phase === 'finished' && !!document.querySelector('.podium-ending')?.textContent`),
    'the game master ends the game → TV podium says how it ended');
  check(await tv.ev(`[...document.querySelectorAll('.rank-row')].some((r) => r.textContent.includes('Sol') && r.querySelector('.out-tag'))`),
    '…and the retired player is ranked with an "out" tag');
  if (SHOTS) await sleep(4000);
  await tv.shot('podium-gm');
  await killAndBack(tv, 'finished', A2);
  A2 = await rejoin('A4', idA); B = await rejoin('B8', idB);

  // ---------- back to the lobby (the last game's winner), then the end: back to the party room, newcomer appears ----------
  const lobbyAgain = await backToLobby(A2);
  check(await tv.waitFor(`${tvLobby} && /Last game/.test(document.querySelector('.minigame-lobby-panel')?.textContent ?? '')`),
    'Back to the lobby → the TV\'s lobby again, with the last game');
  const winners = lobbyAgain.campaign.at.results.at(-1).ranking.filter((r: any) => r.rank === 1).map((r: any) => r.character);
  const big = await tv.ev(`document.querySelector('.minigame-lobby-big')?.textContent ?? ''`);
  check(winners.length > 0 && winners.every((ch: string) => big.includes(ch === 'pierre' ? 'Pierre' : 'Sol')) && big.startsWith('🥇'),
    `…its winner (${big}), from the round's result`);
  check(await tv.waitFor(`${tvLobbyPlayers} === ${JSON.stringify(JSON.stringify(['Pierre:✓ ready', 'Sol:not ready']))}`),
    `…Pierre back ready, Sol (taken out) not (${await tv.ev(tvLobbyPlayers)})`);
  await tv.shot('lobby-last-game');
  await endMinigame(A2);
  check(await tv.waitFor(`${tvRoom} && !document.getElementById('party-bg').hidden`),
    'the game master ends the block game → TV back in the party room');
  check(await tv.waitFor('window.bloko.avatars().length === 2'), '…with both avatars');
  A2.send({ t: 'pos', x: 6, y: 6, dir: 'left', moving: false });
  check(await tv.waitFor(`(() => { const a = window.bloko.avatars().find((a) => a.id === '${idA}'); return a && Math.abs(a.x - 6) < 0.2; })()`),
    '…and avatars resume walking (pos relayed)');
  const joinedBefore = await tv.ev(tvJoined);
  N = (await player('N', 'anna')).c; const idN = N.id!;
  check(await tv.waitFor(`window.bloko.avatars().some((a) => a.id === '${idN}') && document.querySelector('.lobby-count').textContent.includes('3/')`),
    'a newcomer joins after the end and appears on the TV');
  check(await tv.waitFor(`${tvJoined} === ${joinedBefore + 1}`), '…with the "joined" sound, once');
  await tv.shot('newgame-lobby');

  } // connection

  if (!ONLY || ONLY === 'campaign' || ONLY === 'quiz') {
  if (!N) N = (await player('N', 'anna')).c;

  const doorsJs = `JSON.stringify(Object.fromEntries(window.bloko.doors().map((d) => [d.id, d.state])))`;

  if (!ONLY || ONLY === 'campaign') {
  // ---------- campaign: hub map with doors, combined unlock cutscene, two TVs, chooser walks in ----------
  const cv = () => [...A2.msgs].reverse().find((m) => m.t === 'view')?.campaign;
  i = A2.mark(); A2.send({ t: 'back' });
  const hubView = await A2.waitFor((m) => m.t === 'view' && blocksOf(m) === null, i);
  check(await tv.waitFor(`window.bloko.minigame() === null && !!document.querySelector('.map-band') && !document.getElementById('party-bg').hidden && window.bloko.avatars().length === 3`),
    `back to the hub (state null, at ${hubView.campaign?.at?.node}) → TV shows the map in the party room, every avatar there`);
  const d0 = JSON.parse(await tv.ev(doorsJs));
  check(d0['hub.false-start'] === 'open' && d0.childhood === 'locked' && d0.teens === 'locked' && d0.adult === 'locked',
    `hub doors: false start open, the worlds locked (${JSON.stringify(d0)})`);
  check(!!(await tv.ev('window.bloko.contentVersion()')), 'TV loaded the content from /api/content (versioned)');
  await tv.shot('hub-map-locked');

  // play the false start until the 3rd game unlocks the worlds; a second TV is open for the last one
  i = A2.mark(); A2.send({ t: 'enter', node: 'hub.false-start' });
  await A2.waitFor((m) => m.t === 'view' && !!roomOf(m), i);
  tv2 = await openTv('tv2'); // its own device: BOTH TVs visible, both play
  await tv2.waitFor(tvRoom);
  check(await tv.ev("document.visibilityState === 'visible'") && await tv2.ev("document.visibilityState === 'visible'"), 'two TVs, both visible (separate devices)');
  // three rounds in one run of the block game: the results reach the main game when the game master ends it
  const played = (A2.last()?.campaign?.facts.counters['blocks.played'] ?? 0) as number;
  for (let g = 0; g < 3; g++) {
    if (g > 0) await backToLobby(A2);
    await startRound(A2, [A2]);
    i = A2.mark(); A2.send({ t: 'endGame' }); await A2.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished', i);
  }
  await backToLobby(A2);
  check((cv()?.news ?? []).length === 0 && cv().at.results.length === 3 && cv().facts.counters['blocks.played'] === played,
    `three rounds in the lobby: kept as results, nothing recorded yet (${cv().at.results.length} results)`);
  await sleep(1000);
  check(!(await tv.ev('window.bloko.cutscene().playing')), '…and no cutscene while the block game runs');
  await endMinigame(A2);
  const pending = cv()?.news ?? [];
  check(pending.length > 0 && cv().facts.counters['blocks.played'] === played + 3, `the game master ends it → the three rounds recorded, news queued (${pending.length} entries, seq ${pending[0]?.seq}…${pending.at(-1)?.seq})`);
  check(await tv.waitFor(`window.bloko.cutscene().playing`, 12000), 'back in the room → ONE combined moment');
  const csText = await tv.ev('window.bloko.cutscene().text');
  check(csText.includes(C_TITLE('childhood')) && csText.includes(C_TITLE('teens')) && csText.includes(`Élodie gets ${SAMPLE_CONTENT.items['old-key'].icon} ${SAMPLE_CONTENT.items['old-key'].name}`), `…naming both worlds and who got what (${csText})`);
  if (SHOTS) await sleep(1500);
  await tv.shot('cutscene');
  for (let k = 0; k < 150 && (cv()?.news ?? []).length; k++) await sleep(100);
  check((cv()?.news ?? []).length === 0, 'after the moment, an ack clears the news on the server');
  await sleep(2500);
  const c1 = await tv.ev('window.bloko.cutscene()'), c2 = await tv2.ev('window.bloko.cutscene()');
  check(c1.moments === 1 && c2.moments === 1 && !c1.playing && !c2.playing, `both TVs played the moment exactly once, no replay (TV1 ${c1.moments}, TV2 ${c2.moments})`);
  // usually one TV acks and the other sees it land (a random delay each, cutscenes.js); under load both may
  check(c1.acks + c2.acks >= 1 && c1.acks <= 1 && c2.acks <= 1, `the moment was acked, at most once per TV (TV1 ${c1.acks}, TV2 ${c2.acks})`);
  const ackTv = new Client('ack-tv'); await ackTv.open(); ackTv.send({ t: 'hello', role: 'screen' });
  await ackTv.waitFor((m) => m.t === 'view');
  const evening = JSON.stringify(cv());
  i = A2.mark(); ackTv.send({ t: 'ack', upTo: pending.at(-1)?.seq });
  await settled([ackTv], [A2]);
  check(!A2.since(i).some((m) => m.t === 'view') && JSON.stringify(cv()) === evening,
    'another ack of the same news changes nothing on the server (no view, news and newsSeq kept)');
  ackTv.ws.close();
  check(c1.maxShown === pending.at(-1)?.seq && c2.maxShown === pending.at(-1)?.seq, `both remember the last seq shown (${c1.maxShown}, ${c2.maxShown})`);
  await tv2.close(); tv2 = null;

  // back on the hub: the new doors glow
  i = A2.mark(); A2.send({ t: 'back' });
  await A2.waitFor((m) => m.t === 'view' && blocksOf(m) === null, i);
  check(await tv.waitFor(`${doorsJs} === ${JSON.stringify(JSON.stringify({ 'hub.false-start': 'done', childhood: 'new', teens: 'new', adult: 'locked' }))}`),
    'hub doors: false start done ★, both worlds NEW (glowing), the third still locked');
  check(await tv.ev(`!document.querySelector('.map-bags')`), "the key is Élodie's, and she isn't here yet: no bag in the band");
  if (SHOTS) await sleep(600);
  await tv.shot('hub-map-new');

  // the chooser (Élodie) joins and walks into the childhood door → the TV switches to that world
  E = (await player('E', 'elodie')).c;
  await tv.waitFor('window.bloko.avatars().length === 4');
  check(await tv.waitFor(`[...document.querySelectorAll('.map-bag')].some((b) => b.textContent.includes('Élodie') && b.querySelector('[data-item="old-key"]'))`),
    "Élodie joins → the band shows her item icons (🗝️), the inventory hung on her character");
  E.send({ t: 'pos', x: 8, y: 8, dir: 'up', moving: true });
  await sleep(150);
  const cd = SAMPLE_CONTENT.nodes.childhood.door!;
  E.send({ t: 'pos', x: cd.x + cd.w / 2, y: cd.y + cd.h / 2, dir: 'up', moving: true });
  check(await tv.waitFor(`window.bloko.campaign()?.at.node === 'childhood' && document.querySelector('.map-title')?.textContent === ${JSON.stringify(C_TITLE('childhood'))}`),
    'Élodie walks into the childhood door → TV switches to that world');
  const dw = JSON.parse(await tv.ev(doorsJs));
  check(dw['childhood.blocks'] === 'new' && dw['childhood.scene'] === 'new', `world doors: its two tableaux, new (${JSON.stringify(dw)})`);
  if (SHOTS) await sleep(600);
  await tv.shot('world-map');

  } else {
    i = A2.mark();
    A2.send({ t: 'gm', op: { op: 'unlock', node: 'childhood' } });
    A2.send({ t: 'gm', op: { op: 'goto', node: 'childhood' } });
    await A2.waitFor((m) => m.t === 'view' && m.campaign?.at.node === 'childhood', i);
    E = (await player('E', 'elodie')).c;
  }

  if (!ONLY || ONLY === 'quiz') {
  // ---------- quiz: World 1's block game opens its quiz door; the room → questions → reveals → podium ----------
  const lastQuiz = (c: Client) => quizOf([...c.msgs].reverse().find((m) => m.t === 'view'));
  i = A2.mark(); A2.send({ t: 'enter', node: 'childhood.blocks' });
  await A2.waitFor((m) => m.t === 'view' && !!roomOf(m), i);
  await startRound(A2, [A2]);
  i = A2.mark(); A2.send({ t: 'endGame' }); await A2.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished', i);
  // Back from the podium ends the block game first, recording its finished round
  i = A2.mark(); A2.send({ t: 'back' }); await A2.waitFor((m) => m.t === 'view' && !m.minigame && m.campaign?.at.node === 'childhood', i);
  check(await tv.waitFor(`JSON.parse(${doorsJs})['childhood.quiz'] !== 'locked'`), "World 1's block game done, Back from its podium → its quiz door opens");
  // teardown: on the map, nothing of the block game's screen runs (its timers, loops, listeners, markup)
  const blockLeft = `[...window.__live(['blocks-screen.js', 'countdown.js', 'game-view.js']), ...(document.querySelector('.arena, #countdown') ? ['its markup'] : [])]`;
  await tv.waitFor(`${blockLeft}.length === 0`, 3000, blockLeft);
  const left = await tv.ev(blockLeft);
  check(left.length === 0, `teardown: block game → the map leaves nothing of the block screen running (${JSON.stringify(left)})`);
  i = A2.mark(); A2.send({ t: 'enter', node: 'childhood.quiz' });
  const ql = await A2.waitFor((m) => m.t === 'view' && !!roomOf(m) && m.campaign.at.kind === 'quiz', i);
  check(await tv.waitFor(`document.querySelector('.lobby .title')?.textContent === 'Quiz!' && document.body.classList.contains('party')
    && !document.getElementById('party-bg').hidden && window.bloko.avatars().length === ${roomOf(ql).order.length}`),
    `the room at the quiz tableau on the TV: the party room with the "Quiz!" band and the ${roomOf(ql).order.length} players' avatars`);
  check(await tv.ev(`!!document.querySelector('.lobby .join-qr') && document.querySelector('.lobby-count')?.textContent.includes('${roomOf(ql).order.length}/')`), '…the join QR and who\'s in');
  A2.send({ t: 'pos', x: 9, y: 6, dir: 'right', moving: false });
  check(await tv.waitFor(`(() => { const a = window.bloko.avatars().find((a) => a.id === '${idA}'); return a && Math.abs(a.x - 9) < 0.2; })()`),
    '…and avatars walk there (pos relayed)');
  await tv.waitFor('!window.bloko.cutscene().playing', 12000); // the quiz door's unlock moment plays here first
  if (SHOTS) await sleep(600);
  await tv.shot('quiz-room');

  const phones = [A2, B, N, E!];
  const seated: string[] = roomOf(ql).order; // everyone in the room gets ready
  const phoneOf = (id: string) => phones.find((c) => [...c.msgs].some((m) => m.t === 'welcome' && m.playerId === id));
  i = A2.mark(); A2.send({ t: 'startMinigame' });
  await A2.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby', i);
  check(await tv.waitFor(`${tvLobby} && document.querySelector('.minigame-lobby-title')?.textContent === 'Quiz'`)
    && /questions · \d+ s each/.test(await tv.ev(`document.querySelector('.minigame-lobby-big')?.textContent ?? ''`)),
    'the game master starts the quiz → its lobby on the TV, with the quiz settings summary');
  await tv.shot('quiz-lobby');
  i = A2.mark();
  const firstRound = await startRound(A2, seated.map((id) => phoneOf(id)!));
  let qv = quizOf(firstRound.t === 'view' && quizOf(firstRound)?.phase === 'question' ? firstRound
    : await A2.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'question', i));
  let rounds = 0, anecdotes = 0;
  while (qv?.phase === 'question' && rounds < 12) {
    rounds++;
    const choice = !!qv.round.question.choices;
    check(await tv.waitFor(`!!document.querySelector('.quiz-question') && document.querySelector('.quiz-q')?.textContent === ${JSON.stringify(qv.round.question.q)}`),
      `Q${rounds}: the question on the TV (${choice ? 'A–D tiles' : 'typed answer'})`);
    if (rounds === 1) {
      check(await tv.ev(`!document.querySelector('.is-right') && !document.querySelector('.quiz-anecdote') && !document.querySelector('.quiz-source') && document.querySelectorAll('.quiz-choice').length === ${choice ? qv.round.question.choices.length : 0}`), '…no answer (nor anecdote, nor source) shown before the reveal');
      const n0 = Number(await tv.ev(`document.querySelector('.quiz-ring-num')?.textContent`));
      await sleep(1300);
      const n1 = Number(await tv.ev(`document.querySelector('.quiz-ring-num')?.textContent`));
      check(n0 > 0 && n1 < n0, `…the countdown ring runs (${n0} → ${n1})`);
      check(!(await tv.ev(`!!document.querySelector('.cutscene')`)), '…no unlock cutscene covers the question (interrupted, replayed when calm)');
      await tv.shot('quiz-question');
      phoneOf(seated[1])!.send({ t: 'showJoin' });
      await tv.waitFor(cardOn);
      check(await tv.waitFor(noOverlap('.quiz-q, .quiz-choice, .quiz-type-hint, .quiz-ring')), '…beside the question: never over its text, tiles or ring');
      await tv.shot('join-qr-quiz');
    }
    // the first seated player answers: only their chip lights up
    const [first, ...rest] = seated;
    phoneOf(first)!.send(choice ? { t: 'answer', choice: 0 } : { t: 'answer', text: 'Victor Hugo' });
    check(await tv.waitFor(`document.querySelector('.quiz-question .quiz-chip[data-id="${first}"]')?.classList.contains('has-answered')
      && [...document.querySelectorAll('.quiz-question .quiz-chip.has-answered')].length === 1`),
      `Q${rounds}: who answered is shown (one chip lit, nothing about what)`);
    i = A2.mark();
    for (const id of rest) phoneOf(id)!.send(choice ? { t: 'answer', choice: 1 } : { t: 'answer', text: 'nope' });
    const rv = quizOf(await A2.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'reveal', i, 6000));
    check(await tv.waitFor(`document.querySelectorAll('.quiz-reveal .quiz-result').length === ${seated.length}`
      + (choice ? ` && document.querySelectorAll('.quiz-choice.is-right').length === 1` : ` && !!document.querySelector('.quiz-answer')`)),
      `Q${rounds}: reveal: the right answer lit, one result per player`);
    const marks = await tv.ev(`JSON.stringify([...document.querySelectorAll('.quiz-result')].map((r) => r.className.replace('quiz-result ', '')))`);
    const want = JSON.stringify(seated.map((id) => `is-${rv.round.answers[id]?.ok === null ? 'pending' : rv.round.answers[id]?.ok ? 'right' : rv.round.answers[id] ? 'wrong' : 'none'}`));
    check(marks === want, `Q${rounds}: ✓/✗ match the server's verdicts (${marks})`);
    const source = rv.round.answer?.source;
    if (source) check(await tv.waitFor(`document.querySelector('.quiz-reveal .quiz-source')?.textContent.includes(${JSON.stringify(String(source).slice(0, 16))})`), `Q${rounds}: reveal shows the question's source`);
    const anecdote = rv.round.answer?.anecdote;
    if (anecdote) {
      anecdotes++;
      check(await tv.waitFor(`document.querySelector('.quiz-anecdote')?.textContent.includes(${JSON.stringify(anecdote.slice(0, 20))})`),
        `Q${rounds}: the reveal shows the anecdote`);
    }
    if (rounds === 1 || (anecdote && anecdotes === 1)) { if (SHOTS) await sleep(900); await tv.shot(anecdote ? 'quiz-reveal-anecdote' : 'quiz-reveal'); }
    i = A2.mark(); A2.send({ t: 'next' });
    qv = quizOf(await A2.waitFor((m) => m.t === 'view' && (quizOf(m)?.phase === 'question' || quizOf(m)?.phase === 'finished'), i));
  }
  check(qv?.phase === 'finished', `quiz played through (${rounds} questions, ${anecdotes} with an anecdote)`);
  check(await tv.waitFor(`!!document.querySelector('.podium') && document.querySelectorAll('.rank-row').length === ${seated.length}`),
    'finished → the quiz podium, every player ranked');
  check(await tv.ev(`[...document.querySelectorAll('.rank-correct')].every((e) => e.textContent.includes('/') && e.textContent.trim().endsWith('✓'))`), '…with each player\'s right answers');
  if ((qv.credits ?? []).length) check(await tv.ev(`!!document.querySelector('.podium .quiz-credits')`), 'quiz podium: dataset credits line');
  if (SHOTS) await sleep(4500);
  await tv.shot('quiz-podium');
  i = A2.mark(); A2.send({ t: 'back' });
  await A2.waitFor((m) => m.t === 'view' && !quizOf(m) && m.campaign?.at.node === 'childhood', i);
  check(await tv.waitFor(`!document.querySelector('.quiz') && !!document.querySelector('.map-band') && !document.body.classList.contains('in-quiz')`),
    'the game master goes back → the world map again (quiz screen gone)');
  const quizLeft = `[...window.__live(['quiz-screen.js', 'quiz-view.js', 'blocks-screen.js', 'countdown.js', 'game-view.js']), ...(document.querySelector('.quiz, .arena') ? ['its markup'] : [])]`;
  await tv.waitFor(`${quizLeft}.length === 0`, 3000, quizLeft);
  const qLeft = await tv.ev(quizLeft);
  check(qLeft.length === 0, `teardown: block game → map → quiz → map leaves nothing of either screen running (${JSON.stringify(qLeft)})`);
  } // quiz
  } // campaign / quiz

  for (const c of [A2, B, N, E]) c?.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack}\n--- server log ---\n${log()}`);
} finally {
  await tv?.close(); await tv2?.close();
  cdp?.close();
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
