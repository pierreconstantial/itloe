// Campaign engine (Contract D v2 + A1): the evening as a pure state machine over content data.
// Pure JSDoc ESM, no I/O, no clock, no randomness — runs in Node and browsers like shared/game.js.
//
// PUBLIC API (types in ./types.js; reducers return the SAME object when they refuse an action)
//   newCampaign(content, seed)               → Campaign at content.start, empty party, block lobby
//   fromLegacyState(state, content)          → Campaign wrapping a saved bare block State (any phase)
//   loadCampaign(raw, content)               → Campaign; drops ids the content no longer has, re-settles
//   reduceCampaign(campaign, action, content)→ Campaign; actions: join leave enter back activity event ack gm
//   activityOf(campaign)                     → the live activity State (block game or quiz), or null
//   activityRunning(state)                   → a game / quiz is under way (enter/back refused)
//   isUnlocked(campaign, nodeId) · nodeAt(campaign, content)
//   holds(cond, facts) · record(facts, event) · settle(facts, content, fromSeq) → { facts, news }
//   validateContent(content) → string[] · zoneAt(content, nodeId, x, y) → child id | null
//   SAMPLE_CONTENT (placeholder content: the demo and test fixture)
//
// Server contract: ids are injected (socket → playerId; ack: 'screen'); `activity.action` is rebuilt
// field by field (now / deadline / timeUp server-only); game.finished is derived HERE, in the same
// step as the nested playing → finished, so a single atomic save persists both or neither.

import { CHARACTERS, isCharacterId } from '../characters.js';
import { ranking } from '../game.js';
import { quizRanking } from '../quiz/index.js';
import { minigame } from '../minigames.js';
import { emptyFacts, holds, record, settle, migrateTotals, migrateInventory, addItem, holding, recipients, COUNTER } from './rules.js';
import { validateContent, zoneAt, childrenOf } from './content.js';
import { SAMPLE_CONTENT } from './sample.js';

export { holds, record, settle, emptyFacts, holding, recipients, COUNTER, validateContent, zoneAt, childrenOf, SAMPLE_CONTENT };

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

/**
 * The event each minigame reports when a round finishes (derived HERE, in the same step: exactly once).
 * @type {Record<MinigameKind, { finished: (s: any, node: string) => CampaignEvent, finishedEvent: CampaignEvent['t'] }>}
 */
const FINISHED = {
  blocks: { finished: (s, node) => finishedEvent(s, node), finishedEvent: 'game.finished' },
  quiz: { finished: (s, node) => quizFinishedEvent(s, node), finishedEvent: 'quiz.finished' },
};

/** Events only the engine may produce (an activity's end): an external copy could count a game twice. */
const DERIVED_EVENTS = new Set(Object.values(FINISHED).map((k) => k.finishedEvent));

/** @param {ActivityState} s @returns {MinigameKind} */
const kindNameOf = (s) => ('kind' in s && s.kind === 'quiz' ? 'quiz' : 'blocks');
/** @param {ActivityState} s */
const kindOf = (s) => /** @type {import('../minigames.js').MinigameRules<any, any>} */ (minigame(kindNameOf(s)));

/** A game or quiz is under way (no enter/back until it ends). @param {ActivityState | null} s */
export const activityRunning = (s) => !!s && kindOf(s).status(s) === 'running';

/**
 * The lobby of a tableau's activity (blocks or quiz), seeded with every non-left party member (host =
 * party host). No such activity (a scene) → null.
 * @param {Node | undefined} node @param {Party} party @param {number} seed
 * @returns {ActivityState | null}
 */
function activityLobby(node, party, seed) {
  const spec = minigame(node?.activity?.kind);
  if (!spec) return null;
  let s = spec.init(seed, /** @type {any} */ (node?.activity)?.settings);
  for (const id of party.order) {
    const m = party.players[id];
    if (!m.left && m.character) s = spec.reduce(s, { t: 'join', id, character: m.character });
  }
  return syncHost(s, party);
}

/** The party is the authority on who hosts: mirror it into the nested game when that player is seated. */
/** @template {ActivityState} S @param {S} s @param {Party} party @returns {S} */
function syncHost(s, party) {
  const h = party.hostId;
  if (h !== null && s.players[h] && !s.players[h].left && s.hostId !== h) return { ...s, hostId: h };
  return s;
}

/**
 * @param {Content} content
 * @param {number} seed
 * @returns {Campaign}
 */
export function newCampaign(content, seed) {
  const party = emptyParty();
  const facts = quietSettle({ ...emptyFacts(), seen: [content.start] }, content);
  return {
    v: 1, seed: nextSeed(seed), party, facts, news: [], newsSeq: 0,
    at: { node: content.start, activity: activityLobby(content.nodes[content.start], party, seed) },
  };
}

/**
 * A saved bare block State (pre-campaign envelope) → a campaign at the false-start tableau, the
 * State kept AS IS (any phase), the party rebuilt from its players.
 * @param {BlockState} state
 * @param {Content} content
 * @returns {Campaign}
 */
export function fromLegacyState(state, content) {
  /** @type {Party} */
  const party = { order: [...state.order], players: {}, hostId: state.hostId };
  for (const id of state.order) {
    const p = state.players[id];
    party.players[id] = { id, character: p.character ?? null, name: p.name, color: p.color, left: !!p.left };
  }
  const facts = quietSettle({ ...emptyFacts(), seen: [content.start] }, content);
  return { v: 1, seed: nextSeed(state.seed), party, facts, news: [], newsSeq: 0, at: { node: content.start, activity: state } };
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
  const { items: _legacyItems, ...f } = /** @type {Facts & { items?: unknown }} */ (raw.facts ?? emptyFacts());
  /** @type {Facts} */
  const facts = {
    ...emptyFacts(), ...f,
    inventory: migrateInventory(/** @type {any} */ (raw.facts ?? {}), content), // older saves: shared facts.items → the chooser's
    unlocked: (f.unlocked ?? []).filter(known),
    done: (f.done ?? []).filter(known),
    seen: (f.seen ?? []).filter(known),
    totals: migrateTotals(f.totals), // older saves: flat block totals → { blocks: … }
  };
  const news = (raw.news ?? []).filter((n) => n.t !== 'unlocked' || known(n.node));
  const newsSeq = raw.newsSeq ?? Math.max(0, ...news.map((n) => n.seq));
  const party = raw.party ?? emptyParty();
  const seed = raw.seed ?? 1;
  const keep = known(raw.at?.node); // else a fresh lobby is built at the start, which consumes a seed
  const at = keep
    ? { node: raw.at.node, activity: raw.at.activity ?? null }
    : { node: content.start, activity: activityLobby(content.nodes[content.start], party, seed) };
  const s = settle(facts, content, newsSeq);
  return {
    v: 1, seed: keep ? seed : nextSeed(seed), party, at,
    facts: s.facts, news: [...news, ...s.news], newsSeq: newsSeq + s.news.length,
  };
}

// ---------------------------------------------------------------- reducer

/** @param {Campaign} c @param {string} id */
const isHost = (c, id) => c.party.hostId !== null && c.party.hostId === id;

/** @param {Party} party @param {string} goneId @returns {string | null} */
function nextHost(party, goneId) {
  return party.order.find((id) => id !== goneId && !party.players[id].left) ?? null;
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
  return { ...c, facts: s.facts, news: [...c.news, ...s.news], newsSeq: c.newsSeq + s.news.length };
}

/** game.finished for a nested block game that just finished. @param {BlockState} s @param {string} node @returns {CampaignEvent} */
function finishedEvent(s, node) {
  return {
    t: 'game.finished', kind: 'blocks', node,
    ranking: ranking(s).map((r) => ({ character: s.players[r.id].character ?? null, score: r.score, rank: r.rank })),
    mode: s.rules.mode, size: s.rules.size, endReason: s.endReason,
  };
}

/** quiz.finished for a nested quiz that just finished. @param {QuizState} s @param {string} node @returns {CampaignEvent} */
function quizFinishedEvent(s, node) {
  return {
    t: 'quiz.finished', node,
    ranking: quizRanking(s).map((r) => ({ character: s.players[r.id].character ?? null, score: r.score, rank: r.rank, correct: r.correct })),
    asked: [...s.asked], endReason: s.endReason,
  };
}

/** Moves the party to a node, creating its activity. @param {Campaign} c @param {string} node @param {Content} content @returns {Campaign} */
function moveTo(c, node, content) {
  const activity = activityLobby(content.nodes[node], c.party, c.seed);
  const facts = { ...c.facts, seen: withId(c.facts.seen, node) };
  return withFacts({ ...c, seed: activity ? nextSeed(c.seed) : c.seed, at: { node, activity } }, facts, content);
}

/**
 * Installs a new nested activity State; an under-way → finished transition records its finished event
 * (game.finished / quiz.finished) and settles in the SAME step. A lobby picks up party members it is
 * missing (joined mid-game).
 * @param {Campaign} c @param {ActivityState} next @param {Content} content @returns {Campaign}
 */
function withActivity(c, next, content) {
  const prev = c.at.activity;
  const spec = kindOf(next);
  if (spec.status(next) === 'lobby') {
    for (const id of c.party.order) {
      const m = c.party.players[id];
      if (!m.left && m.character && !next.players[id]) next = spec.reduce(next, { t: 'join', id, character: m.character });
    }
  }
  next = syncHost(next, c.party);
  if (next === prev) return c;
  const moved = { ...c, at: { ...c.at, activity: next } };
  if (prev && spec.status(prev) === 'running' && spec.status(next) === 'finished') {
    const ev = FINISHED[kindNameOf(next)].finished(next, c.at.node);
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
      /** @type {Party} */
      const party = {
        order: [...c.party.order, a.id],
        players: { ...c.party.players, [a.id]: { id: a.id, character: a.character, name, color, left: false } },
        hostId: c.party.hostId ?? a.id,
      };
      const moved = { ...c, party };
      const s = c.at.activity;
      // an open block lobby seats them now; a game under way: they watch until the next lobby
      return s ? withActivity(moved, s, content) : moved;
    }

    case 'leave': {
      const m = c.party.players[a.id];
      if (!m || m.left) return c;
      const hostId = c.party.hostId === a.id ? nextHost(c.party, a.id) : c.party.hostId;
      const moved = { ...c, party: { ...c.party, hostId, players: { ...c.party.players, [a.id]: { ...m, left: true } } } };
      const s = c.at.activity;
      if (!s) return moved;
      const next = s.players[a.id] ? kindOf(s).reduce(s, { t: 'leave', id: a.id }) : s;
      return withActivity(moved, next, content); // a lobby drops them, a game marks them done (left)
    }

    case 'enter': {
      // the host, or the chooser's character (walking into a door), opens an unlocked child
      const actor = c.party.players[a.id];
      const chooser = actor && !actor.left && actor.character === content.chooser;
      if (!isHost(c, a.id) && !chooser) return c;
      const n = content.nodes[a.node];
      if (!n || n.parent !== c.at.node || !isUnlocked(c, n.id)) return c;
      if (activityRunning(c.at.activity)) return c;
      if (n.kind === 'tableau' && c.facts.done.includes(n.id) && !n.replayable) return c; // one-shot, already seen
      return moveTo(c, n.id, content);
    }

    case 'back': {
      if (!isHost(c, a.id)) return c;
      const n = content.nodes[c.at.node];
      if (!n || n.parent === null || activityRunning(c.at.activity)) return c; // endGame first
      return moveTo(c, n.parent, content);
    }

    case 'activity': {
      const s = c.at.activity;
      if (!s) return c;
      return withActivity(c, kindOf(s).reduce(s, a.action), content); // routed by the activity's kind
    }

    case 'event': {
      // external events only: every activity's finished event is derived by the engine (exactly once)
      if (DERIVED_EVENTS.has(a.event.t)) return c;
      return withFacts(c, record(c.facts, a.event), content, a.event);
    }

    case 'ack': {
      if (typeof a.upTo !== 'number') return c;
      const news = c.news.filter((x) => x.seq > a.upTo);
      return news.length === c.news.length ? c : { ...c, news };
    }

    case 'gm':
      return isHost(c, a.id) ? gm(c, a.op, content) : c;

    default:
      return c;
  }
}

/**
 * Game-master ops: live fixes by the host. The only way to take an unlock back is `lock`.
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
