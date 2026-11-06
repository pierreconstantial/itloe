// The storyboard's sequences: what happens on the evening, in order, with the screens that show it. A slide
// takes the TV and the phones that matter at that moment: captured from the running game where the game
// already draws that screen ("today"), a mockup where it's planned (./mock.mts). When the game starts
// drawing a planned screen, replace its mockup with the steps that reach it and a capture.
import type { drive } from '../drive.mts';
import { sleep } from '../e2e-lib.mts';
import { avatar, colorOf, nameOf, phone, player, tv, wisp, wispPhone } from './mock.mts';

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
  overTv: (html: string) => Promise<Shot>,        // the TV captured now, with planned things drawn over it
  mockPhone: (who: string, html: string) => Promise<Shot>,   // a planned phone screen
  frame: (caption: string, shots: (() => Promise<Shot>)[]) => Promise<void>,
};

/** `content`: ITLOE_CONTENT for its server (the story when empty); `phones`: the characters with a phone. */
export type Sequence = { id: string, title: string, intro: string, content: string, phones: string[], run: (b: Board) => Promise<void> };

// ---------------------------------------------------------------- driving the game

/** Where a character's avatar stands, as the TV draws it. */
const where = (b: Board, who: string) => async () =>
  (await b.d.tv.ev(`window.bloko.avatars().find((a) => a.character === ${JSON.stringify(who)}) ?? null`)) as { x: number, y: number } | null;

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
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'view') view = m.round?.view ?? null; };
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
  await b.d.tv.waitFor(`window.bloko.round()?.view.players[${JSON.stringify(id)}]?.done === true`, 20_000);
  await p.ev(`localStorage.setItem('bloko-id', ${JSON.stringify(id)})`);
  await p.goto(b.d.url + '/play/');
  await p.waitFor(`!document.getElementById('view-pick') || !!document.getElementById('view-pick').closest('[hidden]')`);
}

/** The game master ends the running round from ☰ (two taps, as on the phone). */
async function endGame(p: Phone) {
  await p.tap('#btn-menu');
  await p.tap('End game now');
  await p.tap('Tap again to end the game');
}

/** Answers the quiz's current question on a phone: a choice when it shows choices, else a typed answer. */
async function answer(p: Phone, pick: number, typed: string) {
  const choices = await p.ev(`document.querySelectorAll('#quiz-choices button').length`);
  if (choices && !(await p.ev(`document.getElementById('quiz-choices').hidden`))) await p.tap(`#quiz-choices button:nth-child(${pick})`);
  else await p.type('#quiz-text', typed).then(() => p.tap('#quiz-send'));
}

// ---------------------------------------------------------------- mockups shared by several slides

/** The game master's phone in a main-game room: walking, and starting the minigame waiting here. */
const gmRoomPhone = (game: string, hint: string) => phone('pierre', `
  <p class="hint">${hint}</p>
  <button class="primary">▶ Start ${game}</button>
  <div class="pad">Touch and drag here to walk on the TV</div>`);

/** A lobby's list of eligible players on the TV: standing characters, ✓ under those who are ready. */
const tvPlayers = (rows: { who: string, in: boolean, note?: string }[]) => `<div class="players">${rows.map((r) =>
  `<figure class="${r.in ? '' : 'out'}">${avatar(r.who, 14)}<figcaption>${player(r.who)}<br><span class="${r.in ? 'tick' : 'dim'}">${r.note ?? (r.in ? '✓ ready' : 'not ready')}</span></figcaption></figure>`).join('')}</div>`;

/** A lobby's list of eligible players on a phone. */
const phonePlayers = (rows: { who: string, in: boolean, note?: string }[]) => `<div class="card list">${rows.map((r) =>
  player(r.who, `<small style="margin-left:auto">${r.note ?? (r.in ? '✓ ready' : 'not ready')}</small>`)).join('')}</div>`;

/** A choice the game master taps through, as the settings sheet draws one. */
const seg = (label: string, values: string[], on: string) =>
  `<div><p class="hint" style="margin-bottom:6px">${label}</p><div class="seg">${values.map((v) => `<span class="${v === on ? 'on' : ''}">${v}</span>`).join('')}</div></div>`;

/** Pyramide's pyramid of 13 bricks (5, 4, 3, 1 from the bottom), `left` still to give. */
const pyramid = (who: string, left: number) => {
  const rows = [1, 3, 4, 5];
  let n = 13 - left; // used bricks go first, from the top
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">${rows.map((w) =>
    `<div style="display:flex;gap:6px">${Array.from({ length: w }, () => {
      const used = n-- > 0;
      return `<span style="width:58px;height:30px;border-radius:4px;background:${used ? '#2b3138' : 'linear-gradient(#ffe08a,#d4a017)'};box-shadow:${used ? 'none' : `0 0 10px #d4a01766, inset 0 -4px 0 ${colorOf(who)}`}"></span>`;
    }).join('')}</div>`).join('')}</div>`;
};

/** Pyramide's TV: both teams' pyramids, words found, and what's happening in the middle. */
const pyramideTv = (o: { mode: string, left: [number, number], words: [number, number], turn: 0 | 1, middle: string, over?: string }) => tv(
  `PYRAMIDE <span style="font-size:28px;color:var(--fg-dim);margin-left:16px">${o.mode}</span>`,
  [['elodie', 'nico'], ['pierre', 'sol']].map((team, i) => `
    <div class="col" style="flex:0 0 360px"><div class="panel" style="${o.turn === i ? 'outline:3px solid var(--accent)' : ''}">
      <h2>${player(team[0])} &amp; ${player(team[1])}</h2>
      ${pyramid(team[0], o.left[i])}
      <p class="big">${o.words[i]} <span class="dim" style="font-size:24px">word${o.words[i] === 1 ? '' : 's'} · ${o.left[i]} bricks left</span></p>
    </div></div>`).join(`<div class="col" style="justify-content:center">${o.middle}</div>`),
  o.over ?? '');

/** A clue or a guess in Pyramide's log on the TV. */
const said = (who: string, kind: 'clue' | 'guess', word: string, mark = '') =>
  `<div class="panel" style="padding:12px 20px;flex-direction:row;align-items:center;gap:14px">${avatar(who, 3)}<span class="dim">${kind}</span><b style="font-size:34px">${word}</b>${mark}</div>`;

// ---------------------------------------------------------------- the sequences

const opening: Sequence = {
  id: 'opening',
  title: 'The opening',
  intro: 'The birthday story as it starts today: a plain block game, then the portal. After the refactor, Pierre is the game master (there is no host any more), and the block game has its own lobby.',
  content: '',
  phones: ['pierre', 'elodie', 'sol', 'anna', 'nico'],
  async run(b) {
    const [P, E, S, A, N] = ['pierre', 'elodie', 'sol', 'anna', 'nico'].map((w) => b.phone(w));
    await P.join('pierre'); await E.join('elodie');
    await b.d.tv.waitText('2/4 guests');
    await b.frame('Everyone scans the QR code on the TV and picks their character. They walk around the party room, which belongs to the main game.',
      [b.tv, () => b.real('pierre'), () => b.real('sol')]);

    await S.join('sol'); await A.join('anna');
    await b.d.tv.waitText('4/4 guests');
    await N.join('nico');
    await b.d.tv.waitFor(`window.bloko.avatars().some((a) => a.character === 'nico')`);
    await walk(b, 'nico', { x: 11, y: 6.2 });
    await sleep(500);
    const roomPlayers = [{ who: 'pierre', in: true }, { who: 'elodie', in: true }, { who: 'sol', in: true }, { who: 'anna', in: false }];
    await b.frame('All four are in. Nico has joined too, from Sweden: he isn’t one of the opening’s four, so he’s a wisp, the small light by the table. The block game is waiting in this room; only Pierre, the game master, can start it.',
      [b.tv,
        () => b.mockPhone('pierre', gmRoomPhone('the block game', 'The block game is waiting here.')),
        () => b.real('elodie'), () => b.real('nico')]);

    await b.frame('The block game opens its own lobby. The main game hands it the players who may play (here all four); each taps “I’m ready”. Pierre picks the board and the mode, and starts once enough players are ready: the opening’s game needs all four. Nico isn’t one of them and floats over the lobby as a wisp.',
      [() => b.mockTv(tv('Block game', `
          <div class="col">${tvPlayers(roomPlayers)}</div>
          <div class="col" style="flex:0 0 520px"><div class="panel"><h2>Settings</h2><p class="big">8×8 board · marathon</p>
            <p class="dim">Pierre starts when all four are ready (3/4)</p></div></div>`, wisp('nico', 66, 70))),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Block game</h2>${phonePlayers(roomPlayers)}
          ${seg('Board', ['8×8', '9×9', '10×10'], '8×8')}${seg('Mode', ['marathon', 'timed'], 'marathon')}
          <button class="primary" disabled style="opacity:.5">▶ Start (3/4 ready)</button><button class="danger">End the block game</button>`)),
        () => b.mockPhone('sol', phone('sol', `<h2>Block game</h2><button class="on">✓ I’m ready</button>
          <p class="hint">8×8 board · marathon</p>${phonePlayers(roomPlayers)}<p class="hint">Pierre starts the game.</p>`)),
        () => b.mockPhone('anna', phone('anna', `<h2>Block game</h2><button class="primary">I’m ready</button>
          <p class="hint">8×8 board · marathon</p>${phonePlayers(roomPlayers)}`))]);

    await P.tap('Start game');
    await b.d.tv.waitFor('window.bloko.round()?.status === "running"');
    await sleep(1200);
    await b.frame('The block game, as today: everyone plays on their phone, every board on the TV. Nico’s wisp floats over the boards.',
      [b.tv, () => b.real('elodie'), () => b.real('nico')]);

    await playToOut(b, 'sol');
    await sleep(1500);
    await b.frame('Sol has no room left for any piece and is out of this round; the others play on. Sol roams over the TV as a wisp until the round ends.',
      [() => b.overTv(wisp('sol', 30, 58)),
        () => b.mockPhone('sol', phone('sol', `<h2>You’re out</h2><p class="hint">Score kept: you’re on the podium when the round ends. Meanwhile, float around the TV.</p>
          <div class="pad">Touch and drag here to float around the TV</div><button class="ghost">✨ Shine</button>`, { wisp: true }))]);

    await endGame(P);
    await b.d.tv.waitFor('window.bloko.round()?.status === "finished"');
    await sleep(2500);
    await b.frame('The podium, as today.', [b.tv, () => b.real('elodie')]);

    const lobbyAgain = roomPlayers.map((r) => ({ ...r, in: true }));
    await b.frame('After the podium, everyone is back in the block game’s lobby. Pierre can start another round, or end the block game, which takes everyone back to the main game.',
      [() => b.mockTv(tv('Block game', `
          <div class="col">${tvPlayers(lobbyAgain)}</div>
          <div class="col" style="flex:0 0 520px"><div class="panel"><h2>Last game</h2><p class="big">🥇 ${nameOf('elodie')}</p>
            <p class="dim">8×8 board · marathon</p></div></div>`)),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Block game</h2>${phonePlayers(lobbyAgain)}
          ${seg('Board', ['8×8', '9×9', '10×10'], '8×8')}<button class="primary">▶ Play again</button><button class="danger">End the block game</button>`))]);

    await b.d.tv.waitFor('window.bloko.round() === null', 20_000);
    await sleep(1500);
    await b.frame('Back in the main game’s party room, a portal has appeared. Only Élodie can walk into it.',
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
    await b.frame('Élodie picks up the key: door #4 opens.', [b.tv, () => b.real('elodie')]);

    await cutscenesDone(b);
    await walk(b, 'elodie', { x: 8.95, y: 5.3 }, async () => (await campaign(b))?.at.node === 'hub.door4');
    await sleep(1500);
    await b.frame('Through door #4, the second room. Its contents are still to be written.', [b.tv, () => b.real('elodie'), () => b.real('anna')]);
  },
};

const quiz: Sequence = {
  id: 'quiz',
  title: 'A quiz',
  intro: 'The quiz has no place in the story yet: here it runs from its development start, in a placeholder room. Anna isn’t playing this one and watches as a wisp.',
  content: 'minigame:quiz',
  phones: ['pierre', 'elodie', 'sol'],
  async run(b) {
    const [P, E, S] = ['pierre', 'elodie', 'sol'].map((w) => b.phone(w));
    await P.join('pierre'); await E.join('elodie'); await S.join('sol');
    await b.d.tv.waitText('3/');
    await sleep(500);
    await b.frame('The party reaches the quiz. Pierre starts it from the room.',
      [b.tv, () => b.mockPhone('pierre', gmRoomPhone('the quiz', 'A quiz is waiting here.')), () => b.real('elodie')]);

    const rows = [{ who: 'pierre', in: true }, { who: 'elodie', in: true }, { who: 'sol', in: true }];
    await b.frame('The quiz’s lobby. Pierre picks how many questions, how long for each, and the kind of answers. Anna isn’t among the quiz’s players today and floats around the screen as a wisp.',
      [() => b.mockTv(tv('Quiz', `
          <div class="col">${tvPlayers(rows)}</div>
          <div class="col" style="flex:0 0 560px"><div class="panel"><h2>Settings</h2><p class="big">3 questions · 20 s each</p>
            <p class="dim">mixed answers: choices or typed</p><p class="dim">Pierre starts when everyone’s ready</p></div></div>`,
          wisp('anna', 60, 62))),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Quiz</h2>${phonePlayers(rows)}
          ${seg('Questions', ['3', '5', '10'], '3')}${seg('Time', ['10 s', '20 s', '30 s'], '20 s')}${seg('Answers', ['choices', 'typed', 'mixed'], 'mixed')}
          <button class="primary">▶ Start</button><button class="danger">End the quiz</button>`)),
        () => b.mockPhone('elodie', phone('elodie', `<h2>Quiz</h2><button class="on">✓ I’m ready</button><p class="hint">3 questions · 20 s each · mixed answers</p>${phonePlayers(rows)}`)),
        () => b.mockPhone('anna', wispPhone('anna', 'The quiz is about to start. You’re watching as a wisp.'))]);

    await P.tap('Start game');
    await b.d.tv.waitFor('window.bloko.round()?.status === "running"');
    await sleep(1500);
    await b.frame('A question, as today; on the TV, Anna’s wisp floats over it.',
      [() => b.overTv(wisp('anna', 70, 22)), () => b.real('elodie'), () => b.real('sol'), () => b.mockPhone('anna', wispPhone('anna', 'The quiz is on. You’re watching as a wisp.'))]);

    await answer(E, 1, 'Paris'); await answer(S, 2, 'Lyon');
    await answer(P, 3, 'Marseille');
    await b.d.tv.waitFor('window.bloko.round()?.view.phase === "reveal"', 30_000);
    await sleep(1500);
    await b.frame('The reveal, as today. Pierre can correct any verdict, then moves on.', [b.tv, () => b.real('pierre'), () => b.real('elodie')]);

    for (let q = 2; q <= 3; q++) {
      await P.tap('#quiz-next');
      await b.d.tv.waitFor('window.bloko.round()?.view.phase === "question"');
      await sleep(500);
      await answer(E, 1, 'Paris'); await answer(S, 2, 'Lyon'); await answer(P, 3, 'Marseille');
      await b.d.tv.waitFor('window.bloko.round()?.view.phase === "reveal"', 30_000);
    }
    await P.tap('#quiz-next');
    await b.d.tv.waitFor('window.bloko.round()?.status === "finished"');
    await sleep(3000);
    await b.frame('The podium, as today.', [b.tv, () => b.real('sol')]);

    await b.frame('Back in the quiz’s lobby: another quiz, or Pierre ends it and everyone is back in the main game. (Later, every game’s results feed an end-of-evening summary.)',
      [() => b.mockTv(tv('Quiz', `
          <div class="col">${tvPlayers(rows)}</div>
          <div class="col" style="flex:0 0 560px"><div class="panel"><h2>Last quiz</h2><p class="big">🥇 the winner</p><p class="dim">3 questions · 20 s each</p></div></div>`,
          wisp('anna', 52, 70))),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Quiz</h2>${phonePlayers(rows)}<button class="primary">▶ Play again</button><button class="danger">End the quiz</button>`))]);
  },
};

const team1 = ['elodie', 'nico'], team2 = ['pierre', 'sol'];
const pyramidePlayers = [{ who: 'elodie', in: true, note: '✓ ready · team 1' }, { who: 'nico', in: true, note: '✓ ready · team 1' }, { who: 'pierre', in: true, note: '✓ ready · team 2' }, { who: 'sol', in: true, note: '✓ ready · team 2' }];

const pyramide: Sequence = {
  id: 'pyramide',
  title: 'Pyramide with Nico',
  intro: 'Planned: Nico’s reunion. Nico joins from Sweden on his phone and has been a wisp until now. Pyramide’s place names who may play: Élodie, Nico, Pierre and Sol. Anna isn’t among them and stays a wisp. Every screen here is a mockup.',
  content: '',
  phones: [],
  async run(b) {
    await b.frame('The party reaches Pyramide’s place in a memory world. Nico is connected and floats around as a wisp. Pierre starts Pyramide.',
      [() => b.mockTv(tv('Young adulthood in Vienna', `<div class="col" style="justify-content:flex-end"><div class="players">
          ${['elodie', 'pierre', 'sol'].map((w) => `<figure>${avatar(w, 9)}<figcaption>${player(w)}</figcaption></figure>`).join('')}</div>
          <p class="dim">(the world’s room)</p></div>`, wisp('nico', 72, 40) + wisp('anna', 84, 62))),
        () => b.mockPhone('pierre', gmRoomPhone('Pyramide', 'Pyramide is waiting here.')),
        () => b.mockPhone('nico', wispPhone('nico', 'You’re a wisp: float around the TV and Shine.'))]);

    await b.frame('Pyramide’s lobby. Nico shows as his character here. Pierre picks the mode and puts the four in two teams; each taps “I’m ready”. Anna’s wisp floats over the screen.',
      [() => b.mockTv(tv('Pyramide · lobby', `
          <div class="col">${tvPlayers(pyramidePlayers)}</div>
          <div class="col" style="flex:0 0 560px"><div class="panel"><h2>Classic</h2>
            <p>${player('elodie')} &amp; ${player('nico')}</p><p>vs ${player('pierre')} &amp; ${player('sol')}</p>
            <p class="dim">4 words each · 13 bricks</p><p class="dim">Pierre starts when all four are ready</p></div></div>`, wisp('anna', 58, 20))),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Pyramide</h2>${seg('Mode', ['Classic', 'Bidding duel'], 'Classic')}
          <div class="card"><b>Team 1</b>${player('elodie')}${player('nico')}</div><div class="card"><b>Team 2</b>${player('pierre')}${player('sol')}</div>
          <p class="hint">Tap a player to move them to the other team.</p><button class="primary">▶ Start</button><button class="danger">End Pyramide</button>`)),
        () => b.mockPhone('nico', phone('nico', `<h2>Pyramide</h2><button class="on">✓ I’m ready</button><p class="hint">Classic · you’re on team 1 with Élodie</p>${phonePlayers(pyramidePlayers)}`)),
        () => b.mockPhone('anna', wispPhone('anna', 'Pyramide is about to start. You’re watching as a wisp.'))]);

    await b.frame('Classic mode, team 1’s turn. Élodie gives clues: only her phone shows the word. Nico guesses on his. The TV shows every clue and guess, never the word.',
      [() => b.mockTv(pyramideTv({ mode: 'Classic · word 1 of 4', left: [11, 13], words: [0, 0], turn: 0,
          middle: said('elodie', 'clue', 'lait') + said('nico', 'guess', 'beurre', '<span style="color:var(--bad)">✗</span>') + said('elodie', 'clue', 'camembert'),
          over: wisp('anna', 50, 85) })),
        () => b.mockPhone('elodie', phone('elodie', `<p class="hint">Give Nico a one-word clue</p><div class="word">FROMAGE</div>
          <div class="field">Your clue…</div><button class="primary">Give the clue (11 bricks left)</button><button class="ghost">Skip this word</button>`)),
        () => b.mockPhone('nico', phone('nico', `<p class="hint">Élodie’s clues</p><div class="card"><b>lait</b><span class="hint">you said beurre ✗</span><b>camembert</b></div>
          <div class="field">Your guess…</div><button class="primary">Guess</button>`)),
        () => b.mockPhone('sol', phone('sol', `<p class="hint">Team 1 is playing</p><div class="card"><b>lait</b><span class="hint">Nico: beurre ✗</span><b>camembert</b></div><p class="hint">Your turn next.</p>`))]);

    await b.frame('Nico finds it. The word shows to everyone, and on team 1 the roles swap: Nico gives the clues for the next word. Then it’s team 2’s turn.',
      [() => b.mockTv(pyramideTv({ mode: 'Classic · word 1 of 4', left: [10, 13], words: [1, 0], turn: 0,
          middle: `<div class="panel" style="align-items:center"><span class="dim">found in 3 bricks</span><b style="font-size:64px;color:var(--accent)">FROMAGE</b></div>${said('nico', 'guess', 'fromage', '<span class="tick">✓</span>')}` })),
        () => b.mockPhone('nico', phone('nico', `<div class="word">FROMAGE ✓</div><p class="hint">Next word: you give the clues, Élodie guesses.</p>`))]);

    await b.frame('Team 2’s turn: Pierre gives the clues, Sol guesses. Élodie sees the clues and guesses but not team 2’s word.',
      [() => b.mockTv(pyramideTv({ mode: 'Classic · word 1 of 4', left: [10, 12], words: [1, 0], turn: 1,
          middle: said('pierre', 'clue', 'pédale') })),
        () => b.mockPhone('pierre', phone('pierre', `<p class="hint">Give Sol a one-word clue</p><div class="word">VÉLO</div><div class="field">Your clue…</div><button class="primary">Give the clue (12 bricks left)</button><button class="ghost">Skip this word</button>`)),
        () => b.mockPhone('sol', phone('sol', `<p class="hint">Pierre’s clues</p><div class="card"><b>pédale</b></div><div class="field">Your guess…</div><button class="primary">Guess</button>`)),
        () => b.mockPhone('elodie', phone('elodie', `<p class="hint">Team 2 is playing</p><div class="card"><b>pédale</b></div>`))]);

    await b.frame('Both teams have played their four words or used up their bricks: the podium. Team 1 found more words.',
      [() => b.mockTv(tv('Pyramide · Classic', `<div class="col" style="align-items:center;justify-content:center;gap:30px">
          <div class="players">${team1.map((w) => `<figure>${avatar(w, 12)}<figcaption>${player(w)}</figcaption></figure>`).join('')}</div>
          <p class="big">🥇 Élodie &amp; Nico · 4 words · 11 bricks</p><p class="dim big">🥈 Pierre &amp; Sol · 3 words · 13 bricks</p></div>`))]);

    await b.frame('Back in Pyramide’s lobby. Pierre switches to the bidding duel and keeps the teams.',
      [() => b.mockTv(tv('Pyramide · lobby', `<div class="col">${tvPlayers(pyramidePlayers)}</div>
          <div class="col" style="flex:0 0 560px"><div class="panel"><h2>Bidding duel</h2><p>${player('elodie')} &amp; ${player('nico')}</p><p>vs ${player('pierre')} &amp; ${player('sol')}</p>
          <p class="dim">5 words · last game: Élodie &amp; Nico</p></div></div>`)),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Pyramide</h2>${seg('Mode', ['Classic', 'Bidding duel'], 'Bidding duel')}
          <div class="card"><b>Team 1</b>${player('elodie')}${player('nico')}</div><div class="card"><b>Team 2</b>${player('pierre')}${player('sol')}</div>
          <button class="primary">▶ Start</button><button class="danger">End Pyramide</button>`))]);

    await b.frame('The duel’s bidding. Both clue givers see the same word. Élodie offers to get it across in 4 clues; Pierre bids lower or passes. The guessers only see the bids.',
      [() => b.mockTv(pyramideTv({ mode: 'Bidding duel · word 1 of 5', left: [13, 13], words: [0, 0], turn: 1,
          middle: `<div class="panel" style="align-items:center"><span class="dim">Élodie bids</span><b style="font-size:72px;color:var(--accent)">4</b><span class="dim">Pierre: lower, or pass?</span></div>` })),
        () => b.mockPhone('elodie', phone('elodie', `<div class="word">PARAPLUIE</div><p class="hint">You bid 4. Waiting for Pierre.</p>`)),
        () => b.mockPhone('pierre', phone('pierre', `<div class="word">PARAPLUIE</div><p class="hint">Élodie bids 4 clues.</p>
          <div class="row"><button>−</button><b style="text-align:center;font-size:30px">3</b><button>+</button></div><button class="primary">Bid 3</button><button>Pass: Élodie plays</button>`)),
        () => b.mockPhone('nico', phone('nico', `<p class="hint">Bidding</p><div class="card"><span>Élodie bids <b>4</b></span><span class="hint">Pierre is deciding…</span></div>`))]);

    await b.frame('Pierre won the bid at 3: he has 3 clues to get Sol to the word. Found: a point for team 2; not found: a point for team 1.',
      [() => b.mockTv(pyramideTv({ mode: 'Bidding duel · word 1 of 5 · Pierre has 3 clues', left: [13, 11], words: [0, 0], turn: 1,
          middle: said('pierre', 'clue', 'pluie') + said('sol', 'guess', 'orage', '<span style="color:var(--bad)">✗</span>') + said('pierre', 'clue', 'ouvrir') })),
        () => b.mockPhone('pierre', phone('pierre', `<div class="word">PARAPLUIE</div><div class="field">Your clue…</div><button class="primary">Give the clue (1 left)</button>`)),
        () => b.mockPhone('sol', phone('sol', `<p class="hint">Pierre’s clues · 1 left</p><div class="card"><b>pluie</b><span class="hint">you said orage ✗</span><b>ouvrir</b></div><div class="field">Your guess…</div><button class="primary">Guess</button>`))]);

    await b.frame('After five words, the duel’s podium, then back to the lobby. Pierre ends Pyramide.',
      [() => b.mockTv(tv('Pyramide · Bidding duel', `<div class="col" style="align-items:center;justify-content:center;gap:30px">
          <div class="players">${team2.map((w) => `<figure>${avatar(w, 12)}<figcaption>${player(w)}</figcaption></figure>`).join('')}</div>
          <p class="big">🥇 Pierre &amp; Sol · 3 points</p><p class="dim big">🥈 Élodie &amp; Nico · 2 points</p></div>`)),
        () => b.mockPhone('pierre', phone('pierre', `<h2>Pyramide</h2><p class="hint">Last game: Pierre &amp; Sol</p><button class="primary">▶ Play again</button><button class="danger">End Pyramide</button>`))]);

    await b.frame('Back in the main game, the reward: Nico’s phone counts down 3, 2, 1 and his wisp turns into his character for good.',
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
    await b.d.tv.waitText('3/');
    await P.tap('Start game');
    await b.d.tv.waitFor('window.bloko.round()?.status === "running"');
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
