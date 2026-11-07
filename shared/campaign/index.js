// Campaign engine (Contract D v3, docs/story-engine.md): the evening as a pure state machine over content data.
// Pure JSDoc ESM, no I/O, no clock, no randomness — runs in Node and browsers like shared/game.js. Nothing here
// knows the birthday story: its places, machines and roles are content (shared/campaign/story/).
//
// PUBLIC API (types in ./types.js; reducers return the SAME object when they refuse an action)
//   newCampaign(content, seed)               → Campaign in the room at content.start, empty party
//   loadCampaign(raw, content)               → Campaign; drops ids the content no longer has, re-settles
//   reduceCampaign(campaign, action, content)→ Campaign; actions: join leave status incarnate enter use pickup zone
//                                              tick back startMinigame endMinigame activity event ack gm
//                                              (`action.now`: the server's clock, injected on every action)
//   activityOf(campaign)                     → the running minigame's state, or null (none runs)
//   minigameStatus(campaign)                 → 'lobby' | 'running' | 'podium', or null (no minigame runs)
//   isUnlocked(campaign, nodeId) · nodeAt(campaign, content) · leads(facts, content)
//   gameMasterId(party, content)              → who runs the evening: the member holding content.gameMaster, or null
//   isWisp(party, id, shows)                  → does this member show as a wisp (the story's, or one a minigame doesn't show)
//   eligibleOf(party, nodeId, content)        → who may play the node's minigame: { id, character }[], party order
//   readyRuleMet(activity, players, ready)    → the content's ready rule (`allReady`) over a lobby's players
//   askedSoFar(campaign)                      → content ids used up this evening, the running minigame's rounds too
//   holds(cond, facts) · record(facts, event) · settle(facts, content, fromSeq) → { facts, news }
//   validateContent(content) → string[] · zoneAt(content, nodeId, x, y) → child id | null
//   roomAt(content, nodeId) · sceneAt(content, facts, nodeId) → the node's room (without its hidden props)
//   machines: hintAt chooserHeld pickupsAt zonesAt npcsAt hiddenProps offerAt objectRules nextTimer within
//   SAMPLE_CONTENT (placeholder content: the demo and test fixture)
//
// Server contract: ids are injected (socket → playerId; ack: 'screen'); `activity.action` is rebuilt
// field by field (now / deadline / timeUp / inputs server-only). A round's result is kept in `at.results`
// in the same step as its running → podium, and recorded (round.finished) HERE when the minigame ends, in
// one step, so a single atomic save persists the results and the facts together.

import { CHARACTERS, isCharacterId } from '../characters.js';
import { minigame } from '../minigames.js';
import { nextSeed } from '../rng.js';
import { emptyFacts, holds, record, settle, safeInventory, addItem, holding, recipients, COUNTER } from './rules.js';
import { validateContent, zoneAt, roomAt, sceneAt, childrenOf } from './content.js';
import {
  initialMachines, safeMachines, eventSteps, conditionStep, dueSteps, nextTimer, hintAt, chooserHeld, pickupsAt,
  zonesAt, npcsAt, hiddenProps, offerAt, objectRules, within, speechAt,
} from './machines.js';
import { objectAction } from '../interactions.js';
import { SAMPLE_CONTENT } from './sample.js';

export { holds, record, settle, emptyFacts, holding, recipients, COUNTER, validateContent, zoneAt, roomAt, sceneAt, childrenOf, SAMPLE_CONTENT };
export { hintAt, chooserHeld, pickupsAt, zonesAt, npcsAt, hiddenProps, offerAt, objectRules, nextTimer, within, speechAt };

/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').CampaignAction} CampaignAction */
/** @typedef {import('./types.js').CampaignStep} CampaignStep */
/** @typedef {import('./types.js').CampaignEvent} CampaignEvent */
/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Effect} Effect */
/** @typedef {import('./types.js').Facts} Facts */
/** @typedef {import('./types.js').GmOp} GmOp */
/** @typedef {import('./types.js').Node} Node */
/** @typedef {import('./types.js').News} News */
/** @typedef {import('./types.js').Party} Party */
/** @typedef {import('./types.js').PartyMember} PartyMember */
/** @typedef {import('./types.js').ActivityState} ActivityState */
/** @typedef {import('../minigames.js').MinigameKind} MinigameKind */
/** @typedef {import('./types.js').TableauSettings} TableauSettings */
/** @typedef {import('./types.js').TableauPlayers} TableauPlayers */
/** @typedef {import('./types.js').CharacterId} CharacterId */
/** @typedef {import('./machines.js').Step} Step */

/** @param {Campaign} c */
export const activityOf = (c) => c.at.activity;
/** @param {Campaign} c @param {string} id */
export const isUnlocked = (c, id) => c.facts.unlocked.includes(id);
/** @param {Campaign} c @param {Content} content */
export const nodeAt = (c, content) => content.nodes[c.at.node];
/** Does the chooser alone move the party now (`leadAfter` holds)? @param {Facts} facts @param {Content} content */
export const leads = (facts, content) => !!content.leadAfter && holds(content.leadAfter, facts);

/** @param {string[]} list @param {string} id */
const withId = (list, id) => (list.includes(id) ? list : [...list, id]);

/** A member who hasn't left, or null. @param {Campaign} c @param {string} id @returns {PartyMember | null} */
const activeMember = (c, id) => {
  const m = c.party.players[id];
  return m && !m.left ? m : null;
};
/** A member who hasn't left and isn't a wisp, or null. @param {Campaign} c @param {string} id */
const actingMember = (c, id) => {
  const m = activeMember(c, id);
  return m && !m.statuses.includes('wisp') ? m : null;
};
/** The chooser, acting as their character (not a wisp). @param {Campaign} c @param {string} id @param {Content} content */
const actingChooser = (c, id, content) => actingMember(c, id)?.character === content.chooser;

/** Adds one news entry with the next seq. @param {Campaign} c
 * @param {{ t: 'unlocked', node: string } | { t: 'item', item: string, to: CharacterId[] } | { t: 'cutscene', id: string }} entry
 * @returns {Campaign} */
function withNews(c, entry) {
  const seq = c.newsSeq + 1;
  return { ...c, news: [...c.news, /** @type {News} */ ({ seq, ...entry })], newsSeq: seq };
}

// ---------------------------------------------------------------- creation / loading

/** @returns {Party} */
const emptyParty = () => ({ order: [], players: {} });

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
  // what is open at the start is not a surprise: settled without news
  const facts = settle({ ...emptyFacts(), seen: [content.start], machines: initialMachines(content) }, content, 0).facts;
  return {
    v: 1, seed: nextSeed(seed), party: emptyParty(), facts, news: [], newsSeq: 0,
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
 * dropped (facts, news, position), machines are reset where the content changed them, then settle runs again
 * (new content may open new things). Never re-locks what was unlocked and still exists.
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
    machines: safeMachines(f.machines, content),
  };
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

// ---------------------------------------------------------------- the party's roles

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
 * Does a character joining now start as a wisp (content.cast)? Yes unless the story introduced them, or they
 * play the opening and the chooser doesn't lead yet (the chooser plays as themselves throughout).
 * @param {Campaign} c @param {CharacterId} character @param {Content} content
 */
function startsAsWisp(c, character, content) {
  const cast = content.cast;
  if (!cast || character === content.chooser) return false;
  const flag = cast.introducedBy[character];
  if (flag && c.facts.flags.includes(flag)) return false;
  return !cast.opening.includes(character) || leads(c.facts, content);
}

// ---------------------------------------------------------------- facts, machines and effects

/**
 * Settles facts into the campaign, queuing news with fresh seqs; a wisp whose character the facts just
 * introduced (content.cast) starts incarnating. No machine transitions (see withFacts).
 * @param {Campaign} c @param {Facts} facts @param {Content} content @param {CampaignEvent} [event]
 * @param {Facts} [before] the facts before this step's changes (default c.facts): what "just introduced" compares to
 * @returns {Campaign}
 */
function settleInto(c, facts, content, event, before = c.facts) {
  // the party and the triggering event decide who item rewards go to ('all', 'winner')
  const s = settle(facts, content, c.newsSeq, { party: c.party, event });
  if (s.facts === c.facts && facts === c.facts && before === c.facts) return c;
  let party = c.party;
  const introduced = Object.entries(content.cast?.introducedBy ?? {})
    .filter(([, flag]) => !before.flags.includes(flag) && s.facts.flags.includes(flag)).map(([character]) => character);
  if (introduced.length) {
    party = { ...party, players: Object.fromEntries(Object.entries(party.players).map(([id, m]) => [id,
      !m.left && introduced.includes(m.character) && m.statuses.includes('wisp') && !m.statuses.includes('incarnating')
        ? { ...m, statuses: [...m.statuses, 'incarnating'] } : m])) };
  }
  return { ...c, party, facts: s.facts, news: [...c.news, ...s.news], newsSeq: c.newsSeq + s.news.length };
}

/** At most this many machine transitions follow one another (in a row, or nested through goto → entered): a
 *  loop in the content stops here instead of hanging or overflowing the stack. */
const MAX_STEPS = 64;
/** How deep enterState is nested now (goto → entered → enterState …). Transient, always back to 0. */
let depth = 0;

/**
 * Settles facts, then takes the machines' condition transitions that now hold, until nothing changes.
 * @param {Campaign} c @param {Facts} facts @param {Content} content @param {number} now @param {CampaignEvent} [event]
 * @returns {Campaign}
 */
function withFacts(c, facts, content, now, event) {
  let next = settleInto(c, facts, content, event);
  for (let i = 0; i < MAX_STEPS; i++) {
    const step = conditionStep(next.facts, content);
    if (!step) break;
    next = enterState(next, step, content, now);
  }
  return next;
}

/**
 * A machine enters a state: the transition's effects, then the state's own `enter` effects, then the
 * facts settle. A goto among them is an `entered:<node>` event too.
 * @param {Campaign} c @param {Step} step @param {Content} content @param {number} now @returns {Campaign}
 */
function enterState(c, step, content, now) {
  const state = content.machines?.[step.machine]?.states[step.to];
  // a step computed earlier in the same action whose machine has moved on since is stale: skipped
  if (!state || depth >= MAX_STEPS || (step.from !== undefined && c.facts.machines[step.machine]?.state !== step.from)) return c;
  depth++;
  try { return enterStateNow(c, step, state, content, now); } finally { depth--; }
}

/** @param {Campaign} c @param {Step} step @param {import('./types.js').MachineState} state @param {Content} content @param {number} now */
function enterStateNow(c, step, state, content, now) {
  const before = c.facts;
  const machines = { ...c.facts.machines, [step.machine]: { state: step.to, since: now } };
  /** @type {Campaign} */
  let next = { ...c, facts: { ...c.facts, machines } };
  /** @type {string[]} */
  const moves = [];
  for (const e of [...step.effects, ...(state.enter ?? [])]) {
    const was = next.at.node;
    next = applyEffect(next, e, content, now);
    if (next.at.node !== was) moves.push(next.at.node);
  }
  next = settleInto(next, next.facts, content, undefined, before);
  for (const node of moves) next = fire(next, `entered:${node}`, content, now);
  return next;
}

/**
 * One effect, without settling (the caller settles once after all of them).
 * @param {Campaign} c @param {Effect} e @param {Content} content @param {number} now @returns {Campaign}
 */
function applyEffect(c, e, content, now) {
  const f = c.facts;
  if ('flag' in e) return { ...c, facts: { ...f, flags: withId(f.flags, e.flag) } };
  if ('unlock' in e) {
    if (!content.nodes[e.unlock] || f.unlocked.includes(e.unlock)) return c;
    return withNews({ ...c, facts: { ...f, unlocked: [...f.unlocked, e.unlock] } }, { t: 'unlocked', node: e.unlock });
  }
  if ('item' in e) {
    if (!content.items?.[e.item]) return c;
    const to = recipients(e.to, content, { party: c.party });
    const n = Number.isInteger(e.count) && /** @type {number} */ (e.count) > 0 ? /** @type {number} */ (e.count) : 1;
    let inventory = f.inventory;
    for (const ch of to) inventory = addItem(inventory, ch, e.item, n);
    return withNews({ ...c, facts: { ...f, inventory } }, { t: 'item', item: e.item, to: /** @type {CharacterId[]} */ (to) });
  }
  if ('count' in e) { // after `item`: there `count` is how many items
    const cur = f.counters[e.count] ?? 0;
    const val = typeof e.set === 'number' ? e.set : cur + (typeof e.by === 'number' ? e.by : 1);
    return val === cur ? c : { ...c, facts: { ...f, counters: { ...f.counters, [e.count]: val } } };
  }
  if ('cutscene' in e) return withNews(c, { t: 'cutscene', id: e.cutscene });
  if ('goto' in e) return relocate(endMinigame(c, content, now), e.goto, content); // a running minigame ends first, recorded
  if ('wisp' in e || 'incarnate' in e) {
    // who: every member but the chooser ('others'), or the members holding that character; statuses as the game
    // master's Wisp Mode switch sets them (incarnating: the server's countdown, then `incarnate`)
    const on = 'wisp' in e;
    const who = on ? e.wisp : e.incarnate;
    /** @param {PartyMember} m */
    const target = (m) => !m.left && (who === 'others' ? m.character !== content.chooser : m.character === who);
    const players = Object.fromEntries(Object.entries(c.party.players).map(([id, m]) => {
      if (!target(m)) return [id, m];
      const statuses = nextStatuses(m.statuses, 'wisp', on);
      return [id, statuses === m.statuses ? m : { ...m, statuses }];
    }));
    return { ...c, party: { ...c.party, players } };
  }
  return c;
}

/**
 * An event to the machines: each one whose current state listens to it takes its transition.
 * @param {Campaign} c @param {string} event @param {Content} content @param {number} now @returns {Campaign}
 */
function fire(c, event, content, now) {
  let next = c;
  for (const step of eventSteps(c.facts, content, event)) next = enterState(next, step, content, now);
  return next === c ? c : withFacts(next, next.facts, content, now);
}

/** The party at a node: the room there, no minigame, the node seen. Not settled. @param {Campaign} c @param {string} node @param {Content} content */
function relocate(c, node, content) {
  if (!content.nodes[node]) return c;
  return { ...c, at: { node, ...noMinigameAt(content.nodes[node]) }, facts: { ...c.facts, seen: withId(c.facts.seen, node) } };
}

/** Moves the party to a node, settled, and tells the machines (`entered:<node>`).
 * @param {Campaign} c @param {string} node @param {Content} content @param {number} now @returns {Campaign} */
function moveTo(c, node, content, now) {
  const moved = relocate(c, node, content);
  return fire(withFacts(moved, moved.facts, content, now), `entered:${node}`, content, now);
}

// ---------------------------------------------------------------- the running minigame

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

/** Opens the lobby of the tableau's minigame where the party is, with the eligible players. None → the same campaign.
 * @param {Campaign} c @param {Content} content @param {number} now @returns {Campaign} */
function openMinigame(c, content, now) {
  const spec = minigame(c.at.kind);
  if (!spec || c.at.activity) return c;
  const node = content.nodes[c.at.node];
  const activity = spec.open({ seed: c.seed, settings: settingsAt(node), players: eligibleOf(c.party, c.at.node, content), now });
  return { ...c, seed: nextSeed(c.seed), at: { ...c.at, activity, results: [] } };
}

/**
 * Ends the running minigame: every finished round's result is recorded (round.finished) and settled, in
 * order, so a `winner` reward goes to the round that completed the node; then the room at the tableau. A
 * running round is dropped. No minigame → the same campaign.
 * @param {Campaign} c @param {Content} content @param {number} now @returns {Campaign}
 */
function endMinigame(c, content, now) {
  if (!c.at.activity) return c;
  /** @type {Campaign} */
  let next = { ...c, at: { ...c.at, activity: null, results: [] } };
  for (const result of c.at.results) {
    /** @type {CampaignEvent} */
    const ev = { t: 'round.finished', kind: /** @type {MinigameKind} */ (c.at.kind), node: c.at.node, ...result };
    next = withFacts(next, record(next.facts, ev), content, now, ev);
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

// ---------------------------------------------------------------- reducer

/**
 * @param {Campaign} c
 * @param {CampaignStep} a
 * @param {Content} content
 * @returns {Campaign}
 */
export function reduceCampaign(c, a, content) {
  const next = step(c, a, content, a.now ?? 0);
  return next === c ? c : withEligible(c, next, content);
}

/**
 * The statuses after a status change, or the same list when nothing changes. Wisp Mode off starts the
 * incarnation countdown (`incarnating`, finished by `incarnate`); on cancels it.
 * @param {string[]} statuses @param {string} status @param {boolean} on @returns {string[]}
 */
function nextStatuses(statuses, status, on) {
  if (status === 'wisp' && on) {
    const next = [...new Set([...statuses.filter((s) => s !== 'incarnating'), 'wisp'])];
    return next.length === statuses.length && next.every((s) => statuses.includes(s)) ? statuses : next;
  }
  if (status === 'wisp') {
    return statuses.includes('wisp') && !statuses.includes('incarnating') ? [...statuses, 'incarnating'] : statuses;
  }
  if (on) return statuses.includes(status) ? statuses : [...statuses, status];
  return statuses.includes(status) ? statuses.filter((s) => s !== status) : statuses;
}

/**
 * One action, before the running minigame hears of the eligible players' changes.
 * @param {Campaign} c @param {CampaignAction} a @param {Content} content @param {number} now @returns {Campaign}
 */
function step(c, a, content, now) {
  switch (a.t) {
    case 'join': {
      // a new member of the evening (the server's reclaim re-attaches an existing id: no action)
      if (!isCharacterId(a.character) || c.party.players[a.id]) return c;
      const held = c.party.order.some((id) => !c.party.players[id].left && c.party.players[id].character === a.character);
      if (held) return c;
      const { name, color } = CHARACTERS[a.character];
      const statuses = startsAsWisp(c, a.character, content) ? ['wisp'] : [];
      /** @type {Party} */
      const party = {
        order: [...c.party.order, a.id],
        players: { ...c.party.players, [a.id]: { id: a.id, character: a.character, name, color, left: false, statuses } },
      };
      return { ...c, party }; // a running minigame hears of it as their join, if they're eligible
    }

    case 'leave': {
      // a running minigame hears of it as their leave, and decides what it means
      const m = activeMember(c, a.id);
      if (!m) return c;
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...m, left: true } } } };
    }

    case 'status': {
      const member = activeMember(c, a.id);
      if (!member || typeof a.status !== 'string' || !a.status || a.status.length > 64 || a.status === 'incarnating') return c;
      const statuses = nextStatuses(member.statuses, a.status, !!a.on);
      if (statuses === member.statuses) return c;
      // a new story wisp stops being eligible where the tableau names nobody: the running minigame hears their leave
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...member, statuses } } } };
    }

    case 'incarnate': {
      const member = activeMember(c, a.id);
      if (!member || !member.statuses.includes('wisp') || !member.statuses.includes('incarnating')) return c;
      const statuses = member.statuses.filter((status) => status !== 'wisp' && status !== 'incarnating');
      return { ...c, party: { ...c.party, players: { ...c.party.players, [a.id]: { ...member, statuses } } } };
    }

    case 'enter': {
      // into an unlocked child of where the party is: the chooser walking into a door, or the game master until
      // the chooser leads (leadAfter); then the game master moves the party with gm goto
      const actor = actingMember(c, a.id);
      if (!actor) return c;
      const chooser = actor.character === content.chooser;
      if (leads(c.facts, content) ? !chooser : !chooser && !isGameMaster(c, a.id, content)) return c;
      const n = content.nodes[a.node];
      if (!n || n.parent !== c.at.node || !isUnlocked(c, n.id) || c.at.activity) return c;
      if (n.enterWhen && !holds(n.enterWhen, c.facts)) return c;
      if (n.kind === 'tableau' && c.facts.done.includes(n.id) && !n.replayable) return c; // one-shot, already seen
      const moved = moveTo(c, n.id, content, now);
      return n.startsOnEnter ? openMinigame(moved, content, now) : moved;
    }

    case 'use': {
      // a story machine's object action, offered to this member now (the server checked they stand next to it)
      const actor = actingMember(c, a.id);
      if (!actor || c.at.activity || typeof a.object !== 'string' || typeof a.action !== 'string') return c;
      const action = objectAction(a.object, actor, objectRules(c.facts, content));
      if (!action?.event || action.key !== a.action) return c;
      return fire(c, `${a.action}:${a.object}`, content, now);
    }

    case 'pickup': {
      // the chooser picks up an item lying where the party is (the server checked the distance)
      if (!actingChooser(c, a.id, content) || c.at.activity) return c;
      if (!pickupsAt(c.facts, content, c.at.node).some((p) => p.item === a.item) || !content.items[a.item]) return c;
      const facts = { ...c.facts, inventory: addItem(c.facts.inventory, content.chooser, a.item, 1) };
      const got = withNews(withFacts(c, facts, content, now), { t: 'item', item: a.item, to: [content.chooser] });
      return fire(got, `pickup:${a.item}`, content, now);
    }

    case 'zone': {
      // the chooser walked into a zone open where the party is (the server saw the step)
      if (!actingChooser(c, a.id, content) || c.at.activity) return c;
      if (!zonesAt(c.facts, content, c.at.node).some((z) => z.id === a.zone)) return c;
      return fire(c, `zone:${a.zone}`, content, now);
    }

    case 'tick': {
      // the timed transitions due now (the server schedules it at nextTimer)
      let next = c;
      for (const s of dueSteps(c.facts, content, now)) next = enterState(next, s, content, now);
      return next === c ? c : withFacts(next, next.facts, content, now);
    }

    case 'back': {
      // up one level: the game master, or the chooser once they lead (not while a minigame runs, and not
      // where the node says there is no way back); the game master's back ends a running minigame first
      const n = content.nodes[c.at.node];
      if (!n || n.parent === null) return c;
      const allowed = c.at.activity || !leads(c.facts, content) ? isGameMaster(c, a.id, content)
        : actingChooser(c, a.id, content) && n.back !== false;
      if (!allowed) return c;
      return moveTo(endMinigame(c, content, now), n.parent, content, now);
    }

    case 'startMinigame':
      // the game master, in the room at a minigame's tableau: its lobby, with the eligible players
      return isGameMaster(c, a.id, content) ? openMinigame(c, content, now) : c;

    case 'endMinigame':
      // the game master, in the minigame's lobby: its results recorded, back in the room at the tableau
      return isGameMaster(c, a.id, content) && minigameStatus(c) === 'lobby' ? endMinigame(c, content, now) : c;

    case 'activity': {
      const s = c.at.activity;
      if (!s) return c;
      return withActivity(c, kindOf(c).reduce(s, a.action, ctxOf(c, content)), content); // routed by the minigame's kind
    }

    case 'event': {
      // external events only: a round's result is recorded by the engine (exactly once)
      if (a.event.t === 'round.finished') return c;
      return withFacts(c, record(c.facts, a.event), content, now, a.event);
    }

    case 'ack': {
      // a TV played the news up to `upTo`: they go, and each cutscene among them is an event to the machines
      if (typeof a.upTo !== 'number') return c;
      const acked = c.news.filter((x) => x.seq <= a.upTo);
      if (!acked.length) return c;
      let next = { ...c, news: c.news.filter((x) => x.seq > a.upTo) };
      for (const n of acked) if (n.t === 'cutscene') next = fire(next, `cutscene:${n.id}`, content, now);
      return next;
    }

    case 'gm':
      return isGameMaster(c, a.id, content) ? gm(c, a.op, content, now) : c;

    default:
      return c;
  }
}

/**
 * Game-master ops: live fixes. The only way to take an unlock back is `lock`.
 * @param {Campaign} c @param {GmOp} op @param {Content} content @param {number} now @returns {Campaign}
 */
function gm(c, op, content, now) {
  const f = c.facts;
  const known = (/** @type {string} */ id) => !!content.nodes[id];
  switch (op?.op) {
    case 'goto':
      // a running minigame ends first (a running round is dropped)
      return known(op.node) && op.node !== c.at.node ? moveTo(endMinigame(c, content, now), op.node, content, now) : c;

    case 'unlock': {
      if (!known(op.node)) return c;
      const { [COUNTER.locked(op.node)]: wasLocked, ...counters } = f.counters;
      if (f.unlocked.includes(op.node) && !wasLocked) return c;
      /** @type {Facts} */
      const facts = { ...f, counters, unlocked: withId(f.unlocked, op.node) };
      const opened = f.unlocked.includes(op.node) ? c : withNews(c, { t: 'unlocked', node: op.node });
      return withFacts({ ...opened, facts }, facts, content, now);
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
      return withFacts(c, { ...f, flags: op.on ? [...f.flags, op.flag] : f.flags.filter((x) => x !== op.flag) }, content, now);
    }

    case 'count': {
      if (typeof op.counter !== 'string') return c;
      const cur = f.counters[op.counter] ?? 0;
      const val = typeof op.set === 'number' ? op.set : cur + (typeof op.by === 'number' ? op.by : 1);
      if (!Number.isFinite(val) || val === cur) return c;
      return withFacts(c, { ...f, counters: { ...f.counters, [op.counter]: val } }, content, now);
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
      return withFacts(c, { ...f, inventory }, content, now); // a `has` condition may open something now
    }

    case 'wisp': {
      if (!isCharacterId(op.character) || typeof op.on !== 'boolean') return c;
      const id = c.party.order.find((id) => !c.party.players[id].left && c.party.players[id].character === op.character);
      return id ? step(c, { t: 'status', id, status: 'wisp', on: op.on }, content, now) : c;
    }

    case 'machine': {
      // "skip that" / "play it again": the machine enters the state (its enter effects run, not a transition's)
      const m = content.machines?.[op.machine];
      if (!m || typeof op.state !== 'string' || !Object.hasOwn(m.states, op.state)) return c;
      const next = enterState(c, { machine: op.machine, to: op.state, effects: [] }, content, now);
      return withFacts(next, next.facts, content, now);
    }

    default:
      return c;
  }
}
