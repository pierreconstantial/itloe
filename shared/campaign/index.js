// Campaign engine (Contract D v2 + A1): the evening as a pure state machine over content data.
// Pure JSDoc ESM, no I/O, no clock, no randomness — runs in Node and browsers like shared/game.js.
//
// PUBLIC API (types in ./types.js; reducers return the SAME object when they refuse an action)
//   newCampaign(content, seed)               → Campaign in the room at content.start, empty party
//   loadCampaign(raw, content)               → Campaign; drops ids the content no longer has, re-settles
//   reduceCampaign(campaign, action, content)→ Campaign; actions: join leave status incarnate enter portal collect
//                                              back startMinigame endMinigame activity event ack gm
//   activityOf(campaign)                     → the running minigame's state, or null (none runs)
//   minigameStatus(campaign)                 → 'lobby' | 'running' | 'podium', or null (no minigame runs: the
//                                              room at a tableau, the hub, a world); running: no enter
//   isUnlocked(campaign, nodeId) · nodeAt(campaign, content)
//   gameMasterId(party, content)              → who runs the evening: the member holding content.gameMaster, or null
//   isWisp(party, id, shows)                  → does this member show as a wisp (the story's, or one a minigame doesn't show)
//   eligibleOf(party, nodeId, content)        → who may play the node's minigame: { id, character }[], party order
//   readyRuleMet(activity, players, ready)    → the content's ready rule (`allReady`) over a lobby's players
//   askedSoFar(campaign)                      → content ids used up this evening, the running minigame's rounds too
//   holds(cond, facts) · record(facts, event) · settle(facts, content, fromSeq) → { facts, news }
//   validateContent(content) → string[] · zoneAt(content, nodeId, x, y) → child id | null
//   roomAt(content, nodeId) → the node's room (a scene)
//   SAMPLE_CONTENT (placeholder content: the demo and test fixture)
//
// Server contract: ids are injected (socket → playerId; ack: 'screen'); `activity.action` is rebuilt
// field by field (now / deadline / timeUp / inputs server-only). A round's result is kept in `at.results`
// in the same step as its running → podium, and recorded (round.finished) HERE when the minigame ends, in
// one step, so a single atomic save persists the results and the facts together.

import { CHARACTERS, isCharacterId } from '../characters.js';
import { OPENING_PLAYERS, REUNIONS } from './story.js';
import { minigame } from '../minigames.js';
import { nextSeed } from '../rng.js';
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
/** @typedef {import('./types.js').TableauPlayers} TableauPlayers */
/** @typedef {import('./types.js').CharacterId} CharacterId */

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
const emptyParty = () => ({ order: [], players: {} });

/**
 * Settles facts at creation WITHOUT news: what is open at the start is not a surprise.
 * @param {Facts} facts @param {Content} content
 */
const quietSettle = (facts, content) => settle(facts, content, 0).facts;

/** The rules of the campaign's minigame (its kind is stored next to it). @param {Campaign} c */
const kindOf = (c) => /** @type {import('../minigames.js').MinigameRules<any, any>} */ (minigame(c.at.kind));

/**
 * The status of the running minigame, or null while none runs. (A loaded campaign never holds a minigame
 * that can't give a status: loadCampaign refuses it.)
 * @param {Campaign} c @returns {import('../minigames.js').MinigameStatus | null}
 */
export const minigameStatus = (c) => (c.at.activity ? kindOf(c).status(c.at.activity) : null);

/** A saved minigame this release does not have: the save can't be resumed, and must not be dropped. */
export class UnknownMinigameError extends Error {
  /** @param {string} kind */
  constructor(kind) {
    super(`the saved minigame "${kind}" is not registered`);
    this.kind = kind;
  }
}

/**
 * The kind of a saved minigame, stored next to it. None running → null.
 * @param {{ kind?: unknown, activity?: ActivityState | null } | undefined} at
 * @returns {MinigameKind | null}  throws UnknownMinigameError for a kind not in the rules list
 */
function savedKind(at) {
  const s = at?.activity;
  if (!s) return null;
  const kind = at.kind;
  if (typeof kind !== 'string') throw new Error('the saved minigame has no kind');
  if (!minigame(kind)) throw new UnknownMinigameError(kind);
  return /** @type {MinigameKind} */ (kind);
}

/**
 * The settings a minigame starts with: its tableau's content's, on top of its defaults. No minigame → null.
 * @param {Node | undefined} node @returns {TableauSettings | null}
 */
function settingsAt(node) {
  const spec = minigame(node?.activity?.kind);
  return spec ? spec.settings(/** @type {any} */ (node?.activity)?.settings) : null;
}

/** What the campaign passes with every action of its round. @param {Campaign} c @param {Content} content */
const ctxOf = (c, content) => ({ gameMasterId: gameMasterId(c.party, content) });

/**
 * Where the party stands at a node while no minigame runs: at a minigame's tableau, the room with that
 * minigame's kind; elsewhere (a scene, the hub, a world) no minigame.
 * @param {Node | undefined} node
 * @returns {{ kind: MinigameKind | null, activity: null, results: import('../minigames.js').RoundResult[] }}
 */
function noMinigameAt(node) {
  const kind = node?.activity?.kind;
  return { kind: minigame(kind) ? /** @type {MinigameKind} */ (kind) : null, activity: null, results: [] };
}

/** A tableau's content rules for its players (`eligible`, `allReady`), or none. @param {Node | undefined} node @returns {TableauPlayers} */
const playersRuleOf = (node) => /** @type {TableauPlayers} */ (node?.activity ?? {});

/**
 * The eligible players of a node's minigame: the characters its tableau names, among the party members who
 * haven't left (story wisps included); without names, every member who hasn't left and isn't a story wisp.
 * Online or not, in party order.
 * @param {Party} party @param {string} nodeId @param {Content} content
 * @returns {{ id: string, character: CharacterId }[]}
 */
export function eligibleOf(party, nodeId, content) {
  const names = playersRuleOf(content.nodes[nodeId]).eligible;
  return party.order.flatMap((id) => {
    const m = party.players[id];
    const eligible = !m.left && (names ? names.includes(m.character) : !m.statuses.includes('wisp'));
    return eligible ? [{ id, character: m.character }] : [];
  });
}

/**
 * The content's ready rule (`allReady`): every character the tableau names is among the players and ready;
 * without names, every player is ready. Without `allReady`, it holds. `players`: the eligible ones.
 * @param {TableauPlayers | undefined} rule @param {{ id: string, character: string }[]} players @param {string[]} ready
 * @returns {boolean}
 */
export function readyRuleMet(rule, players, ready) {
  if (!rule?.allReady) return true;
  const names = rule.eligible;
  return names
    ? names.every((character) => players.some((p) => p.character === character && ready.includes(p.id)))
    : players.every((p) => ready.includes(p.id));
}

/**
 * Content ids used up this evening (quiz questions): the facts' and the running minigame's finished rounds'.
 * @param {Campaign} c @returns {string[]}
 */
export function askedSoFar(c) {
  return [...new Set([...c.facts.asked, ...c.at.results.flatMap((r) => r.asked ?? [])])];
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
    at: { node: content.start, ...noMinigameAt(content.nodes[content.start]) },
  };
}

/**
 * A saved minigame that can't give a status (a round from before minigame lobbies) can't be resumed:
 * throws, and the caller starts a fresh evening and keeps the file.
 * @param {MinigameKind | null} kind @param {ActivityState} activity
 */
function assertResumable(kind, activity) {
  if (!minigame(kind)?.status(activity)) throw new Error('the saved minigame is not one this release can resume (from an earlier version)');
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
  const kind = savedKind(raw.at); // first: an unknown minigame stops the load even where the node is gone
  const activity = raw.at?.activity ?? null;
  if (activity) assertResumable(kind, activity);
  const stays = known(raw.at?.node); // else the room at the start: the content lost that node
  const node = stays ? raw.at.node : content.start;
  const room = noMinigameAt(content.nodes[node]);
  const at = stays && activity ? { node, kind, activity, results: raw.at.results ?? [] } : { node, ...room };
  const s = settle(facts, content, newsSeq);
  return {
    v: 1, seed, party, at,
    facts: s.facts, news: [...news, ...s.news], newsSeq: newsSeq + s.news.length,
  };
}

// ---------------------------------------------------------------- reducer

/**
 * The game master: the party member holding the character the content names, wisp or not; null before they
 * join or once they left. The role never passes to anyone else.
 * @param {Party} party @param {Content} content @returns {string | null}
 */
export function gameMasterId(party, content) {
  return party.order.find((id) => !party.players[id].left && party.players[id].character === content.gameMaster) ?? null;
}
/** @param {Campaign} c @param {string} id @param {Content} content */
const isGameMaster = (c, id, content) => gameMasterId(c.party, content) === id;

/**
 * Who shows as a wisp, for the server, the TV and the phone: while no minigame runs, a member with the story's
 * `wisp` status; while one runs, every member it doesn't show itself (`shows`), so a story wisp it shows plays
 * as their character there. A wisp walks and Shines; it doesn't speak, jump or use objects.
 * @param {Party} party @param {string} id @param {string[] | null} shows the running minigame's, null while none runs
 * @returns {boolean}
 */
export function isWisp(party, id, shows) {
  const m = party.players[id];
  return !!m && !m.left && (shows ? !shows.includes(id) : m.statuses.includes('wisp'));
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

/** Moves the party to a node: the room there, no minigame. @param {Campaign} c @param {string} node @param {Content} content @returns {Campaign} */
function moveTo(c, node, content) {
  const facts = { ...c.facts, seen: withId(c.facts.seen, node) };
  return withFacts({ ...c, at: { node, ...noMinigameAt(content.nodes[node]) } }, facts, content);
}

/**
 * Installs the running minigame's next state. A step into a running round is refused unless the content's
 * ready rule holds over who was ready; a step from a running round to its podium keeps the round's result.
 * @param {Campaign} c @param {ActivityState} next @param {Content} content @returns {Campaign}
 */
function withActivity(c, next, content) {
  const prev = /** @type {ActivityState} */ (c.at.activity);
  if (next === prev) return c;
  const spec = kindOf(c);
  const before = spec.status(prev), after = spec.status(next);
  if (after === 'running' && before !== 'running'
    && !readyRuleMet(playersRuleOf(content.nodes[c.at.node]), eligibleOf(c.party, c.at.node, content), spec.ready(prev))) return c;
  const results = before === 'running' && after === 'podium' ? [...c.at.results, spec.result(next, c.at.node)] : c.at.results;
  return { ...c, at: { ...c.at, activity: next, results } };
}

/**
 * Ends the running minigame: every finished round's result is recorded (round.finished) and settled, in
 * order, so a `winner` reward goes to the round that completed the node; then the room at the tableau. A
 * running round is dropped. No minigame → the same campaign.
 * @param {Campaign} c @param {Content} content @returns {Campaign}
 */
function endMinigame(c, content) {
  if (!c.at.activity) return c;
  /** @type {Campaign} */
  let next = { ...c, at: { ...c.at, activity: null, results: [] } };
  for (const result of c.at.results) {
    /** @type {CampaignEvent} */
    const ev = { t: 'round.finished', kind: /** @type {MinigameKind} */ (c.at.kind), node: c.at.node, ...result };
    next = withFacts(next, record(next.facts, ev), content, ev);
  }
  return next;
}

/**
 * The eligible players' changes, sent to the running minigame as `join` and `leave` after a party change.
 * @param {Campaign} prev @param {Campaign} c @param {Content} content @returns {Campaign}
 */
function withEligible(prev, c, content) {
  const s = c.at.activity;
  if (!s || !prev.at.activity || prev.party === c.party || prev.at.node !== c.at.node) return c;
  const before = eligibleOf(prev.party, c.at.node, content);
  const after = eligibleOf(c.party, c.at.node, content);
  const spec = kindOf(c);
  const ctx = ctxOf(c, content);
  let next = s;
  for (const p of before) if (!after.some((q) => q.id === p.id)) next = spec.reduce(next, { t: 'leave', id: p.id }, ctx);
  for (const p of after) if (!before.some((q) => q.id === p.id)) next = spec.reduce(next, { t: 'join', id: p.id, character: p.character }, ctx);
  return withActivity(c, next, content);
}

/**
 * @param {Campaign} c
 * @param {CampaignAction} a
 * @param {Content} content
 * @returns {Campaign}
 */
export function reduceCampaign(c, a, content) {
  const next = step(c, a, content);
  return next === c ? c : withEligible(c, next, content);
}

/**
 * One action, before the running minigame hears of the eligible players' changes.
 * @param {Campaign} c @param {CampaignAction} a @param {Content} content @returns {Campaign}
 */
function step(c, a, content) {
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
      };
      return { ...c, party }; // a running minigame hears of it as their join, if they're eligible
    }

    case 'leave': {
      // a running minigame hears of it as their leave, and decides what it means
      const m = c.party.players[a.id];
      if (!m || m.left) return c;
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...m, left: true } } } };
    }

    case 'status': {
      const member = c.party.players[a.id];
      if (!member || member.left || typeof a.status !== 'string' || !a.status || a.status.length > 64) return c;
      if (a.status === 'incarnating') return c;
      const statuses = member.statuses;
      const next = a.status === 'wisp' && !a.on && statuses.includes('wisp')
        ? (statuses.includes('incarnating') ? statuses : [...statuses, 'incarnating'])
        : a.status === 'wisp' && a.on
          ? [...new Set([...statuses.filter((status) => status !== 'incarnating'), 'wisp'])]
          : a.on ? (statuses.includes(a.status) ? statuses : [...statuses, a.status])
            : statuses.filter((status) => status !== a.status);
      if (next === statuses || next.length === statuses.length) return c;
      // a new story wisp stops being eligible where the tableau names nobody: the running minigame hears their leave
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...member, statuses: next } } } };
    }

    case 'incarnate': {
      const member = c.party.players[a.id];
      if (!member || member.left || !member.statuses.includes('wisp') || !member.statuses.includes('incarnating')) return c;
      const statuses = member.statuses.filter((status) => status !== 'wisp' && status !== 'incarnating');
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...member, statuses } } } };
    }

    case 'enter': {
      // the game master, or the chooser's character (walking into a door), opens an unlocked child
      const actor = c.party.players[a.id];
      const chooser = actor && !actor.left && actor.character === content.chooser;
      if (!actor || actor.statuses.includes('wisp') ||
        (content.storyId === 'elo-50' && c.facts.flags.includes('portal.entered') ? !chooser : (!isGameMaster(c, a.id, content) && !chooser))) return c;
      const n = content.nodes[a.node];
      if (!n || n.parent !== c.at.node || !isUnlocked(c, n.id)) return c;
      if (c.at.activity) return c;
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
      const moved = withFacts({ ...c, party: { ...c.party, players }, at: { node: 'hub', ...noMinigameAt(content.nodes.hub) } }, facts, content);
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
      // while a minigame runs, the game master's back ends it first (a running round is dropped)
      const chooser = c.party.players[a.id]?.character === content.chooser && !c.party.players[a.id]?.left && !c.party.players[a.id]?.statuses.includes('wisp');
      const allowed = c.at.activity || !(content.storyId === 'elo-50' && c.facts.flags.includes('portal.entered')) ? isGameMaster(c, a.id, content) : chooser;
      const n = content.nodes[c.at.node];
      if (!allowed || !n || n.parent === null) return c;
      return moveTo(endMinigame(c, content), n.parent, content);
    }

    case 'startMinigame': {
      // the game master, in the room at a minigame's tableau: its lobby, with the eligible players
      const spec = minigame(c.at.kind);
      if (!spec || c.at.activity || !isGameMaster(c, a.id, content)) return c;
      const node = content.nodes[c.at.node];
      const activity = spec.open({ seed: c.seed, settings: settingsAt(node), players: eligibleOf(c.party, c.at.node, content), now: a.now });
      return { ...c, seed: nextSeed(c.seed), at: { ...c.at, activity, results: [] } };
    }

    case 'endMinigame':
      // the game master, in the minigame's lobby: its results recorded, back in the room at the tableau
      return isGameMaster(c, a.id, content) && minigameStatus(c) === 'lobby' ? endMinigame(c, content) : c;

    case 'activity': {
      const s = c.at.activity;
      if (!s) return c;
      return withActivity(c, kindOf(c).reduce(s, a.action, ctxOf(c, content)), content); // routed by the minigame's kind
    }

    case 'event': {
      // external events only: a round's result is recorded by the engine (exactly once)
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
      // a running minigame ends first (a running round is dropped)
      return known(op.node) && op.node !== c.at.node ? moveTo(endMinigame(c, content), op.node, content) : c;

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

    case 'wisp': {
      if (!isCharacterId(op.character) || typeof op.on !== 'boolean') return c;
      const id = c.party.order.find((id) => !c.party.players[id].left && c.party.players[id].character === op.character);
      return id ? step(c, { t: 'status', id, status: 'wisp', on: op.on }, content) : c;
    }

    default:
      return c;
  }
}
