// The server list: every minigame's server code, by kind, beside the rules list (shared/minigames.js).
// Shared code (main.ts) handles the main game's messages and hands every other message from a party member
// to the running minigame, with the sender's id, the time, the game master and the evening's asked ids
// injected. Adding a minigame is one import line and one entry here, plus its type entries.

import type { MinigameKind } from '../shared/minigames.js';
import type { Game } from './store.ts';
import { makeBlockServer } from './blocks.ts';
import { makeQuizServer } from './quiz.ts';
import { plainLobbyServer } from './plain-lobby.ts';

export type ErrCode = 'full' | 'bad-place' | 'not-gm' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room' | 'taken' | 'refused';

/** What a message handler gets with a message: the sender, the time, the game master, the state, and the
 *  content ids used up this evening (`asked`: shared/campaign askedSoFar, for a round's server inputs). */
export type MessageCtx<S> = { id: string, now: number, gameMasterId: string | null, state: S, asked: string[] };

/** The running minigame's io, the same from its start to its end (server/round.ts); once it has ended,
 *  what goes through it is dropped. `apply`: runs an action on the minigame now, false when refused or when
 *  it has ended (e.g. the quiz's verdict, arriving later). `send`: an unsaved message to every phone and TV
 *  (the wire's `unsaved`), never saved, for its screens. */
export type MinigameIo<A> = {
  apply: (action: A) => boolean,
  send: (data: object) => void,
};

/** What a message comes to: an action (with the error the sender gets when the rules refuse it), a
 *  refusal, or nothing (null: ignored silently). */
export type Reply<A> = { action: A, refused?: ErrCode } | { refused: ErrCode } | null;

/** A minigame's server code. `message`: every message of a party member the main game doesn't handle
 *  (startMinigame and endMinigame are the main game's). `view`: the minigame's view, the same for everyone
 *  (it may filter, as the quiz hides answers until the reveal). `onChange`: after every change of its state,
 *  null where it doesn't run, before the save. */
export type MinigameServer<S, A> = {
  message: (m: any, ctx: MessageCtx<S>, io: MinigameIo<A>) => Reply<A>,
  view: (state: S) => unknown,
  onChange?: (prev: S | null, next: S | null) => void,
};

/** A round's server code, which a plain lobby wraps (server/plain-lobby.ts). `message`: the messages its
 *  lobby passes on while a round runs. `inputs`: what a round starts with besides the players and settings
 *  (the quiz: its candidate questions, minus `asked`). `view`: the round's view. `onChange`: after every
 *  change of its round, null where no round is, before the save. */
export type RoundServer<S, A, I = undefined> = {
  message: (m: any, ctx: MessageCtx<S>, io: MinigameIo<A>) => Reply<A>,
  inputs?: (settings: any, asked: string[]) => I,
  view: (state: S) => unknown,
  onChange?: (prev: S | null, next: S | null) => void,
};

/** The list, built once at boot (the block game's best scores live in the saved game, the quiz's bank on disk). */
export function makeMinigameServers(game: Game) {
  return {
    blocks: plainLobbyServer(makeBlockServer(game)),
    quiz: plainLobbyServer(makeQuizServer()),
  } satisfies Record<MinigameKind, MinigameServer<any, any>>;
}
