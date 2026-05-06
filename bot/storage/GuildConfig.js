import { get, set } from './db.js';

const COLLECTION = 'guilds';

const defaults = () => ({
  logChannel: null,
  staffRoles: [],
  autoResponses: [],
  vouchChannel: null,
  vouchApprovalChannel: null,
  planChannel: null,
  latestReviewMessageId: null,
  latestReviewChannelId: null,
});

export const GuildConfig = {
  get: (guildId) => ({ ...defaults(), ...(get(COLLECTION, guildId) ?? {}) }),
  set: (guildId, data) => set(COLLECTION, guildId, { ...GuildConfig.get(guildId), ...data }),
  update: (guildId, patch) => GuildConfig.set(guildId, patch),
};
