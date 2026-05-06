import { get, set } from './db.js';

const COLLECTION = 'linkconfigs';

function defaults() {
  return {
    enabled: false,
    allowedUsers: [],
    allowAdmins: true,
    allowOwner: true,
    allowBotOwner: false,
  };
}

export const LinkConfig = {
  get(guildId) {
    const saved = get(COLLECTION, guildId) ?? {};
    return { ...defaults(), ...saved };
  },
  set(guildId, data) {
    set(COLLECTION, guildId, { ...defaults(), ...data });
  },
  update(guildId, patch) {
    LinkConfig.set(guildId, { ...LinkConfig.get(guildId), ...patch });
  },
};
