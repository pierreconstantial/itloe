// Campaign engine (Contract D v2 + A1): the evening as a pure state machine over content data.
// Pure JSDoc ESM, no I/O, no clock, no randomness — runs in Node and browsers like shared/game.js.
//
// PUBLIC API (types in ./types.js; reducers return the SAME object when they refuse an action)
//   newCampaign(content, seed)               → Campaign in the room at content.start, empty party
//   loadCampaign(raw, content)               → Campaign; drops ids the content no longer has, re-settles
//   reduceCampaign(campaign, action, content)→ Campaign; actions: join leave enter back start again newGame
//                                              activity config event ack gm
//   activityOf(campaign)                     → the round's state (block game or quiz), or null between rounds
//   roundStatus(campaign)                    → 'running' | 'finished', or null (no round: the room at a
//                                              tableau, the hub, a world); running: enter/back refused
//   isUnlocked(campaign, nodeId) · nodeAt(campaign, content)
//   holds(cond, facts) · record(facts, event) · settle(facts, content, fromSeq) → { facts, news }
//   validateContent(content) → string[] · zoneAt(content, nodeId, x, y) → child id | null
//   roomAt(content, nodeId) → the node's room (a scene)
//   SAMPLE_CONTENT (placeholder content: the demo and test fixture)
//
// Server contract: ids are injected (socket → playerId; ack: 'screen'); `activity.action` is rebuilt
// field by field (now / deadline / timeUp server-only); round.finished is derived HERE, in the same
// step as the round's running → finished, so a single atomic save persists both or neither.

import { CHARACTERS, isCharacterId } from '../characters.js';
import { OPENING_PLAYERS, REUNIONS } from './story.js';
import { minigame } from '../minigames.js';
import { emptyFacts, holds, record, settle, safeInventory, addItem, holding, recipients, COUNTER } from './rules.js';
import { validateContent, zoneAt, roomAt, childrenOf } from './content.js';
import { SAMPLE_CONTENT } from './sample.js';

export { holds, record, settle, emptyFacts, holding, recipients, COUNTER, validateContent, zoneAt, roomAt, childrenOf, SAMPLE_CONTENT };

/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').CampaignAction} CampaignAction */
/** @typedef {import('./types.js').CampaignEvent} CampaignEvent */
/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Facts} Facts */
/** @typedef {import('./types.js').GmOp} GmOp */
/** @typedef {import('./types.js').Node} Node */
/** @typedef {import('./types.js').Party} Party */
/** @typedef {import('./types.js').PartyMember} PartyMember */
/** @typedef {import('../game.js').State} BlockState */
/** @typedef {import('../quiz/index.js').QuizState} QuizState */
/** @typedef {import('./types.js').ActivityState} ActivityState */
/** @typedef {import('../minigames.js').MinigameKind} MinigameKind */
/** @typedef {import('./types.js').TableauSettings} TableauSettings */

/** Deterministic seed step (same LCG family as the game's own). @param {number} s */
const nextSeed = (s) => (Math.imul(s >>> 0, 1103515245) + 12345) >>> 0;

/** @param {Campaign} c */
export const activityOf = (c) => c.at.activity;
/** @param {Campaign} c @param {string} id */
export const isUnlocked = (c, id) => c.facts.unlocked.includes(id);
/** @param {Campaign} c @param {Content} content */
export const nodeAt = (c, content) => content.nodes[c.at.node];

/** @param {string[]} list @param {string} id */
const withId = (list, id) => (list.includes(id) ? list : [...list, id]);

// ---------------------------------------------------------------- creation / loading

/** @returns {Party} */
const emptyParty = () => ({ order: [], players: {}, hostId: null });

/**
 * Settles facts at creation WITHOUT news: what is open at the start is not a surprise.
 * @param {Facts} facts @param {Content} content
 */
const quietSettle = (facts, content) => settle(facts, content, 0).facts;

/** The rules of the campaign's round (its kind is stored next to it). @param {Campaign} c */
const kindOf = (c) => /** @type {import('../minigames.js').MinigameRules<any, any>} */ (minigame(c.at.kind));

/**
 * The status of the campaign's round, or null between rounds. `running`: no enter/back until it ends.
 * (A loaded campaign never holds a round its minigame can't give a status: loadCampaign refuses it.)
 * @param {Campaign} c @returns {import('../minigames.js').RoundStatus | null}
 */
export const roundStatus = (c) => (c.at.activity ? kindOf(c).status(c.at.activity) : null);

/** A saved round of a minigame this release does not have: the save can't be resumed, and must not be dropped. */
export class UnknownMinigameError extends Error {
  /** @param {string} kind */
  constructor(kind) {
    super(`the saved round is of the minigame "${kind}", which is not registered`);
    this.kind = kind;
  }
}

/**
 * The kind of a saved round: stored next to it, or derived for a save from before it was (a state with
 * `kind` names it, a state without one is blocks). No round → null.
 * @param {{ kind?: unknown, activity?: ActivityState | null } | undefined} at
 * @returns {MinigameKind | null}  throws UnknownMinigameError for a kind not in the rules list
 */
function savedKind(at) {
  const s = at?.activity;
  if (!s) return null;
  const kind = at.kind;
  if (typeof kind !== 'string') throw new Error('the saved round names no minigame');
  if (!minigame(kind)) throw new UnknownMinigameError(kind);
  return /** @type {MinigameKind} */ (kind);
}

/**
 * The settings a tableau starts with: its content's, on top of its minigame's defaults. No minigame → null.
 * @param {Node | undefined} node @returns {TableauSettings | null}
 */
function settingsAt(node) {
  const spec = minigame(node?.activity?.kind);
  return spec ? spec.settings(/** @type {any} */ (node?.activity)?.settings) : null;
}

/** What the campaign passes with every action of its round. @param {Campaign} c */
const ctxOf = (c) => ({ hostId: c.party.hostId });

/**
 * Where the party stands at a node, between rounds: at a minigame's tableau, the room with that minigame's
 * kind and the tableau's settings; elsewhere (a scene, the hub, a world) no minigame.
 * @param {Node | undefined} node
 * @returns {{ kind: MinigameKind | null, activity: null, settings: TableauSettings | null }}
 */
function betweenRoundsAt(node) {
  const kind = node?.activity?.kind;
  return minigame(kind) ? { kind: /** @type {MinigameKind} */ (kind), activity: null, settings: settingsAt(node) } : { kind: null, activity: null, settings: null };
}

/**
 * Who a round starts with: incarnated party members, online or not, in party order.
 * @param {Party} party @returns {{ id: string, character: import('./types.js').CharacterId }[]}
 */
function present(party) {
  return party.order.flatMap((id) => {
    const m = party.players[id];
    return !m.left && !m.statuses.includes('wisp') ? [{ id, character: m.character }] : [];
  });
}

/**
 * @param {Content} content
 * @param {number} seed
 * @returns {Campaign}
 */
export function newCampaign(content, seed) {
  const party = emptyParty();
  const facts = quietSettle({ ...emptyFacts(), seen: [content.start],
    flags: content.storyId ? [`story.${content.storyId}`] : [] }, content);
  return {
    v: 1, seed: nextSeed(seed), party, facts, news: [], newsSeq: 0,
    at: { node: content.start, ...betweenRoundsAt(content.nodes[content.start]) },
  };
}

/**
 * A saved round its minigame can't give a status (a lobby, from before rounds started in the campaign)
 * can't be resumed: throws, and the caller starts a fresh evening and keeps the file.
 * @param {MinigameKind | null} kind @param {ActivityState} activity
 */
function assertResumable(kind, activity) {
  if (!minigame(kind)?.status(activity)) throw new Error('the saved round is not one this release can resume (a lobby from an earlier version)');
}

/** A party member whose character the roster doesn't have cannot be reclaimed or seated in a new round.
 *  Refuse the save so the server starts fresh and keeps the old file aside. @param {Party} party */
function assertPartyCharacters(party) {
  const stray = Object.values(party.players).find((p) => !isCharacterId(p.character));
  if (stray) throw new Error(`party member ${stray.id} plays "${stray.character}", not a character of the roster`);
}

/** A save from before player statuses needs a fresh evening. @param {Party} party */
function assertPartyStatuses(party) {
  const stray = Object.values(party.players).find((p) => !Array.isArray(p.statuses)
    || p.statuses.some((status) => typeof status !== 'string')
    || (p.statuses.includes('incarnating') && !p.statuses.includes('wisp')));
  if (stray) throw new Error(`party member ${stray.id} has invalid statuses`);
}

/**
 * A persisted campaign, made safe for the current content: node ids the content no longer has are
 * dropped (facts, news, position), then settle runs again (new content may open new things).
 * Never re-locks what was unlocked and still exists.
 * @param {Campaign} raw
 * @param {Content} content
 * @returns {Campaign}
 */
export function loadCampaign(raw, content) {
  const known = (/** @type {string} */ id) => !!content.nodes[id];
  const f = raw.facts ?? emptyFacts();
  /** @type {Facts} */
  const facts = {
    ...emptyFacts(), ...f,
    inventory: safeInventory(f, content),
    unlocked: (f.unlocked ?? []).filter(known),
    done: (f.done ?? []).filter(known),
    seen: (f.seen ?? []).filter(known),
  };
  if (content.storyId) facts.flags = withId(facts.flags, `story.${content.storyId}`);
  const news = (raw.news ?? []).filter((n) => n.t !== 'unlocked' || known(n.node));
  const newsSeq = raw.newsSeq ?? Math.max(0, ...news.map((n) => n.seq));
  const party = raw.party ?? emptyParty();
  assertPartyCharacters(party);
  assertPartyStatuses(party);
  const seed = raw.seed ?? 1;
  const kind = savedKind(raw.at); // first: a round of an unknown minigame stops the load even where the node is gone
  const activity = raw.at?.activity ?? null;
  if (activity) assertResumable(kind, activity);
  const stays = known(raw.at?.node); // else the room at the start: the content lost that node
  const node = stays ? raw.at.node : content.start;
  const room = betweenRoundsAt(content.nodes[node]);
  const at = {
    node, kind: stays && activity ? kind : room.kind, activity: stays ? activity : null,
    settings: (stays ? raw.at.settings : null) ?? room.settings,
  };
  const s = settle(facts, content, newsSeq);
  return {
    v: 1, seed, party, at,
    facts: s.facts, news: [...news, ...s.news], newsSeq: newsSeq + s.news.length,
  };
}

// ---------------------------------------------------------------- reducer

/** @param {Campaign} c @param {string} id */
const isHost = (c, id) => c.party.hostId !== null && c.party.hostId === id && !c.party.players[id]?.statuses.includes('wisp');
/** Pierre steers the birthday story even while he is a Wisp; sample content keeps its host GM.
 * @param {Campaign} c @param {string} id @param {Content} content */
const isGameMaster = (c, id, content) => content.storyId === 'elo-50'
  ? c.party.players[id]?.character === 'pierre' && !c.party.players[id].left
  : isHost(c, id);

/** @param {Party} party @param {string} goneId @returns {string | null} */
function nextHost(party, goneId) {
  return party.order.find((id) => id !== goneId && !party.players[id].left && !party.players[id].statuses.includes('wisp')) ?? null;
}

/**
 * Settles facts into the campaign, queuing news with fresh seqs.
 * @param {Campaign} c @param {Facts} facts @param {Content} content @param {CampaignEvent} [event]
 * @returns {Campaign}
 */
function withFacts(c, facts, content, event) {
  // the party and the triggering event decide who item rewards go to ('all', 'winner')
  const s = settle(facts, content, c.newsSeq, { party: c.party, event });
  if (s.facts === c.facts && facts === c.facts) return c;
  let party = c.party;
  if (content.storyId === 'elo-50') {
    const introduced = REUNIONS.filter((r) => !c.facts.flags.includes(r.flag) && s.facts.flags.includes(r.flag));
    if (introduced.length) {
      const players = Object.fromEntries(Object.entries(party.players).map(([id, member]) => [id,
        !member.left && introduced.some((r) => r.id === member.character) && member.statuses.includes('wisp') && !member.statuses.includes('incarnating')
          ? { ...member, statuses: [...member.statuses, 'incarnating'] } : member]));
      party = { ...party, players };
    }
  }
  return { ...c, party, facts: s.facts, news: [...c.news, ...s.news], newsSeq: c.newsSeq + s.news.length };
}

/** Moves the party to a node: the room there, no round. @param {Campaign} c @param {string} node @param {Content} content @returns {Campaign} */
function moveTo(c, node, content) {
  const facts = { ...c.facts, seen: withId(c.facts.seen, node) };
  return withFacts({ ...c, at: { node, ...betweenRoundsAt(content.nodes[node]) } }, facts, content);
}

/**
 * Installs the round's next state; a running → finished transition records the round's result
 * (round.finished) and settles in the SAME step.
 * @param {Campaign} c @param {ActivityState} next @param {Content} content @returns {Campaign}
 */
function withActivity(c, next, content) {
  const prev = c.at.activity;
  const spec = kindOf(c);
  if (next === prev) return c;
  const moved = { ...c, at: { ...c.at, activity: next } };
  if (prev && spec.status(prev) === 'running' && spec.status(next) === 'finished') {
    /** @type {CampaignEvent} */
    const ev = { t: 'round.finished', kind: /** @type {MinigameKind} */ (c.at.kind), node: c.at.node, ...spec.result(next, c.at.node) };
    return withFacts(moved, record(c.facts, ev), content, ev);
  }
  return moved;
}

/**
 * @param {Campaign} c
 * @param {CampaignAction} a
 * @param {Content} content
 * @returns {Campaign}
 */
export function reduceCampaign(c, a, content) {
  switch (a.t) {
    case 'join': {
      // a new member of the evening (the server's reclaim re-attaches an existing id: no action)
      if (!isCharacterId(a.character) || c.party.players[a.id]) return c;
      const held = c.party.order.some((id) => !c.party.players[id].left && c.party.players[id].character === a.character);
      if (held) return c;
      const { name, color } = CHARACTERS[a.character];
      const statuses = content.storyId === 'elo-50' && !c.facts.flags.includes(REUNIONS.find((r) => r.id === a.character)?.flag ?? '') &&
        (!OPENING_PLAYERS.includes(a.character) || (c.facts.flags.includes('portal.entered') && a.character !== content.chooser)) ? ['wisp'] : [];
      /** @type {Party} */
      const party = {
        order: [...c.party.order, a.id],
        players: { ...c.party.players, [a.id]: { id: a.id, character: a.character, name, color, left: false,
          statuses } },
        hostId: c.party.hostId ?? (statuses.includes('wisp') ? null : a.id),
      };
      // a round under way: they watch, and play the next one
      return { ...c, party };
    }

    case 'leave': {
      const m = c.party.players[a.id];
      if (!m || m.left) return c;
      const hostId = c.party.hostId === a.id ? nextHost(c.party, a.id) : c.party.hostId;
      const moved = { ...c, party: { ...c.party, hostId, players: { ...c.party.players, [a.id]: { ...m, left: true } } } };
      const s = c.at.activity;
      if (!s) return moved;
      const next = s.players[a.id] ? kindOf(c).reduce(s, { t: 'leave', id: a.id }, ctxOf(moved)) : s;
      return withActivity(moved, next, content); // reported to the round's minigame, which decides what it means
    }

    case 'status': {
      const member = c.party.players[a.id];
      if (!member || member.left || typeof a.status !== 'string' || !a.status || a.status.length > 64) return c;
      if (a.status === 'incarnating') return c;
      if (a.status === 'wisp' && a.on && roundStatus(c) === 'running') return c;
      const statuses = member.statuses;
      const next = a.status === 'wisp' && !a.on && statuses.includes('wisp')
        ? (statuses.includes('incarnating') ? statuses : [...statuses, 'incarnating'])
        : a.status === 'wisp' && a.on
          ? [...new Set([...statuses.filter((status) => status !== 'incarnating'), 'wisp'])]
          : a.on ? (statuses.includes(a.status) ? statuses : [...statuses, a.status])
            : statuses.filter((status) => status !== a.status);
      if (next === statuses || next.length === statuses.length) return c;
      const hostId = a.status === 'wisp' && a.on && c.party.hostId === a.id ? nextHost(c.party, a.id)
        : c.party.hostId;
      return { ...c, party: { ...c.party, hostId, players: { ...c.party.players, [a.id]: { ...member, statuses: next } } } };
    }

    case 'incarnate': {
      const member = c.party.players[a.id];
      if (!member || member.left || !member.statuses.includes('wisp') || !member.statuses.includes('incarnating')) return c;
      const statuses = member.statuses.filter((status) => status !== 'wisp' && status !== 'incarnating');
      return { ...c, party: { ...c.party, hostId: c.party.hostId ?? a.id,
        players: { ...c.party.players, [a.id]: { ...member, statuses } } } };
    }

    case 'enter': {
      // the host, or the chooser's character (walking into a door), opens an unlocked child
      const actor = c.party.players[a.id];
      const chooser = actor && !actor.left && actor.character === content.chooser;
      if (!actor || actor.statuses.includes('wisp') ||
        (content.storyId === 'elo-50' && c.facts.flags.includes('portal.entered') ? !chooser : (!isHost(c, a.id) && !chooser))) return c;
      const n = content.nodes[a.node];
      if (!n || n.parent !== c.at.node || !isUnlocked(c, n.id)) return c;
      if (roundStatus(c) === 'running') return c;
      if (n.kind === 'tableau' && c.facts.done.includes(n.id) && !n.replayable) return c; // one-shot, already seen
      return moveTo(c, n.id, content);
    }

    case 'portal': {
      const actor = c.party.players[a.id];
      if (content.storyId !== 'elo-50' || actor?.left || actor?.statuses.includes('wisp') || actor?.character !== content.chooser || c.at.node !== content.start
        || c.at.activity !== null || !c.facts.flags.includes('portal.ready')
        || c.facts.flags.includes('portal.entered')) return c;
      const facts = { ...c.facts, flags: withId(c.facts.flags, 'portal.entered'), seen: withId(c.facts.seen, 'hub') };
      const players = Object.fromEntries(Object.entries(c.party.players).map(([id, member]) => [id,
        member.character === content.chooser ? member : { ...member, statuses: [...new Set([...member.statuses, 'wisp'])] }]));
      const chooserId = c.party.order.find((id) => c.party.players[id].character === content.chooser && !c.party.players[id].left);
      const moved = withFacts({ ...c, party: { ...c.party, hostId: chooserId ?? c.party.hostId, players }, at: { node: 'hub', kind: null, activity: null, settings: null } }, facts, content);
      const seq = moved.newsSeq + 1;
      return { ...moved, news: [...moved.news, { seq, t: 'apparition' }], newsSeq: seq };
    }

    case 'collect': {
      const actor = c.party.players[a.id];
      if (content.storyId !== 'elo-50' || actor?.left || actor?.statuses.includes('wisp') || actor?.character !== content.chooser || c.at.node !== 'hub'
        || a.item !== 'memory-key-intro' || !content.items[a.item]
        || !c.facts.flags.includes('apparition.seen') || holding(c.facts, content.chooser, a.item) > 0) return c;
      const facts = { ...c.facts, inventory: addItem(c.facts.inventory, content.chooser, a.item, 1) };
      const moved = withFacts(c, facts, content);
      const seq = moved.newsSeq + 1;
      return { ...moved, news: [...moved.news, { seq, t: 'item', item: a.item, to: [content.chooser] }], newsSeq: seq };
    }

    case 'back': {
      const chooser = c.party.players[a.id]?.character === content.chooser && !c.party.players[a.id]?.left && !c.party.players[a.id]?.statuses.includes('wisp');
      if (content.storyId === 'elo-50' && c.facts.flags.includes('portal.entered') ? !chooser : !isHost(c, a.id)) return c;
      const n = content.nodes[c.at.node];
      if (!n || n.parent === null || roundStatus(c) === 'running') return c; // endGame first
      return moveTo(c, n.parent, content);
    }

    case 'start':
    case 'again': {
      // the host starts a round of the tableau's minigame, with every party member present (players who
      // joined during the last round included): from the room (start), or at once from the podium (again)
      const spec = minigame(c.at.kind);
      const s = c.at.activity;
      if (!isHost(c, a.id) || !spec) return c;
      if (a.t === 'start' ? s !== null : !s || spec.status(s) !== 'finished') return c;
      const next = spec.init({ seed: c.seed, settings: c.at.settings, players: present(c.party), now: a.now, inputs: a.inputs });
      return next ? { ...c, seed: nextSeed(c.seed), at: { ...c.at, activity: next } } : c;
    }

    case 'newGame': {
      // the host, on the podium: back to the room at the tableau
      if (!isHost(c, a.id) || roundStatus(c) !== 'finished') return c;
      return { ...c, at: { ...c.at, activity: null } };
    }

    case 'activity': {
      const s = c.at.activity;
      if (!s) return c;
      const rules = kindOf(c);
      // the host taking a player out: the minigame's own rule, else it counts as that player leaving the round
      const action = a.action?.t === 'retire' && !rules.retire
        ? (isHost(c, a.action.id) && roundStatus(c) === 'running' ? { t: 'leave', id: a.action.target } : null)
        : a.action;
      if (!action) return c;
      return withActivity(c, rules.reduce(s, action, ctxOf(c)), content); // routed by the round's kind
    }

    case 'config': {
      // the host sets the tableau's settings, except while a round runs; kept until the party leaves the tableau
      const spec = minigame(c.at.kind);
      if (!isHost(c, a.id) || !spec || roundStatus(c) === 'running') return c;
      const settings = spec.settings(a.patch, c.at.settings);
      return JSON.stringify(settings) === JSON.stringify(c.at.settings) ? c : { ...c, at: { ...c.at, settings } };
    }

    case 'event': {
      // external events only: a round's result is derived by the engine (exactly once)
      if (a.event.t === 'round.finished') return c;
      return withFacts(c, record(c.facts, a.event), content, a.event);
    }

    case 'ack': {
      if (typeof a.upTo !== 'number') return c;
      const news = c.news.filter((x) => x.seq > a.upTo);
      if (news.length === c.news.length) return c;
      const apparitionShown = c.news.some((x) => x.t === 'apparition' && x.seq <= a.upTo);
      const next = { ...c, news };
      return apparitionShown
        ? withFacts(next, { ...c.facts, flags: withId(c.facts.flags, 'apparition.seen') }, content)
        : next;
    }

    case 'gm':
      return isGameMaster(c, a.id, content) ? gm(c, a.op, content) : c;

    default:
      return c;
  }
}

/**
 * Game-master ops: live fixes. The only way to take an unlock back is `lock`.
 * @param {Campaign} c @param {GmOp} op @param {Content} content @returns {Campaign}
 */
function gm(c, op, content) {
  const f = c.facts;
  const known = (/** @type {string} */ id) => !!content.nodes[id];
  switch (op?.op) {
    case 'goto':
      return known(op.node) && op.node !== c.at.node ? moveTo(c, op.node, content) : c;

    case 'unlock': {
      if (!known(op.node)) return c;
      const { [COUNTER.locked(op.node)]: _l, ...counters } = f.counters;
      if (f.unlocked.includes(op.node) && !_l) return c;
      /** @type {Facts} */
      const facts = { ...f, counters, unlocked: withId(f.unlocked, op.node) };
      const seq = c.newsSeq + 1;
      const opened = f.unlocked.includes(op.node) ? c : { ...c, news: [...c.news, { seq, t: /** @type {const} */ ('unlocked'), node: op.node }], newsSeq: seq };
      return withFacts({ ...opened, facts }, facts, content);
    }

    case 'lock': {
      if (!known(op.node) || f.counters[COUNTER.locked(op.node)]) return c;
      return {
        ...c,
        facts: { ...f, unlocked: f.unlocked.filter((id) => id !== op.node), counters: { ...f.counters, [COUNTER.locked(op.node)]: 1 } },
        news: c.news.filter((x) => x.t !== 'unlocked' || x.node !== op.node),
      };
    }

    case 'setFlag': {
      if (typeof op.flag !== 'string') return c;
      const has = f.flags.includes(op.flag);
      if (has === !!op.on) return c;
      return withFacts(c, { ...f, flags: op.on ? [...f.flags, op.flag] : f.flags.filter((x) => x !== op.flag) }, content);
    }

    case 'count': {
      if (typeof op.counter !== 'string') return c;
      const cur = f.counters[op.counter] ?? 0;
      const val = typeof op.set === 'number' ? op.set : cur + (typeof op.by === 'number' ? op.by : 1);
      if (!Number.isFinite(val) || val === cur) return c;
      return withFacts(c, { ...f, counters: { ...f.counters, [op.counter]: val } }, content);
    }

    case 'reset-node': {
      // "redo it": forget done/seen and its finished counter; rewards already given stay given
      if (!known(op.node)) return c;
      const { [COUNTER.finished(op.node)]: _f, ...counters } = f.counters;
      return {
        ...c,
        facts: { ...f, counters, done: f.done.filter((id) => id !== op.node), seen: f.seen.filter((id) => id !== op.node) },
      };
    }

    case 'give':
    case 'take': {
      // only catalogue items and real characters; a take of more than they hold is refused whole
      const who = op.op === 'give' ? op.to : op.from;
      if (!content.items?.[op.item] || !isCharacterId(who)) return c;
      const n = op.count === undefined ? 1 : op.count;
      if (!Number.isInteger(n) || n < 1) return c;
      if (op.op === 'take' && holding(f, who, op.item) < n) return c;
      const inventory = addItem(f.inventory ?? {}, who, op.item, op.op === 'give' ? n : -n);
      return withFacts(c, { ...f, inventory }, content); // a `has` condition may open something now
    }

    default:
      return c;
  }
}
