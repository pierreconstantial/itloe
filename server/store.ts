// Q3 — what the server keeps on disk:
//   bloko.state.json  the current game (State + server metadata), rewritten after every change
//   settings.json     the host's last settings, used to boot fresh games
//   bests.json        solo best scores, keyed "<size>:<mode>"

import { randomInt } from 'node:crypto';
import { quarantine, readJson, varPath, writeJsonAtomic } from './persist.ts';
import { initState, type Settings, type State } from './rules.ts';
import { savedAtMs, shiftDeadline } from './resume.ts';

export const STATE_FILE = varPath('bloko.state.json');
export const SETTINGS_FILE = varPath('settings.json');
export const BESTS_FILE = varPath('bests.json');

/** On-disk envelope: the pure game State plus server-only metadata.
 *  `savedAt`: epoch ms of the write (older envelopes: ISO string, or absent); drives the timed-pause shift. */
type SavedGame = { v: 1, savedAt?: number | string } & Game;

/** `bestPrevious`: solo record before the game on show, kept so "New best!" survives a restart. */
export type Game = { state: State, room: string, bestPrevious?: number | null };

function isSavedGame(x: unknown): x is SavedGame {
  const g = x as SavedGame;
  if (!g || g.v !== 1 || typeof g.room !== 'string' || !g.state) return false;
  const s = g.state;
  return ['lobby', 'playing', 'finished'].includes(s.phase)
    && typeof s.seed === 'number' && typeof s.size === 'number'
    && Array.isArray(s.order) && !!s.players && typeof s.players === 'object'
    && !!s.settings && !!s.rules
    && s.order.every((id) => !!s.players[id] && Array.isArray(s.players[id].board));
}

const isSettings = (x: unknown): x is Partial<Settings> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Room code: 4 letters, no I/O (read aloud off a TV). Stops stray devices, not security. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
}

function loadSettings(): { settings?: Partial<Settings>, note: string } {
  const r = readJson(SETTINGS_FILE, isSettings);
  if (r.kind === 'ok') return { settings: r.data, note: 'settings from settings.json' };
  if (r.kind === 'corrupt') return { note: `default settings (settings.json unreadable: ${r.error}; moved to ${quarantine(SETTINGS_FILE)})` };
  return { note: 'default settings' };
}

export function freshGame(): Game & { note: string } {
  const { settings, note } = loadSettings();
  return { state: initState(Date.now() >>> 0, settings), room: newRoomCode(), note };
}

/** Saved game in any phase → resume it (room code, host, players kept); missing/corrupt/--new → fresh game.
 *  A timed game keeps its remaining time: its deadline moves forward by the downtime since savedAt. */
export function loadGame(forceNew: boolean, now = Date.now()): Game & { how: string } {
  const fresh = (why: string) => {
    const g = freshGame();
    return { ...g, how: `new game (${why}), ${g.note}` };
  };
  if (forceNew) return fresh('--new / BLOKO_NEW=1');
  const r = readJson(STATE_FILE, isSavedGame);
  if (r.kind === 'missing') return fresh('no saved game');
  if (r.kind === 'corrupt') return fresh(`saved game unreadable: ${r.error}; moved to ${quarantine(STATE_FILE)}`);
  const { room, bestPrevious } = r.data;
  const since = savedAtMs(r.data.savedAt);
  const state = shiftDeadline(r.data.state, since, now);
  const names = state.order.map((id) => `${state.players[id].name} ${state.players[id].score}`).join(', ') || 'no players';
  const at = since === null ? 'at an unknown time' : new Date(since).toISOString();
  const shifted = state !== r.data.state
    ? `, timed clock paused ${Math.round((now - (since as number)) / 1000)} s while down (${Math.round(((state.deadline as number) - now) / 1000)} s left)`
    : '';
  return {
    state, room, bestPrevious,
    how: `RESUMED game saved ${at} — phase ${state.phase}, room ${room}, ${names}${shifted}`
      + ' (if piece weights changed since, upcoming hands differ from the original run; the game stays consistent)',
  };
}

export function saveGame(game: Game): void {
  try {
    writeJsonAtomic(STATE_FILE, { v: 1, savedAt: Date.now(), ...game } satisfies SavedGame);
  } catch (e) {
    console.error('[bloko] could not save the game:', e); // keep playing; the next change retries
  }
}

export function saveSettings(settings: Settings): void {
  try {
    writeJsonAtomic(SETTINGS_FILE, settings);
  } catch (e) {
    console.error('[bloko] could not save settings:', e);
  }
}

// ---------- solo best scores, keyed "<size>:<mode>" ----------

export type BestRecord = { score: number, name: string, at: string };
export type Bests = Record<string, BestRecord>;

const isBests = (x: unknown): x is Bests => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.values(x).every((b) => !!b && typeof (b as BestRecord).score === 'number');

export function loadBests(): Bests {
  const r = readJson(BESTS_FILE, isBests);
  if (r.kind === 'corrupt') console.error(`[bloko] bests.json unreadable (${r.error}); moved to ${quarantine(BESTS_FILE)}`);
  return r.kind === 'ok' ? r.data : {};
}

export function saveBests(bests: Bests): void {
  try {
    writeJsonAtomic(BESTS_FILE, bests);
  } catch (e) {
    console.error('[bloko] could not save best scores:', e);
  }
}
