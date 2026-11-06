// The storyboard's sequences: what happens on the evening, in order, with the screens that show it. A slide
// takes the TV and the phones that matter at that moment: captured from the running game where the game
// already draws that screen ("today"), a mockup where it's planned (./mock.mts). When the game starts
// drawing a planned screen, replace its mockup with the steps that reach it and a capture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { drive } from '../drive.mts';
import { SLOW, sleep } from '../e2e-lib.mts';
import { PYRAMIDE_SPOTS } from '../../shared/pyramide.js';
import { avatar, phone, player, tv, wisp } from './mock.mts';

export type Shot = { who: string, img: string, planned: boolean };
type Drive = Awaited<ReturnType<typeof drive>>;
type Phone = Drive['phones'][number];

/** What a sequence's steps get: the game, its phones by character, and how to make shots and slides. */
export type Board = {
  d: Drive,
  phone: (who: string) => Phone,
  tv: () => Promise<Shot>,                        // the TV, captured
  real: (who: string) => Promise<Shot>,           // a phone, captured
  mockTv: (html: string) => Promise<Shot>,        // a planned TV screen
  mockPhone: (who: string, html: string) => Promise<Shot>,   // a planned phone screen
  frame: (caption: string, shots: (() => Promise<Shot>)[]) => Promise<void>,
};

/** `content`: ITLOE_CONTENT for its server (the story when empty); `env`: more environment for it; `phones`: the characters with a phone. */
export type Sequence = { id: string, title: string, intro: string, content: string, env?: Record<string, string>, phones: string[], run: (b: Board) => Promise<void> };

// ---------------------------------------------------------------- driving the game

/** Where a character's avatar stands, as the TV draws it: in a minigame's walkable lobby, among its walkers. */
const where = (b: Board, who: string) => async () =>
  (await b.d.tv.ev(`[...window.bloko.walkers(), ...window.bloko.avatars()].find((a) => a.character === ${JSON.stringify(who)}) ?? null`)) as { x: number, y: number } | null;

/** Walks a character's avatar to a point with its phone's joystick; `done` says when it's there. */
async function walk(b: Board, who: string, to: { x: number, y: number }, done?: () => Promise<boolean>) {
  const at = where(b, who);
  await b.phone(who).steer(to, done ?? (async () => { const p = await at(); return !!p && Math.hypot(p.x - to.x, p.y - to.y) < 0.3; }), at);
}

/** The campaign as the TV holds it. */
const campaign = (b: Board): Promise<any> => b.d.tv.ev('window.bloko.campaign()');
const hasFlag = (b: Board, flag: string) => async () => !!(await campaign(b))?.facts.flags.includes(flag);
/** Waits until the TV has no cutscene playing. */
const cutscenesDone = (b: Board, ms = 60_000) => b.d.tv.waitFor('!window.bloko.cutscene().playing', ms);

/**
 * Plays a phone's player out of the running block game: random legal moves until no piece fits. The moves
 * go through a second socket opened in the phone's page (the phone shows "Continued on another device"
 * meanwhile, and forgets its player), then the page gets its player back and reloads, as a phone reclaims.
 */
async function playToOut(b: Board, who: string) {
  const p = b.phone(who);
  const id: string = await p.ev(`localStorage.getItem('bloko-id')`);
  await p.ev(`(async () => {
    const { canPlace } = await import('/shared/board.js');
    const { PIECES } = await import('/shared/pieces.js');
    const id = ${JSON.stringify(id)};
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
    let view = null;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'view') view = m.minigame?.view.round ?? null; };
    await new Promise((r) => { ws.onopen = r; });
    ws.send(JSON.stringify({ t: 'hello', role: 'player', playerId: id }));
    const tick = () => new Promise((r) => setTimeout(r, 40));
    for (let n = 0; n < 600; n++) {
      await tick();
      const me = view?.players[id];
      if (!me || me.done || view.phase !== 'playing') break;
      const moves = [];
      me.hand.forEach((pid, piece) => {
        if (pid === null) return;
        for (let y = 0; y < view.size; y++) for (let x = 0; x < view.size; x++) if (canPlace(me.board, view.size, PIECES[pid].cells, x, y)) moves.push({ piece, x, y });
      });
      if (!moves.length) continue;
      const before = view;
      ws.send(JSON.stringify({ t: 'place', ...moves[Math.floor(Math.random() * moves.length)] }));
      for (let w = 0; w < 50 && view === before; w++) await tick();
    }
    ws.close();
    return true;
  })()`);
  await b.d.tv.waitFor(`window.bloko.minigame()?.view.round?.players[${JSON.stringify(id)}]?.done === true`, 20_000);
  await p.ev(`localStorage.setItem('bloko-id', ${JSON.stringify(id)})`);
  await p.goto(b.d.url + '/play/');
  await p.waitFor(`!document.getElementById('view-pick') || !!document.getElementById('view-pick').closest('[hidden]')`);
}

/** The game master ends the running round from ☰ (two taps, as on the phone), then closes ☰ (it stays open
 *  over the podium otherwise). */
async function endGame(p: Phone) {
  await p.tap('#btn-menu');
  await p.tap('End game now');
  await p.tap('Tap again to end the game');
  await p.tap('#sheet-menu [data-close]');
}

/** The TV's minigame status is `status` ('lobby' | 'running' | 'podium'). */
const minigameIs = (b: Board, status: string, ms?: number) => b.d.tv.waitFor(`window.bloko.minigame()?.status === ${JSON.stringify(status)}`, ms);
/** The TV's lobby has `n` players ready. */
const readyAre = (b: Board, n: number) => b.d.tv.waitFor(`window.bloko.minigame()?.view.ready.length === ${n}`);
/** The TV shows `n` party members who haven't left. */
const guests = (b: Board, n: number) => b.d.tv.waitFor(`(() => { const p = window.bloko.campaign()?.party; return p && p.order.filter((id) => !p.players[id].left).length === ${n}; })()`);

/** The game master ends the minigame from its lobby (two taps, as on the phone); the TV is back in the room. */
async function endMinigame(b: Board, p: Phone) {
  await p.tap('#btn-end-minigame');
  await p.waitText('Tap again to end');
  await p.tap('#btn-end-minigame');
  await b.d.tv.waitFor('window.bloko.minigame() === null');
}

/** Answers the quiz's current question on a phone: a choice when it shows choices, else a typed answer. */
async function answer(p: Phone, pick: number, typed: string) {
  const choices = await p.ev(`document.querySelectorAll('#quiz-choices button').length`);
  if (choices && !(await p.ev(`document.getElementById('quiz-choices').hidden`))) await p.tap(`#quiz-choices button:nth-child(${pick})`);
  else await p.type('#quiz-text', typed).then(() => p.tap('#quiz-send'));
}

// ---------------------------------------------------------------- the sequences

const opening: Sequence = {
  id: 'opening',
  title: 'The opening',
  intro: 'The birthday story as it starts: the block game, which Pierre, the game master, starts and ends, with its own lobby; then the portal.',
  content: '',
  phones: ['pierre', 'elodie', 'sol', 'anna', 'nico'],
  async run(b) {
    const [P, E, S, A, N] = ['pierre', 'elodie', 'sol', 'anna', 'nico'].map((w) => b.phone(w));
    await P.join('pierre'); await E.join('elodie');
    await guests(b, 2);
    await sleep(500);
    await b.frame('Everyone scans the QR code on the TV and picks their character. They walk around the party room, which belongs to the main game.',
      [b.tv, () => b.real('pierre'), () => b.real('sol')]);

    await S.join('sol'); await A.join('anna');
    await N.join('nico');
    await guests(b, 5);
    await b.d.tv.waitFor(`window.bloko.avatars().some((a) => a.character === 'nico')`);
    await walk(b, 'nico', { x: 11, y: 6.2 });
    await sleep(500);
    await b.frame('All four are in. Nico has joined too, from Sweden: he isn’t one of the opening’s four, so he’s a wisp, the small light by the table. The block game is waiting in this room; only Pierre, the game master, can start it.',
      [b.tv, () => b.real('pierre'), () => b.real('elodie'), () => b.real('nico')]);

    await P.tap('#btn-start-minigame');
    await minigameIs(b, 'lobby');
    for (const p of [P, E, S]) await p.tap('#btn-ready');
    await readyAre(b, 3);
    await sleep(800);
    await b.frame('Pierre starts the block game, and its lobby opens. The main game hands it the four who may play; each taps “I’m ready”. Pierre sets the board and mode from ⚙, and the opening’s game starts only once all four are ready: Anna hasn’t tapped yet. Nico isn’t one of them and floats over the lobby as a wisp.',
      [b.tv, () => b.real('pierre'), () => b.real('sol'), () => b.real('anna'), () => b.real('nico')]);

    await A.tap('#btn-ready');
    await readyAre(b, 4);
    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(1200);
    await b.frame('All four ready, Pierre starts the round: everyone plays on their phone, every board on the TV. Nico’s wisp floats over the boards.',
      [b.tv, () => b.real('elodie'), () => b.real('nico')]);

    await playToOut(b, 'sol');
    await sleep(1500);
    await b.frame('Sol has no room left for any piece and is out of this round; the others play on. Sol roams over the TV as a wisp until the round ends.',
      [b.tv, () => b.real('sol')]);

    await endGame(P);
    await minigameIs(b, 'podium');
    await sleep(2500);
    await b.frame('Pierre ends the round: the podium. Only Pierre’s phone has “Back to the lobby”.', [b.tv, () => b.real('pierre'), () => b.real('elodie')]);

    await P.tap('#btn-back-to-lobby');
    await minigameIs(b, 'lobby');
    await sleep(1000);
    await b.frame('Back in the block game’s lobby, everyone who played is ready again and the last game’s winner is shown. Pierre can play again at once, or end the block game.',
      [b.tv, () => b.real('pierre'), () => b.real('anna')]);

    await endMinigame(b, P);
    await b.d.tv.waitFor('window.bloko.campaign()?.facts.flags.includes("portal.ready")');
    await sleep(1500);
    await b.frame('Pierre ends the block game (two taps): everyone is back in the main game’s party room, where a portal has appeared. Only Élodie can walk into it.',
      [b.tv, () => b.real('elodie'), () => b.real('anna')]);

    await walk(b, 'elodie', { x: 8, y: 5.4 }, hasFlag(b, 'portal.entered'));
    await sleep(2500);
    await b.frame('Élodie crosses into her Vienna apartment. Pierre, Sol and Anna become wisps too and follow her, with Nico. A mysterious visitor appears and speaks.',
      [b.tv, () => b.real('elodie'), () => b.real('pierre')]);

    await b.d.tv.waitFor('window.bloko.campaign()?.facts.flags.includes("apparition.seen")', 60_000);
    await sleep(1500);
    await b.frame('He leaves the first key. Élodie walks over to it; the wisps float around her and can Shine.',
      [b.tv, () => b.real('elodie'), () => b.real('sol')]);

    await walk(b, 'elodie', { x: 6.4, y: 6.6 });
    await E.tap('Pick up key');
    await b.d.tv.waitFor(`(window.bloko.campaign()?.facts.inventory.elodie?.['memory-key-intro'] ?? 0) > 0`);
    await sleep(1500);
    await b.frame('Élodie picks up the key: the door to the Young Adult world opens.', [b.tv, () => b.real('elodie')]);

    await cutscenesDone(b);
    await walk(b, 'elodie', { x: 8.95, y: 5.3 }, async () => (await campaign(b))?.at.node === 'young-adult');
    await sleep(1500);
    await b.frame('Through the door, the Young Adult world. Its contents are still to be written.', [b.tv, () => b.real('elodie'), () => b.real('anna')]);
  },
};

const quiz: Sequence = {
  id: 'quiz',
  title: 'A quiz',
  intro: 'The quiz has no place in the story yet: here it runs from its development start, in a placeholder room. Anna joins but doesn’t get ready: she stays “not ready” in the lobby and watches the questions as a wisp.',
  content: 'minigame:quiz',
  phones: ['pierre', 'elodie', 'sol', 'anna'],
  async run(b) {
    const [P, E, S, A] = ['pierre', 'elodie', 'sol', 'anna'].map((w) => b.phone(w));
    await P.join('pierre'); await E.join('elodie'); await S.join('sol'); await A.join('anna');
    await guests(b, 4);
    await sleep(500);
    await b.frame('The party reaches the quiz. Pierre starts it from the room; everyone else waits for him.',
      [b.tv, () => b.real('pierre'), () => b.real('elodie')]);

    await P.tap('#btn-start-minigame');
    await minigameIs(b, 'lobby');
    for (const p of [P, E, S]) await p.tap('#btn-ready');
    await readyAre(b, 3);
    await sleep(800);
    await b.frame('The quiz’s lobby. Pierre sets how many questions, how long for each and the kind of answers from ⚙. Élodie, Sol and Pierre are ready; Anna joined but stays “not ready”: she won’t play this round.',
      [b.tv, () => b.real('pierre'), () => b.real('elodie'), () => b.real('anna')]);

    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(1500);
    await b.frame('A question. Anna isn’t in this round: her wisp floats over the question on the TV, and her phone is the wisp’s pad with Shine.',
      [b.tv, () => b.real('elodie'), () => b.real('sol'), () => b.real('anna')]);

    await answer(E, 1, 'Paris'); await answer(S, 2, 'Lyon');
    await answer(P, 3, 'Marseille');
    await b.d.tv.waitFor('window.bloko.minigame()?.view.round?.phase === "reveal"', 30_000);
    await sleep(1500);
    await b.frame('The reveal. Pierre can correct any verdict, then moves on.', [b.tv, () => b.real('pierre'), () => b.real('elodie')]);

    for (let q = 2; q <= 3; q++) {
      await P.tap('#quiz-next');
      await b.d.tv.waitFor('window.bloko.minigame()?.view.round?.phase === "question"');
      await sleep(500);
      await answer(E, 1, 'Paris'); await answer(S, 2, 'Lyon'); await answer(P, 3, 'Marseille');
      await b.d.tv.waitFor('window.bloko.minigame()?.view.round?.phase === "reveal"', 30_000);
    }
    await P.tap('#quiz-next');
    await minigameIs(b, 'podium');
    await sleep(3000);
    await b.frame('The podium. Pierre takes everyone back to the lobby.', [b.tv, () => b.real('pierre'), () => b.real('sol')]);

    await P.tap('#btn-back-to-lobby');
    await minigameIs(b, 'lobby');
    await sleep(1000);
    await b.frame('Back in the quiz’s lobby: the three who played are ready again, Anna still isn’t. Pierre can play again or end the quiz.',
      [b.tv, () => b.real('pierre'), () => b.real('anna')]);

    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(1500);
    await b.frame('Play again: a new round at once, with the ready players and questions not asked yet this evening.',
      [b.tv, () => b.real('pierre')]);

    await endGame(P);
    await minigameIs(b, 'podium');
    await P.tap('#btn-back-to-lobby');
    await minigameIs(b, 'lobby');
    await endMinigame(b, P);
    await sleep(1500);
    await b.frame('Pierre ends the round, goes back to the lobby and ends the quiz: everyone is back in the main game’s room, and the quiz’s results count from now. (Later, every game’s results feed an end-of-evening summary.)',
      [b.tv, () => b.real('pierre'), () => b.real('elodie')]);
  },
};

// ---------------------------------------------------------------- Pyramide, played through the phones

/** The storyboard's own word bank (BLOKO_PYRAMIDE_DIR for its server): each word comes with clues that fit it, and a near miss. */
const WORD_BANK = join(import.meta.dirname, 'pyramide-words');
const NOTES = new Map<string, { clues: string[], wrong: string }>(
  Object.values<any[]>(JSON.parse(readFileSync(join(WORD_BANK, 'words.json'), 'utf8')).categories).flat().map((w) => [w.word, w]));

/** The four who take a spot, by team. Anna is eligible too and takes none. */
const TEAM_1 = ['elodie', 'nico'], TEAM_2 = ['pierre', 'sol'];
const SPOT = Object.fromEntries(PYRAMIDE_SPOTS.map((s) => [s.id, { x: s.x + s.w / 2, y: s.y + s.h / 2 }]));

/** Is `selector` showing on the phone? */
const showing = (p: Phone, selector: string): Promise<boolean> =>
  p.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.closest('[hidden]'); })()`);

/** The player whose phone shows `selector`, once one does; null once the round has gone to its podium. */
async function whoShows(b: Board, selector: string): Promise<string | null> {
  const end = Date.now() + 10_000 * SLOW;
  for (;;) {
    for (const who of [...TEAM_1, ...TEAM_2]) if (await showing(b.phone(who), selector)) return who;
    if ((await b.d.tv.ev('window.bloko.minigame()?.status')) === 'podium') return null;
    if (Date.now() > end) throw new Error(`pyramide: no phone shows ${selector}`);
    await sleep(100);
  }
}

/** Plays a round through the phones: clues from the clue giver's phone (the only one that shows the word), guesses from the guesser's. */
function pyramidePlay(b: Board) {
  const given = new Map<string, number>(); // clues given per word
  /** The clue giver whose turn it is gives the word's next clue; null at the podium. */
  async function giveClue() {
    const giver = await whoShows(b, '#pyr-clue-form');
    if (!giver) return null;
    const p = b.phone(giver);
    const word: string = await p.ev(`document.getElementById('pyr-word-text').textContent`);
    const n = given.get(word) ?? 0;
    given.set(word, n + 1);
    const clue = NOTES.get(word)!.clues[n];
    await p.type('#pyr-clue', clue);
    await p.tap('#pyr-clue-send');
    return { giver, word, clue, n };
  }
  /** The guesser whose turn it is guesses the word, or its near miss. */
  async function guess(word: string, right: boolean) {
    const guesser = (await whoShows(b, '#pyr-guess-form'))!;
    const text = right ? word : NOTES.get(word)!.wrong;
    await b.phone(guesser).type('#pyr-guess', text);
    await b.phone(guesser).tap('#pyr-guess-send');
    return { guesser, text };
  }
  /** A clue giver bids: the control starts at 5 (the opening bid) or one under the last bid; `lower` taps "−" first. */
  async function bid(who: string, lower = 0) {
    for (let k = 0; k < lower; k++) await b.phone(who).tap('#pyr-bid-less');
    await b.phone(who).tap('#pyr-bid-send');
  }
  /** The classic round to its podium: team 1 finds each word on its first clue, team 2 on its second. */
  async function finishClassic() {
    for (let c = await giveClue(); c; c = await giveClue()) await guess(c.word, !(TEAM_2.includes(c.giver) && c.n === 0));
  }
  /** The duel to its podium: the opening team bids 5, the other passes, the opening team finds the word on its first clue. */
  async function finishDuel() {
    for (let opener = await whoShows(b, '#pyr-bid'); opener; opener = await whoShows(b, '#pyr-bid')) {
      await bid(opener);
      await b.phone((await whoShows(b, '#pyr-pass'))!).tap('#pyr-pass');
      const c = (await giveClue())!;
      await guess(c.word, true);
    }
  }
  return { giveClue, guess, bid, finishClassic, finishDuel };
}

// ---------------------------------------------------------------- Pyramide

const pyramide: Sequence = {
  id: 'pyramide',
  title: 'Pyramide with Nico',
  intro: 'Pyramide has no place in the story yet, so it runs from its development start, in a placeholder room. That start has no story wisps: Anna is an eligible player who takes no spot, and a wisp once the round runs. Nico plays as his character here; in the story he joins from Sweden and is a wisp until this reunion, which is why the last slide is planned. The words are the storyboard’s own small list, so each clue fits its word.',
  content: 'minigame:pyramide',
  env: { BLOKO_PYRAMIDE_DIR: WORD_BANK },
  phones: ['pierre', 'elodie', 'nico', 'sol', 'anna'],
  async run(b) {
    const [P, E, N, S, A] = ['pierre', 'elodie', 'nico', 'sol', 'anna'].map((w) => b.phone(w));
    const play = pyramidePlay(b);
    for (const [p, who] of [[P, 'pierre'], [E, 'elodie'], [N, 'nico'], [S, 'sol'], [A, 'anna']] as const) await p.join(who);
    await guests(b, 5);
    await sleep(500);
    await b.frame('Pyramide’s place, in the placeholder room of its development start. Pierre, the game master, starts it; everyone else waits.',
      [b.tv, () => b.real('pierre'), () => b.real('nico')]);

    await P.tap('#btn-start-minigame');
    await minigameIs(b, 'lobby');
    await sleep(1500);
    await b.frame('Pyramide’s lobby is walkable. The five eligible players stand at the lobby’s start positions, between the two teams’ spots. Being ready means standing on a spot, so there is no “I’m ready”: each team has a clue giver and a guesser. Pierre sets the mode from ⚙ and can only start once all four spots are taken.',
      [b.tv, () => b.real('pierre'), () => b.real('nico')]);

    await walk(b, 'elodie', SPOT['team1-clue']);
    await walk(b, 'pierre', SPOT['team2-clue']);
    await walk(b, 'sol', SPOT['team2-guess']);
    await sleep(1000);
    await b.frame('Players walk onto the spots with the joystick on their phone: Élodie is team 1’s clue giver, Pierre and Sol are team 2’s clue giver and guesser. One spot is left, and Nico’s phone lists it with “Take this spot”: that moves his character onto it.',
      [b.tv, () => b.real('nico'), () => b.real('sol')]);

    await N.tap('li[data-spot="team1-guess"] .spot-take');
    await b.d.tv.waitFor(`window.bloko.minigame()?.spots?.every((s) => s.holder)`);
    await sleep(1000);
    await b.frame('Nico takes the last spot from his phone: he is team 1’s guesser. All four spots are taken, so Pierre can start. Anna took no spot: she stays in the lobby, and her phone says so.',
      [b.tv, () => b.real('pierre'), () => b.real('nico'), () => b.real('anna')]);

    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(1000);
    const c1 = (await play.giveClue())!;
    await sleep(1200);
    await b.frame(`Classic mode, team 1’s turn. Élodie gave the one-word clue “${c1.clue}” to get Nico to ${c1.word.toUpperCase()}, and the clue cost a brick. Only her phone shows the word. Nico’s phone has the clue and the guess field; the TV shows every clue and guess, never the word. Sol watches, and Anna floats over the TV as a wisp.`,
      [b.tv, () => b.real('elodie'), () => b.real('nico'), () => b.real('sol'), () => b.real('anna')]);

    await play.guess(c1.word, false);
    const c2 = (await play.giveClue())!;
    await sleep(1200);
    await b.frame(`Nico guessed “${NOTES.get(c1.word)!.wrong}”: wrong, and shown with ✗ in the log, so it’s team 2’s turn. Pierre gives a clue, “${c2.clue}”, for his own word, and Sol guesses next. Élodie, watching, sees the clues and guesses, and her own team’s word, but not team 2’s.`,
      [b.tv, () => b.real('pierre'), () => b.real('sol'), () => b.real('elodie')]);

    await play.guess(c2.word, false);
    const c3 = (await play.giveClue())!;
    await play.guess(c3.word, true);
    await sleep(2000);
    await b.frame(`Back to team 1: Élodie’s second clue, “${c3.clue}”, and Nico finds ${c3.word.toUpperCase()}. The word shows to everyone, and on team 1 the roles swap: Nico now sees the next word on his phone and gives the clues, Élodie guesses. First it’s team 2’s turn.`,
      [b.tv, () => b.real('nico'), () => b.real('elodie')]);

    await play.finishClassic();
    await minigameIs(b, 'podium');
    await sleep(3000);
    await b.frame('Both teams found their four words, so the round is over: the podium. Team 1 used fewer bricks for the same four words (5 against 8), so it ranks first. Only Pierre’s phone has “Back to the lobby”.',
      [b.tv, () => b.real('pierre'), () => b.real('anna')]);

    await P.tap('#btn-back-to-lobby');
    await minigameIs(b, 'lobby');
    await P.tap('#btn-settings-lobby');
    await P.tap('Bidding duel');
    await b.d.tv.waitFor(`window.bloko.minigame()?.view.settings.mode === 'duel'`);
    await sleep(1000);
    await b.frame('Back in the lobby, everyone is still on their spot, so the teams stay. Pierre opens ⚙ and switches the mode to the bidding duel. The TV shows the last game’s winners and the new mode.',
      [b.tv, () => b.real('pierre')]);

    await P.tap('#sheet-settings [data-close]');
    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(500);
    const opener = (await whoShows(b, '#pyr-bid'))!;
    await play.bid(opener, 1);
    const rival = (await whoShows(b, '#pyr-pass'))!;
    await sleep(1200);
    const word: string = await b.phone(opener).ev(`document.getElementById('pyr-word-text').textContent`);
    await b.frame(`The duel’s bidding, for the word ${word.toUpperCase()}: both clue givers see it, the guessers and the TV don’t. Team 1’s clue giver, Élodie, offers to get it across in 4 clues. Pierre can bid lower or pass. Nico, a guesser, only sees the bids.`,
      [b.tv, () => b.real(opener), () => b.real(rival), () => b.real('nico')]);

    await play.bid(rival);
    await b.phone(opener).tap('#pyr-pass');
    const d1 = (await play.giveClue())!;
    await play.guess(d1.word, false);
    const d2 = (await play.giveClue())!;
    await sleep(1200);
    await b.frame(`Élodie passed, so Pierre’s bid of 3 plays: he has 3 clues to get Sol to ${d1.word.toUpperCase()}. He gave “${d1.clue}”, Sol guessed “${NOTES.get(d1.word)!.wrong}” (✗), and Pierre gave “${d2.clue}”: one brick left, and Sol guesses next. Found: a point for team 2; not found in time: a point for team 1.`,
      [b.tv, () => b.real('pierre'), () => b.real('sol')]);

    await play.guess(d2.word, true);
    await play.finishDuel();
    await minigameIs(b, 'podium');
    await sleep(3000);
    await b.frame('After five words, the duel’s podium: Pierre and Sol have 3 points, Élodie and Nico 2.',
      [b.tv, () => b.real('pierre')]);

    await P.tap('#btn-back-to-lobby');
    await minigameIs(b, 'lobby');
    await endMinigame(b, P);
    await sleep(1500);
    await b.frame('Pierre goes back to the lobby and ends Pyramide (two taps): everyone is back in the main game’s room.',
      [b.tv, () => b.real('pierre')]);

    await b.frame('Planned: back in the main game, the reward. Nico’s phone counts down 3, 2, 1 and his wisp turns into his character for good. This waits for Pyramide’s place in the story.',
      [() => b.mockTv(tv('Young adulthood in Vienna', `<div class="col" style="justify-content:flex-end"><div class="players">
          ${['elodie', 'pierre', 'sol', 'nico'].map((w) => `<figure>${avatar(w, 9)}<figcaption>${player(w)}${w === 'nico' ? ' 🎉' : ''}</figcaption></figure>`).join('')}</div></div>`, wisp('anna', 80, 40))),
        () => b.mockPhone('nico', phone('nico', `<div style="flex:1;display:grid;place-items:center"><b style="font-size:140px;color:var(--accent)">1</b></div><p class="hint" style="text-align:center">You’re becoming Nico…</p>`, { wisp: true }))]);
  },
};
const moments: Sequence = {
  id: 'moments',
  title: 'Edge moments',
  intro: 'Things that happen on a real evening: a phone that drops out in the middle of a game. Shown with the block game.',
  content: 'minigame:blocks',
  phones: ['pierre', 'elodie', 'sol'],
  async run(b) {
    const [P, E, S] = ['pierre', 'elodie', 'sol'].map((w) => b.phone(w));
    await P.join('pierre'); await E.join('elodie'); await S.join('sol');
    await guests(b, 3);
    await P.tap('#btn-start-minigame');
    await minigameIs(b, 'lobby');
    for (const p of [P, E, S]) await p.tap('#btn-ready');
    await readyAre(b, 3);
    await P.tap('#btn-start');
    await minigameIs(b, 'running');
    await sleep(1000);

    await S.goto('about:blank'); // the phone's page goes away: its socket closes, as when a phone locks or loses Wi-Fi
    await b.d.tv.waitFor(`window.bloko.offline().length > 0`);
    await sleep(800);
    await b.frame('Sol’s phone drops out in the middle of the block game. The game carries on; the TV marks Sol offline, and Sol keeps their seat.',
      [b.tv, () => b.real('elodie')]);

    await S.goto(b.d.url + '/play/');
    await b.d.tv.waitFor(`window.bloko.offline().length === 0`, 20_000);
    await sleep(1500);
    await b.frame('Sol opens the game again: the phone carries on with Sol’s board and score.', [b.tv, () => b.real('sol')]);

    await P.tap('#btn-menu');
    await sleep(500);
    await b.frame('If someone doesn’t come back, Pierre takes them out from ☰. The block game carries on without them; a game that can’t, like Pyramide, ends with the scores so far.',
      [b.tv, () => b.real('pierre')]);
    await P.tap('#btn-menu');
  },
};

export const SEQUENCES: Sequence[] = [opening, quiz, pyramide, moments];
