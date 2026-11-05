// The server's single door to the campaign engine (shared/campaign, Contract D v2 + A1) and to the
// evening's content. Swapping the placeholder content for the real story is one line here.

import { createHash } from 'node:crypto';
import {
  newCampaign, fromLegacyState, loadCampaign, reduceCampaign, activityOf, isUnlocked, roundStatus,
  validateContent, zoneAt, UnknownMinigameError, SAMPLE_CONTENT,
} from '../shared/campaign/index.js';
import { STORY_CONTENT } from '../shared/campaign/story.js';
import type { Campaign, CampaignAction, CampaignEvent, Content, GmOp } from '../shared/campaign/types.js';

export { newCampaign, fromLegacyState, loadCampaign, reduceCampaign, activityOf, isUnlocked, roundStatus, validateContent, zoneAt, UnknownMinigameError };
export type { Campaign, CampaignAction, CampaignEvent, Content, GmOp };

/** The birthday campaign; SAMPLE_CONTENT remains an isolated engine fixture. */
export const CONTENT: Content = process.env.ITLOE_CONTENT === 'sample' ? SAMPLE_CONTENT : STORY_CONTENT;

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
