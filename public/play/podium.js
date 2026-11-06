// The phone's podium, the same for every minigame: a round's players ranked by the shared rule, with medals,
// plus the minigame's extras from its round screens (./minigames.js). A building block: a lobby draws it and
// adds its own buttons under it.
import { ranking } from '../../shared/ranking.js';
import { dotEl } from './dom.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').RoundPlayers} RoundPlayers */

const MEDALS = ['🥇', '🥈', '🥉', ''];

/** The podium's kicker, by how the round ended. @type {Record<string, string>} */
const ENDINGS = { time: "⏰ Time's up!", gm: 'The game master ended the game.' };

/**
 * The podium's kicker, title, extra lines and ranking, for `meId`'s phone.
 * @param {RoundView} r the finished round @param {import('./minigames.js').PodiumExtras} extras @param {string} meId
 * @returns {HTMLElement[]}
 */
export function renderPodium(r, extras, meId) {
  const v = /** @type {RoundPlayers} */ (r.view);
  /** @param {string} tag @param {string} cls @param {string} text */
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const nodes = [];
  const kicker = extras.kicker ?? (v.endReason ? ENDINGS[v.endReason] ?? '' : '');
  if (kicker) nodes.push(el('p', 'kicker podium-kicker', kicker));
  const ranked = ranking(v);
  const myRank = ranked.find((x) => x.id === meId)?.rank;
  nodes.push(el('h2', 'podium-title', extras.title ?? (myRank !== 1 ? 'Podium'
    : ranked.filter((x) => x.rank === 1).length > 1 ? "It's a tie! 🎉" : 'You win! 🎉')));
  for (const text of extras.lines ?? []) nodes.push(el('p', 'dim', text));

  const ol = el('ol', 'player-list podium-list', '');
  for (const { id, rank, score } of ranked) {
    const p = v.players[id];
    const li = document.createElement('li');
    if (rank === 1) li.className = 'champion'; // ties share rank 1: co-champions
    if (id === meId) li.classList.add('me');
    li.append(
      document.createTextNode(`${MEDALS[rank - 1] || `${rank}.`} `),
      dotEl(p.color),
      document.createTextNode(` ${p.name} — ${score}${extras.rowExtra?.(id) ?? ''}`),
    );
    ol.append(li);
  }
  nodes.push(ol);
  return nodes;
}
