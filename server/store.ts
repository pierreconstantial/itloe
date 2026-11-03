// Q3 — what the server keeps on disk:
//   bloko.state.json  the current game (State + server metadata), rewritten after every change
//   settings.json     the host's last settings, used to boot fresh games

import { randomInt } from 'node:crypto';
import { quarantine, readJson, varPath, writeJsonAtomic } from './persist.ts';
import { initState, type Settings, type State } from './rules.ts';

export const STATE_FILE = varPath('bloko.state.json');
export const SETTINGS_FILE = varPath('settings.json');

/** On-disk envelope: the pure game State plus server-only metadata. */
type SavedGame = { v: 1, savedAt: string, room: string, state: State };

export type Game = { state: State, room: string };

function isSavedGame(x: unknown): x is SavedGame {
  const g = x as SavedGame;
  if (!g || g.v !== 1 || typeof g.room !== 'string' || !g.state) return false;
  const s = g.state;
  return ['lobby', 'playing', 'finished'].includes(s.phase)
    && typeof s.seed === 'number' && typeof s.size === 'number'
    && Array.isArray(s.order) && !!s.players && typeof s.players === 'object'
    && s.order.every((id) => !!s.players[id] && Array.isArray(s.players[id].board));
}

const isSettings = (x: unknown): x is Settings => !!x && typeof x === 'object' && !Array.isArray(x);

/** Room code: 4 letters, no I/O (read aloud off a TV). Stops stray devices, not security. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
}

function loadSettings(): { settings?: Settings, note: string } {
  const r = readJson(SETTINGS_FILE, isSettings);
  if (r.kind === 'ok') return { settings: r.data, note: 'settings from settings.json' };
  if (r.kind === 'corrupt') return { note: `default settings (settings.json unreadable: ${r.error}; moved to ${quarantine(SETTINGS_FILE)})` };
  return { note: 'default settings' };
}

export function freshGame(): Game & { note: string } {
  const { settings, note } = loadSettings();
  return { state: initState(Date.now() >>> 0, settings), room: newRoomCode(), note };
}

/** Saved game in phase playing/finished → resume it; anything else → fresh game. */
export function loadGame(forceNew: boolean): Game & { how: string } {
  const fresh = (why: string) => {
    const g = freshGame();
    return { ...g, how: `new game (${why}), ${g.note}` };
  };
  if (forceNew) return fresh('--new / BLOKO_NEW=1');
  const r = readJson(STATE_FILE, isSavedGame);
  if (r.kind === 'missing') return fresh('no saved game');
  if (r.kind === 'corrupt') return fresh(`saved game unreadable: ${r.error}; moved to ${quarantine(STATE_FILE)}`);
  const { state, room, savedAt } = r.data;
  if (state.phase === 'lobby') return fresh('saved game was still in the lobby');
  const names = state.order.map((id) => `${state.players[id].name} ${state.players[id].score}`).join(', ');
  return {
    state, room,
    how: `RESUMED game saved ${savedAt} — phase ${state.phase}, ${names}`
      + ' (if piece weights changed since, upcoming hands differ from the original run; the game stays consistent)',
  };
}

export function saveGame(game: Game): void {
  try {
    writeJsonAtomic(STATE_FILE, { v: 1, savedAt: new Date().toISOString(), ...game } satisfies SavedGame);
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
