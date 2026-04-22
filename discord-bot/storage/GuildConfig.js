import { get, set } from './db.js';

const COLLECTION = 'guilds';

const defaults = () => ({
  welcomeEnabled: false,
  welcomeChannel: null,
  welcomeMessage: 'Welcome {user} to {server}!',
  logChannel: null,
  staffRoles: [],
  autoResponses: [],
  suggestionChannel: null,
  vouchChannel: null,
  vouchApprovalChannel: null,
  planChannel: null,
});

export const GuildConfig = {
  get: (guildId) => ({ ...defaults(), ...(get(COLLECTION, guildId) ?? {}) }),
  set: (guildId, data) => set(COLLECTION, guildId, { ...GuildConfig.get(guildId), ...data }),
  update: (guildId, patch) => GuildConfig.set(guildId, patch),
};
