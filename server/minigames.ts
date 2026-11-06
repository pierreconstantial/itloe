// The server list: every minigame's server code, by kind, beside the rules list (shared/minigames.js).
// Shared code (main.ts) handles the RPG's messages and hands every other message from a party member to
// the running round's minigame, with the sender's id and the time injected. Adding a minigame is one
// import line and one entry here, plus its type entries.

import type { Facts } from '../shared/campaign/types.js';
import type { MinigameKind } from '../shared/minigames.js';
import type { Game } from './store.ts';
import { makeBlockServer } from './blocks.ts';
import { makeQuizServer } from './quiz.ts';

export type ErrCode = 'full' | 'bad-place' | 'not-gm' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room' | 'taken' | 'refused';

/** What a minigame's message handler gets with a message: the sender, the time, the game master and
 *  the round's state. */
export type MessageCtx<S> = { id: string, now: number, gameMasterId: string | null, state: S };

/** The round's io, the same for its whole round (server/round.ts); once the round is over, what goes
 *  through it is dropped. `apply`: runs an action on the round now, false when refused or when the round
 *  is over (e.g. the quiz's verdict, arriving later). `send`: an unsaved message to every phone and TV
 *  (the wire's `unsaved`), never saved, for the round's running screens. */
export type MinigameIo<A> = {
  apply: (action: A) => boolean,
  send: (data: object) => void,
};

/** What a message comes to: an action (with the error the sender gets when the rules refuse it), a
 *  refusal, or nothing (null: ignored silently). */
export type Reply<A> = { action: A, refused?: ErrCode } | { refused: ErrCode } | null;

/** A minigame's server code. `message`: every message of a party member the RPG doesn't handle (the
 *  round messages start, again, newGame, endGame, retire and config are the RPG's). `inputs`: the server
 *  inputs a round starts with (the quiz: its candidate questions). `view`: the round's view, the same for
 *  everyone (it may filter, as the quiz hides answers until the reveal). `onChange`: after every change
 *  of its round, null where none of its rounds runs, before the save. */
export type MinigameServer<S, A, I = undefined> = {
  message: (m: any, ctx: MessageCtx<S>, io: MinigameIo<A>) => Reply<A>,
  inputs?: (settings: any, facts: Facts) => I,   // settings: the tableau's
  view: (state: S) => unknown,
  onChange?: (prev: S | null, next: S | null) => void,
};

/** The list, built once at boot (the block game's best scores live in the saved game, the quiz's bank on disk). */
export function makeMinigameServers(game: Game) {
  return {
    blocks: makeBlockServer(game),
    quiz: makeQuizServer(),
  } satisfies Record<MinigameKind, MinigameServer<any, any, any>>;
}
