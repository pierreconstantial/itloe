// The server's single door to the campaign engine (shared/campaign, Contract D v2 + A1) and to the
// evening's content. Swapping the placeholder content for the real story is one line here.

import {
  newCampaign, fromLegacyState, loadCampaign, reduceCampaign, activityOf, isUnlocked,
  validateContent, zoneAt, SAMPLE_CONTENT,
} from '../shared/campaign/index.js';
import type { Campaign, CampaignAction, CampaignEvent, Content, GmOp } from '../shared/campaign/types.js';

export { newCampaign, fromLegacyState, loadCampaign, reduceCampaign, activityOf, isUnlocked, validateContent, zoneAt };
export type { Campaign, CampaignAction, CampaignEvent, Content, GmOp };

/** The evening's content (placeholder until the user writes the story). */
export const CONTENT: Content = SAMPLE_CONTENT;

/** Refuses to boot on broken content, with every problem listed (an evening must not start broken). */
export function assertContent(content: Content): void {
  const problems = validateContent(content);
  if (problems.length) {
    throw new Error(`campaign content is broken (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`);
  }
}
