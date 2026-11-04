// What the server keeps on disk:
//   bloko.state.json  the evening: envelope v2 { v:2, campaign, room, savedAt, bestPrevious }, rewritten
//                     after every change (atomic). A v1 envelope (bare block State, before the campaign)
//                     is migrated on load; the original file is kept next to it, never lost.
//   bests.json        solo best scores, keyed "<size>:<mode>"

import { copyFileSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { quarantine, readJson, varPath, writeJsonAtomic } from './persist.ts';
import type { State } from './rules.ts';
import { activityDeadline, isQuiz, savedAtMs, shiftActivityDeadline } from './resume.ts';
import { resolvePending } from '../shared/quiz/index.js';
import { fromLegacyState, loadCampaign, newCampaign, type Campaign, type Content } from './campaign.ts';

export const STATE_FILE = varPath('bloko.state.json');
export const BESTS_FILE = varPath('bests.json');

/** The live evening plus server metadata. `bestPrevious`: solo record before the game on show, kept so
 *  "New best!" survives a restart. */
export type Game = { campaign: Campaign, room: string, bestPrevious?: number | null };

/** On-disk envelope v2. `savedAt`: epoch ms of the write; drives the timed-pause shift. */
type SavedV2 = { v: 2, campaign: Campaign, room: string, savedAt: number, bestPrevious?: number | null };
/** Pre-campaign envelope (M2..slice 2): the bare block State. `savedAt` may be an ISO string or absent. */
type SavedV1 = { v: 1, savedAt?: number | string, state: State, room: string, bestPrevious?: number | null };

function isV1(x: unknown): x is SavedV1 {
  const g = x as SavedV1;
  if (!g || g.v !== 1 || typeof g.room !== 'string' || !g.state) return false;
  const s = g.state;
  return ['lobby', 'playing', 'finished'].includes(s.phase)
    && typeof s.seed === 'number' && typeof s.size === 'number'
    && Array.isArray(s.order) && !!s.players && typeof s.players === 'object'
    && !!s.settings && !!s.rules
    && s.order.every((id) => !!s.players[id] && Array.isArray(s.players[id].board));
}

/** Shape guard only; loadCampaign then makes the content safe (unknown ids dropped, re-settled). */
function isV2(x: unknown): x is SavedV2 {
  const g = x as SavedV2;
  const c = g?.campaign;
  return !!g && g.v === 2 && typeof g.room === 'string' && !!c && typeof c === 'object'
    && !!c.at && typeof c.at.node === 'string' && !!c.party && Array.isArray(c.party.order);
}

const isEnvelope = (x: unknown): x is SavedV1 | SavedV2 => isV2(x) || isV1(x);

/** Room code: 4 letters, no I/O (read aloud off a TV). Stops stray devices, not security. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
}

export function freshGame(content: Content): Game {
  return { campaign: newCampaign(content, Date.now() >>> 0), room: newRoomCode(), bestPrevious: null };
}

/** The live activity keeps its REMAINING time across the downtime (a timed block game, an open quiz
 *  question); a quiz's answers still waiting for the judge are never re-judged: they become wrong (E1). */
function resumeActivity(c: Campaign, since: number | null, now: number): Campaign {
  const s = c.at.activity;
  if (!s) return c;
  let next = shiftActivityDeadline(s, since, now);
  if (isQuiz(next)) next = resolvePending(next);
  return next === s ? c : { ...c, at: { ...c.at, activity: next } };
}

/** One line for the boot log. */
function describe(c: Campaign, room: string): string {
  const s = c.at.activity;
  const party = c.party.order.filter((id) => !c.party.players[id].left).map((id) => c.party.players[id].name).join(', ') || 'nobody yet';
  const scores = s && s.order.length ? ` (${s.order.map((id) => `${s.players[id].name} ${s.players[id].score}`).join(', ')})` : '';
  const game = !s ? '' : isQuiz(s)
    ? `, quiz ${s.phase}${s.round ? ` q${s.round.index + 1}/${s.questions.length}` : ''}${scores}`
    : `, block game ${s.phase}${scores}`;
  return `at ${c.at.node}${game}, room ${room}, party: ${party}, unlocked ${c.facts.unlocked.length}, news ${c.news.length}`;
}

/** Copies a pre-migration save aside, once per migration (a timestamped name never overwrites). */
function keepV1(): string {
  const dest = `${STATE_FILE}.v1-${Date.now()}.json`;
  try { if (!existsSync(dest)) copyFileSync(STATE_FILE, dest); } catch (e) { console.error('[elo-d-1] could not keep the v1 save:', e); }
  return dest;
}

/**
 * The saved evening in any state → resume it (room code, party, host, nested game, facts, news kept);
 * missing/corrupt/--new → a fresh campaign at content.start. A timed game keeps its remaining time.
 * A corrupt save is quarantined (kept for inspection), never deleted.
 */
export function loadGame(forceNew: boolean, content: Content, now = Date.now()): Game & { how: string } {
  const fresh = (why: string) => {
    const g = freshGame(content);
    return { ...g, how: `new evening (${why}): ${describe(g.campaign, g.room)}` };
  };
  if (forceNew) return fresh('--new / BLOKO_NEW=1');
  const r = readJson(STATE_FILE, isEnvelope);
  if (r.kind === 'missing') return fresh('no saved evening');
  if (r.kind === 'corrupt') return fresh(`save unreadable: ${r.error}; moved to ${quarantine(STATE_FILE)}`);

  const env = r.data;
  let campaign: Campaign;
  let how: string;
  try {
    if (env.v === 2) {
      campaign = loadCampaign(env.campaign, content);
      how = 'RESUMED';
    } else {
      campaign = fromLegacyState(env.state, content);
      how = `MIGRATED a v1 save (original kept as ${keepV1()}) and resumed`;
    }
  } catch (e: any) {
    return fresh(`save could not be loaded: ${e?.message ?? e}; moved to ${quarantine(STATE_FILE)}`);
  }

  const since = savedAtMs(env.savedAt);
  const shiftedCampaign = resumeActivity(campaign, since, now);
  const deadline = activityDeadline(shiftedCampaign.at.activity);
  const shifted = activityDeadline(campaign.at.activity) !== deadline && typeof deadline === 'number'
    ? `, timed clock paused ${Math.round((now - (since as number)) / 1000)} s while down (${Math.round((deadline - now) / 1000)} s left)`
    : '';
  const at = since === null ? 'at an unknown time' : new Date(since).toISOString();
  return {
    campaign: shiftedCampaign, room: env.room, bestPrevious: env.bestPrevious ?? null,
    how: `${how} evening saved ${at}: ${describe(shiftedCampaign, env.room)}${shifted}`,
  };
}

export function saveGame(game: Game): void {
  try {
    writeJsonAtomic(STATE_FILE, {
      v: 2, campaign: game.campaign, room: game.room, savedAt: Date.now(), bestPrevious: game.bestPrevious ?? null,
    } satisfies SavedV2);
  } catch (e) {
    console.error('[elo-d-1] could not save the evening:', e); // keep playing; the next change retries
  }
}

// ---------- solo best scores, keyed "<size>:<mode>" ----------

export type BestRecord = { score: number, name: string, at: string };
export type Bests = Record<string, BestRecord>;

const isBests = (x: unknown): x is Bests => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.values(x).every((b) => !!b && typeof (b as BestRecord).score === 'number');

export function loadBests(): Bests {
  const r = readJson(BESTS_FILE, isBests);
  if (r.kind === 'corrupt') console.error(`[elo-d-1] bests.json unreadable (${r.error}); moved to ${quarantine(BESTS_FILE)}`);
  return r.kind === 'ok' ? r.data : {};
}

export function saveBests(bests: Bests): void {
  try {
    writeJsonAtomic(BESTS_FILE, bests);
  } catch (e) {
    console.error('[elo-d-1] could not save best scores:', e);
  }
}
