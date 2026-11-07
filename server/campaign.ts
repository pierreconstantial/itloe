// The server's single door to the campaign engine (shared/campaign, Contract D v2 + A1) and to the
// evening's content. Swapping the placeholder content for the real story is one line here.

import { createHash } from 'node:crypto';
import {
  newCampaign, loadCampaign, reduceCampaign, activityOf, isUnlocked, minigameStatus, gameMasterId, eligibleOf, askedSoFar,
  validateContent, zoneAt, roomAt, sceneAt, UnknownMinigameError, SAMPLE_CONTENT,
  chooserHeld, pickupsAt, zonesAt, objectRules, characterRules, characterTarget, nextTimer, within, leads,
} from '../shared/campaign/index.js';
import { STORY_CONTENT } from '../shared/campaign/story/index.js';
import { minigameContent } from '../shared/campaign/sample.js';
import { MINIGAMES } from '../shared/minigames.js';
import type { Campaign, CampaignAction, CampaignEvent, Content, GmOp } from '../shared/campaign/types.js';

export { newCampaign, loadCampaign, reduceCampaign, activityOf, isUnlocked, minigameStatus, gameMasterId, eligibleOf, askedSoFar, validateContent, zoneAt, roomAt, sceneAt, UnknownMinigameError };
export { chooserHeld, pickupsAt, zonesAt, objectRules, characterRules, characterTarget, nextTimer, within, leads };
export type { Campaign, CampaignAction, CampaignEvent, Content, GmOp };

/** The content ITLOE_CONTENT names: the birthday story when unset or empty, `sample` for the engine's
 *  fixture, `minigame:<kind>` for one minigame's development start. Any other value refuses to boot. */
function contentFor(setting: string | undefined): Content {
  if (!setting) return STORY_CONTENT;
  if (setting === 'sample') return SAMPLE_CONTENT;
  if (setting.startsWith('minigame:')) {
    const kind = setting.slice('minigame:'.length);
    const content = minigameContent(kind);
    if (!content) throw new Error(`ITLOE_CONTENT=${setting}: no minigame "${kind}" (registered: ${Object.keys(MINIGAMES).join(', ')})`);
    return content;
  }
  throw new Error(`ITLOE_CONTENT=${setting}: unknown content (accepted: unset for the story, sample, minigame:<kind>)`);
}

export const CONTENT: Content = contentFor(process.env.ITLOE_CONTENT);
/** The birthday story is playing (its scene shortcuts, server/test-scenes.ts, need it). */
export const IS_STORY = CONTENT === STORY_CONTENT;

/** Short hash of the content, computed once at boot: views carry it as `contentVersion`, GET /api/content
 *  serves it (body + ETag), so clients re-fetch the content only when it changed (an edit + restart). */
export const CONTENT_VERSION = createHash('sha256').update(JSON.stringify(CONTENT)).digest('hex').slice(0, 12);

/** Refuses to boot on broken content, with every problem listed (an evening must not start broken). */
export function assertContent(content: Content): void {
  const problems = validateContent(content);
  if (problems.length) {
    throw new Error(`campaign content is broken (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`);
  }
}
