// Lobby: huge join URL + 4 player slots filling live.

import { h, colorDot } from './dom.js';

const MAX_PLAYERS = 4;

/** @typedef {import('../../shared/game.js').State} State */

/** URL phones type to join; same host/port as this page. */
export function joinUrl() {
  return `http://${location.host}/play`;
}

/** @param {State} s */
export function renderLobby(s) {
  const root = h('section', 'lobby', [
    h('h1', 'title', ['BLOKO']),
    h('p', 'lobby-invite', ['Join the game:']),
    h('div', 'join-url', [joinUrl()]),
  ]);

  const slots = h('div', 'slots');
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const id = s.order[i];
    const p = id ? s.players[id] : undefined;
    if (p) {
      const slot = h('div', 'slot slot-taken', [colorDot(p.color), h('span', 'slot-name', [p.name])]);
      if (id === s.hostId) slot.append(h('span', 'host-badge', ['host']));
      slots.append(slot);
    } else {
      slots.append(h('div', 'slot slot-empty', ['Waiting…']));
    }
  }
  root.append(slots);

  const n = s.order.length;
  root.append(h('p', 'lobby-count', [`${n}/${MAX_PLAYERS} player${n === 1 ? '' : 's'}`]));
  if (n > 0) root.append(h('p', 'lobby-hint', ['The host starts the game from their phone']));
  return root;
}
