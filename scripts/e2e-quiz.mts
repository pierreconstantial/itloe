// Quiz end-to-end (Contract E + E1, server side): a quiz tableau inside the campaign, played over real
// sockets against a real server this script kill -9s. Checks: the answer NEVER on the wire before the
// reveal (every raw message of every client is grepped), server-side judging, the round timer, host
// next/override/endGame, resume mid-question (deadline shifted, same question) and on the reveal,
// quiz.finished recorded once (counters, asked), no question asked twice in an evening, the bank never
// served, and with a tiny custom bank: an 'uncertain' typed answer → no judge → wrong → host override,
// and a verdict left pending by a crash is never re-judged (wrong on resume).
// Runs its OWN server (child process on PORT, scratch BLOKO_VAR). Usage:
//   PORT=3193 node scripts/e2e-quiz.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, Client, finish, HTTP, sleep } from './e2e-lib.mts';
import { expectedAnswers } from '../shared/quiz/judge-local.js';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-quiz-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;
const BANK_FILE = new URL('../data/quiz/placeholder.json', import.meta.url).pathname;
const QUIZ = 'childhood.quiz';
// a FIXED bank (a copy of the placeholder file): the real bank (data/quiz/*.json) grows and changes, and
// this test knows every answer of the bank it plays
const FIXED_BANK = join(VAR, 'fixed-bank');
mkdirSync(FIXED_BANK, { recursive: true });
copyFileSync(BANK_FILE, join(FIXED_BANK, 'placeholder.json'));

type Q = { id: string, q: string, choices?: string[], answer: string | number, accept?: string[], anecdote?: string };

let server: ChildProcess | null = null;
let log = '';
async function boot(fresh = false, env: Record<string, string> = {}): Promise<void> {
  log = '';
  server = spawn(process.execPath, [MAIN, ...(fresh ? ['--new'] : [])], {
    env: { ...process.env, PORT, BLOKO_VAR: VAR, BLOKO_HOST: '127.0.0.1', BLOKO_QUIZ_DIR: FIXED_BANK, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  for (let k = 0; k < 100; k++) {
    try { await fetch(`${HTTP}/api/join`); return; } catch { await sleep(50); }
  }
  throw new Error(`server did not come up:\n${log}`);
}
async function kill9(): Promise<void> {
  const s = server!;
  const gone = new Promise((r) => s.once('exit', r));
  s.kill('SIGKILL');
  await gone;
  server = null;
}

/** Every raw frame a client received, for the wire-level leak grep. */
const raws = new Map<Client, string[]>();
function tap(c: Client): Client {
  const list: string[] = [];
  raws.set(c, list);
  c.ws.addEventListener('message', (e) => list.push(String(e.data)));
  return c;
}
const lastView = (c: Client) => [...c.msgs].reverse().find((m) => m.t === 'view');
const qv = (c: Client) => lastView(c)?.quiz;
const untilQuiz = async (c: Client, pred: (q: any) => boolean, from = 0, ms = 4000) =>
  (await c.waitFor((m) => m.t === 'view' && !!m.quiz && pred(m.quiz), from, ms)).quiz;
const errOf = async (c: Client, msg: object): Promise<string | null> => {
  const i = c.mark();
  c.send(msg);
  try { return (await c.waitFor((m) => m.t === 'err', i, 600)).code; } catch { return null; }
};

let room = '';
async function player(label: string, character: string) {
  const c = new Client(label); await c.open(); tap(c);
  c.send({ t: 'hello', role: 'player', room });
  const i = c.mark();
  c.send({ t: 'join', character });
  const id = (await c.waitFor((m) => m.t === 'welcome', i)).playerId as string;
  return { c, id };
}
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open(); tap(c);
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', playerId });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
async function screen(label: string): Promise<Client> {
  const c = new Client(label); await c.open(); tap(c);
  const i = c.mark();
  c.send({ t: 'hello', role: 'screen' });
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}

/** The leak grep: in every raw frame where this question is open, no accepted spelling of its answer
 *  appears as a JSON string (other than a displayed choice: that is the question itself). */
function leakFree(question: Q): { ok: boolean, frames: number, leak?: string } {
  let frames = 0;
  for (const list of raws.values()) {
    for (const raw of list) {
      if (!raw.includes(JSON.stringify(question.q))) continue;
      const m = JSON.parse(raw);
      if (m.t !== 'view' || m.quiz?.phase !== 'question') continue;
      frames++;
      const shown = new Set<string>(m.quiz.round.question.choices ?? []);
      for (const text of expectedAnswers(question)) {
        if (!shown.has(text) && raw.includes(JSON.stringify(text))) return { ok: false, frames, leak: text };
      }
      if (/"(verdict|ok)":/.test(raw)) return { ok: false, frames, leak: 'a verdict field' };
      if (question.anecdote && raw.includes(question.anecdote.slice(0, 40))) return { ok: false, frames, leak: 'the anecdote' };
    }
  }
  return { ok: true, frames };
}

/** What to send for a right / wrong answer to the open round (the test knows the bank). */
function answerFor(round: any, question: Q, right: boolean): object {
  if (round.question.choices) {
    const correct = round.question.choices.indexOf(question.choices![question.answer as number]);
    return { t: 'answer', choice: right ? correct : (correct + 1) % round.question.choices.length };
  }
  return { t: 'answer', text: right ? expectedAnswers(question)[0] : 'zzz qqq' };
}

let P!: Client, E!: Client, T!: Client;
let idP = '', idE = '';
async function restart(step: string, expectPhase: string): Promise<any> {
  const before = qv(T);
  await kill9();
  await boot();
  for (const c of [P, E, T]) c.ws.close();
  P = await rejoin('P', idP);
  E = await rejoin('E', idE);
  T = await screen('T');
  const after = qv(T);
  check(after?.phase === expectPhase && after?.round?.question.q === before?.round?.question.q && after?.round?.index === before?.round?.index,
    `kill -9 ${step} → same quiz, same question, phase ${after?.phase}`);
  return { before, after };
}

try {
  const bank: Q[] = JSON.parse(readFileSync(BANK_FILE, 'utf8')).questions;
  const byText = new Map(bank.map((q) => [q.q, q]));

  await boot(true);
  room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  check(/quiz bank: \d+ questions/.test(log), 'boot log: the quiz bank was loaded and validated');
  check((await fetch(`${HTTP}/data/quiz/placeholder.json`)).status === 404, 'the bank is never served (GET /data/quiz/… → 404)');

  ({ c: P, id: idP } = await player('P', 'pierre'));
  ({ c: E, id: idE } = await player('E', 'elodie'));
  T = await screen('T');

  // ---------- into the quiz tableau ----------
  let i = P.mark();
  P.send({ t: 'gm', op: { op: 'unlock', node: 'childhood' } });
  P.send({ t: 'gm', op: { op: 'goto', node: QUIZ } });
  let q = await untilQuiz(P, (x) => x.phase === 'lobby', i);
  const v0 = lastView(P);
  check(Array.isArray(q.credits) && q.credits.some((c: string) => /Itloe/.test(c)), `credits in the lobby view (${q.credits?.join(' | ')})`);
  check(v0.campaign.at.node === QUIZ && v0.state === null && q.order.length === 2 && q.hostId === idP,
    'quiz tableau → quiz lobby with the party seated; view.state null (block clients never see a quiz)');
  check(await errOf(E, { t: 'config', patch: { count: 3 } }) === 'not-host', 'quiz config: host only');
  i = P.mark(); P.send({ t: 'config', patch: { count: 3, seconds: 10, mode: 'mixed' } });
  q = await untilQuiz(P, (x) => x.settings.count === 3 && x.settings.seconds === 10, i);
  check(true, 'host configures the quiz (3 questions, 10 s)');
  check(await errOf(E, { t: 'start' }) === 'not-host', 'quiz start: host only');
  check(await errOf(E, { t: 'place', piece: 0, x: 0, y: 0 }) === 'not-playing', 'block messages during a quiz → not-playing');

  i = P.mark(); P.send({ t: 'start' });
  q = await untilQuiz(P, (x) => x.phase === 'question', i);
  const shown: Q[] = [];

  // ---------- round 1: P right, E wrong → the last answer reveals at once ----------
  let question = byText.get(q.round.question.q)!;
  shown.push(question);
  check(!!question && q.round.answer === null && q.round.answers === null && Array.isArray(q.round.answered), 'question view: the question, nobody\'s answer, no answer');
  check(await errOf(E, { t: 'next' }) === 'not-host', 'next: host only');
  i = T.mark(); P.send(answerFor(q.round, question, true));
  q = await untilQuiz(T, (x) => x.round?.answered.includes(idP), i);
  check(q.phase === 'question' && q.round.answers === null, 'one answer in: still a question, still no verdicts on the wire');
  check(await errOf(P, answerFor(q.round, question, false)) === 'refused', 'a second answer in the same round → refused');
  i = T.mark(); E.send(answerFor(q.round, question, false));
  q = await untilQuiz(T, (x) => x.phase === 'reveal', i);
  check(q.round.answers[idP].ok === true && q.round.answers[idE].ok === false, 'everyone answered → reveal at once, with the verdicts');
  check(q.round.answer.text === expectedAnswers(question)[0], `reveal shows the answer ("${q.round.answer.text}")`);
  check(q.round.answer.source === (question as any).source && q.credits.length > 0, `reveal shows the question's source ("${q.round.answer.source}")`);
  check(q.players[idP].score >= 100 && q.players[idP].score <= 150 && q.players[idE].score === 0, `scores: right 100 + speed (${q.players[idP].score}), wrong 0`);
  let leak = leakFree(question);
  check(leak.ok && leak.frames > 0, `round 1: the answer never on the wire before the reveal (${leak.frames} question frames grepped)${leak.leak ? ` LEAK: ${leak.leak}` : ''}`);
  await restart('on the reveal', 'reveal');

  // ---------- round 2: kill -9 mid-question; then the timer closes it ----------
  i = T.mark(); P.send({ t: 'next' });
  q = await untilQuiz(T, (x) => x.phase === 'question' && x.round.index === 1, i);
  question = byText.get(q.round.question.q)!;
  shown.push(question);
  const deadline0 = q.round.deadline;
  await sleep(1500);
  const { after } = await restart('mid-question', 'question');
  check(after.round.deadline > deadline0, `the open question kept its remaining time (deadline +${after.round.deadline - deadline0} ms)`);
  i = T.mark(); P.send(answerFor(after.round, question, true));
  await untilQuiz(T, (x) => x.round?.answered.includes(idP), i);
  q = await untilQuiz(T, (x) => x.phase === 'reveal' && x.round.index === 1, i, 15_000);
  check(!q.round.answers[idE] && q.round.answers[idP].ok === true, 'E never answered → the round timer closed it (reveal)');
  leak = leakFree(question);
  check(leak.ok && leak.frames > 0, `round 2: no leak across the restart (${leak.frames} frames)${leak.leak ? ` LEAK: ${leak.leak}` : ''}`);
  const scoreP = q.players[idP].score;
  i = T.mark(); P.send({ t: 'override', target: idP, ok: false });
  q = await untilQuiz(T, (x) => x.round.answers[idP].ok === false, i);
  check(q.players[idP].score === scoreP - q.round.answers[idP].points && q.round.answers[idP].overridden, 'host override: right → wrong, points taken back');
  i = T.mark(); P.send({ t: 'override', target: idP, ok: true });
  q = await untilQuiz(T, (x) => x.round.answers[idP].ok === true, i);
  check(q.players[idP].score === scoreP, '…and back: points restored');
  check(await errOf(P, { t: 'override', target: idE, ok: true }) === 'refused', 'override on someone who did not answer → refused');

  // ---------- round 3 → finished → campaign facts ----------
  i = T.mark(); P.send({ t: 'next' });
  q = await untilQuiz(T, (x) => x.phase === 'question' && x.round.index === 2, i);
  question = byText.get(q.round.question.q)!;
  shown.push(question);
  P.send(answerFor(q.round, question, true));
  E.send(answerFor(q.round, question, true));
  q = await untilQuiz(T, (x) => x.phase === 'reveal' && x.round.index === 2, i);
  i = T.mark(); P.send({ t: 'next' });
  q = await untilQuiz(T, (x) => x.phase === 'finished', i);
  let f = lastView(T).campaign.facts;
  check(q.endReason === 'done' && f.counters['quiz.played'] === 1 && f.counters[`node.${QUIZ}.finished`] === 1, 'last question → finished, quiz.played = 1, node finished');
  check(f.counters['quiz.correct.pierre'] === 3 && f.counters['quiz.correct.elodie'] === 1 && f.counters['quiz.won.pierre'] === 1, 'counters: correct answers per character, the winner');
  check(JSON.stringify([...f.asked].sort()) === JSON.stringify(shown.map((x) => x.id).sort()), `facts.asked = the 3 questions shown (${f.asked.join(', ')})`);
  check(f.totals.quiz?.pierre === q.players[idP].score, 'quiz totals carry the quiz score (per kind)');
  await restart('on the finished quiz', 'finished');
  f = lastView(T).campaign.facts;
  check(f.counters['quiz.played'] === 1, 'restart on the podium: still counted once');

  // ---------- a second quiz never repeats a question of the evening ----------
  i = T.mark(); P.send({ t: 'newGame' });
  await untilQuiz(T, (x) => x.phase === 'lobby', i);
  const second: string[] = [];
  i = T.mark(); P.send({ t: 'start' });
  q = await untilQuiz(T, (x) => x.phase === 'question', i);
  for (let r = 0; r < 3; r++) {
    question = byText.get(q.round.question.q)!;
    second.push(question.id);
    i = T.mark(); P.send(answerFor(q.round, question, true)); E.send(answerFor(q.round, question, false));
    await untilQuiz(T, (x) => x.phase === 'reveal' && x.round.index === r, i);
    i = T.mark(); P.send({ t: 'next' });
    q = await untilQuiz(T, (x) => (x.phase === 'question' && x.round.index === r + 1) || x.phase === 'finished', i);
  }
  check(second.every((id) => !shown.some((x) => x.id === id)), `second quiz: 3 new questions (${second.join(', ')}), none asked earlier`);
  check(lastView(T).campaign.facts.asked.length === 6, 'asked grows to 6');
  // play again from the podium: a new quiz at once, as in the block game
  check(await errOf(P, { t: 'start' }) === 'refused', 'quiz start on the podium → refused (start is for the lobby)');
  check(await errOf(E, { t: 'again' }) === 'not-host', 'quiz again: host only');
  i = T.mark(); P.send({ t: 'again' });
  q = await untilQuiz(T, (x) => x.phase === 'question', i);
  check(q.round.index === 0 && q.order.length === 2 && Object.values<any>(q.players).every((p) => p.score === 0), 'host again on the podium → question 1 of a new quiz, same players, scores reset');
  i = T.mark(); P.send({ t: 'endGame' });
  q = await untilQuiz(T, (x) => x.phase === 'finished', i);
  check(q.endReason === 'host' && lastView(T).campaign.facts.counters['quiz.played'] === 3, 'host endGame finishes a quiz (counts as played)');

  // ---------- a tiny custom bank: uncertain → no judge → wrong → override; pending never re-judged ----------
  for (const c of [P, E, T]) c.ws.close();
  await kill9();
  const dir = join(VAR, 'bank');
  mkdirSync(dir, { recursive: true });
  const tiny = ['Victor Hugo', 'Gustave Flaubert', 'Émile Zola'].map((answer, k) => ({
    id: `t${k}`, q: `Auteur ${k} ?`, answer, category: 'test', level: 1, source: 'e2e',
    anecdote: `Indice : l'auteur est ${answer}.`, // gives the answer away, like many real anecdotes
  }));
  writeFileSync(join(dir, 'tiny.json'), JSON.stringify({ questions: tiny }));
  await boot(true, { BLOKO_QUIZ_DIR: dir });
  room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  ({ c: P, id: idP } = await player('P', 'pierre'));
  ({ c: E, id: idE } = await player('E', 'elodie'));
  T = await screen('T');
  P.send({ t: 'gm', op: { op: 'unlock', node: 'childhood' } });
  P.send({ t: 'gm', op: { op: 'goto', node: QUIZ } });
  await untilQuiz(P, (x) => x.phase === 'lobby');
  i = P.mark(); P.send({ t: 'config', patch: { count: 3, mode: 'text' } });
  await untilQuiz(P, (x) => x.settings.count === 3 && x.settings.mode === 'text', i);
  i = T.mark(); P.send({ t: 'start' });
  q = await untilQuiz(T, (x) => x.phase === 'question', i);
  const tq = tiny.find((x) => x.q === q.round.question.q)!;
  const surname = tq.answer.split(' ').pop()!;
  i = T.mark(); P.send({ t: 'answer', text: surname }); // "Hugo" for "Victor Hugo": uncertain
  E.send({ t: 'answer', text: tq.answer.toLowerCase() }); // exact (case): right
  q = await untilQuiz(T, (x) => x.phase === 'reveal' && x.round.answers[idP]?.ok !== null, i);
  check(q.round.answers[idP].ok === false && q.round.answers[idE].ok === true, `"${surname}" for "${tq.answer}": uncertain → no judge → wrong; exact → right`);
  const tleak = leakFree(tq);
  check(tleak.ok && tleak.frames > 0 && q.round.answer.anecdote === tq.anecdote,
    `the anecdote (it names the answer) only arrives with the reveal (${tleak.frames} question frames grepped)${tleak.leak ? ` LEAK: ${tleak.leak}` : ''}`);
  i = T.mark(); P.send({ t: 'override', target: idP, ok: true });
  q = await untilQuiz(T, (x) => x.round.answers[idP].ok === true, i);
  check(q.players[idP].score > 0, 'the host overrides it to right: points credited');

  // a verdict left pending by a crash: forge it in the save, restart → wrong, never re-judged
  i = T.mark(); P.send({ t: 'next' });
  q = await untilQuiz(T, (x) => x.phase === 'question' && x.round.index === 1, i);
  P.send({ t: 'answer', text: 'something' });
  await untilQuiz(T, (x) => x.round?.answered.includes(idP), i);
  await kill9();
  const FILE = join(VAR, 'bloko.state.json');
  const env = JSON.parse(readFileSync(FILE, 'utf8'));
  env.campaign.at.activity.round.answers[idP].ok = null; // as if the judge had not answered yet
  env.campaign.at.activity.round.answers[idP].verdict = 'uncertain';
  writeFileSync(FILE, JSON.stringify(env));
  await boot(false, { BLOKO_QUIZ_DIR: dir });
  for (const c of [P, E, T]) c.ws.close();
  P = await rejoin('P', idP); E = await rejoin('E', idE); T = await screen('T');
  i = T.mark(); E.send({ t: 'answer', text: 'zzz' }); // the last answer reveals the round
  q = await untilQuiz(T, (x) => x.phase === 'reveal', i);
  check(q.round.answers[idP].ok === false, 'a verdict pending at the crash → wrong on resume (never re-judged)');

  for (const c of [P, E, T]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
