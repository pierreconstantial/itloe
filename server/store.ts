// What the server keeps on disk:
//   bloko.state.json  the evening: envelope v2 { v:2, campaign, room, savedAt, bestPrevious }, rewritten
//                     after every change (atomic). A file in any other shape is quarantined, never lost.
//   bests.json        solo best scores, keyed "<size>:<mode>"

import { randomInt } from 'node:crypto';
import { quarantine, readJson, varPath, writeJsonAtomic } from './persist.ts';
import { roundDeadline, savedAtMs, shiftRound } from './resume.ts';
import { minigame } from '../shared/minigames.js';
import { loadCampaign, newCampaign, UnknownMinigameError, type Campaign, type Content } from './campaign.ts';

export const STATE_FILE = varPath('bloko.state.json');
export const BESTS_FILE = varPath('bests.json');

/** The live evening plus server metadata. `bestPrevious`: solo record before the game on show, kept so
 *  "New best!" survives a restart. */
export type Game = { campaign: Campaign, room: string, bestPrevious?: number | null };

/** On-disk envelope v2. `savedAt`: epoch ms of the write; drives the timed-pause shift. */
type SavedV2 = { v: 2, campaign: Campaign, room: string, savedAt: number, bestPrevious?: number | null };
/** Shape guard only; loadCampaign then makes the content safe (unknown ids dropped, re-settled). */
function isV2(x: unknown): x is SavedV2 {
  const g = x as SavedV2;
  const c = g?.campaign;
  return !!g && g.v === 2 && typeof g.room === 'string' && !!c && typeof c === 'object'
    && !!c.at && typeof c.at.node === 'string' && !!c.party && Array.isArray(c.party.order);
}

/** Room code: 4 letters, no I/O (read aloud off a TV). Stops stray devices, not security. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
}

export function freshGame(content: Content): Game {
  return { campaign: newCampaign(content, Date.now() >>> 0), room: newRoomCode(), bestPrevious: null };
}

/** The round keeps its REMAINING time across the downtime (a timed block game, an open quiz question),
 *  then its minigame's resume step runs (the quiz: answers still waiting for the judge become wrong, E1). */
function resumeRound(c: Campaign, since: number | null, now: number): Campaign {
  const shifted = shiftRound(c, since, now);
  const rules = minigame(shifted.at.kind);
  const s = shifted.at.activity;
  const next = rules?.resume && s ? rules.resume(s) : s;
  return next === s ? shifted : { ...shifted, at: { ...shifted.at, activity: next } };
}

/** One line for the boot log. */
function describe(c: Campaign, room: string): string {
  const s = c.at.activity;
  const rules = minigame(c.at.kind);
  const party = c.party.order.filter((id) => !c.party.players[id].left).map((id) => c.party.players[id].name).join(', ') || 'nobody yet';
  const game = s && rules ? `, ${rules.describe(s)}` : '';
  return `at ${c.at.node}${game}, room ${room}, party: ${party}, unlocked ${c.facts.unlocked.length}, news ${c.news.length}`;
}

/**
 * The saved evening in any state → resume it (room code, party, nested game, facts, news kept);
 * missing/corrupt/--new → a fresh campaign at content.start. A timed game keeps its remaining time.
 * A corrupt save is quarantined (kept for inspection), never deleted. A round of a minigame this release
 * does not have throws: the boot stops and the save stays as it is, for the release that has it. A minigame
 * this release has but can't resume (a fix deployed while it ran) is ended; the evening is kept (loadCampaign).
 */
export function loadGame(forceNew: boolean, content: Content, now = Date.now()): Game & { how: string } {
  const fresh = (why: string) => {
    const g = freshGame(content);
    return { ...g, how: `new evening (${why}): ${describe(g.campaign, g.room)}` };
  };
  if (forceNew) return fresh('--new / BLOKO_NEW=1');
  const r = readJson(STATE_FILE, isV2);
  if (r.kind === 'missing') return fresh('no saved evening');
  if (r.kind === 'corrupt') return fresh(`save unreadable: ${r.error}; moved to ${quarantine(STATE_FILE)}`);

  const env = r.data;
  let campaign: Campaign;
  try {
    campaign = loadCampaign(env.campaign, content, now);
  } catch (e: any) {
    if (e instanceof UnknownMinigameError) {
      throw new Error(`cannot resume ${STATE_FILE}: ${e.message}. Boot stopped; the save is left untouched for a release that has "${e.kind}".`);
    }
    return fresh(`save could not be loaded: ${e?.message ?? e}; moved to ${quarantine(STATE_FILE)}`);
  }

  const since = savedAtMs(env.savedAt);
  const shiftedCampaign = resumeRound(campaign, since, now);
  const deadline = roundDeadline(shiftedCampaign.at);
  const shifted = roundDeadline(campaign.at) !== deadline && typeof deadline === 'number'
    ? `, timed clock paused ${Math.round((now - (since as number)) / 1000)} s while down (${Math.round((deadline - now) / 1000)} s left)`
    : '';
  const at = since === null ? 'at an unknown time' : new Date(since).toISOString();
  const ended = env.campaign.at?.activity && !campaign.at.activity && campaign.at.node === env.campaign.at.node
    ? `; its ${env.campaign.at.kind} could not be resumed, so it was ended (its finished rounds recorded)` : '';
  return {
    campaign: shiftedCampaign, room: env.room, bestPrevious: env.bestPrevious ?? null,
    how: `RESUMED evening saved ${at}: ${describe(shiftedCampaign, env.room)}${shifted}${ended}`,
  };
}

export function saveGame(game: Game): void {
  try {
    writeJsonAtomic(STATE_FILE, {
      v: 2, campaign: game.campaign, room: game.room, savedAt: Date.now(), bestPrevious: game.bestPrevious ?? null,
    } satisfies SavedV2);
  } catch (e) {
    console.error('[itloe] could not save the evening:', e); // keep playing; the next change retries
  }
}

// ---------- solo best scores, keyed "<size>:<mode>" ----------

export type BestRecord = { score: number, name: string, at: string };
export type Bests = Record<string, BestRecord>;

const isBests = (x: unknown): x is Bests => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.values(x).every((b) => !!b && typeof (b as BestRecord).score === 'number');

export function loadBests(): Bests {
  const r = readJson(BESTS_FILE, isBests);
  if (r.kind === 'corrupt') console.error(`[itloe] bests.json unreadable (${r.error}); moved to ${quarantine(BESTS_FILE)}`);
  return r.kind === 'ok' ? r.data : {};
}

export function saveBests(bests: Bests): void {
  try {
    writeJsonAtomic(BESTS_FILE, bests);
  } catch (e) {
    console.error('[itloe] could not save best scores:', e);
  }
}
