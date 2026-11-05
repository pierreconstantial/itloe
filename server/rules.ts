// The server's single door to shared/game.js.

import { startGame, reduce, ranking } from '../shared/game.js';

export { startGame, reduce, ranking };

export type State = NonNullable<ReturnType<typeof startGame>>;
export type Settings = State['rules'];
/** Reducer input: wire messages are rebuilt into this, server-only fields (now, timeUp) injected by the server. */
export type ServerAction = Parameters<typeof reduce>[1];
