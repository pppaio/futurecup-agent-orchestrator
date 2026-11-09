import type { AgentProfile } from '../types.js';
import { ANALYST_PROFILE } from './analyst.js';
import { BUILDER_PROFILE } from './builder.js';
import { CRITIC_PROFILE } from './critic.js';
import { FIXER_PROFILE } from './fixer.js';

export const ALL_AGENTS: Map<string, AgentProfile> = new Map([
  [ANALYST_PROFILE.id, ANALYST_PROFILE],
  [BUILDER_PROFILE.id, BUILDER_PROFILE],
  [CRITIC_PROFILE.id, CRITIC_PROFILE],
  [FIXER_PROFILE.id, FIXER_PROFILE],
]);
