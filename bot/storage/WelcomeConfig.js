import { get, set } from './db.js';

const COLLECTION = 'welcomes';

function defaultSection() {
  return {
    enabled: false,
    channelId: null,
    message: null,
    backgroundUrl: null,
    logoUrl: null,
    theme: 'dark',
    mentionUser: true,
  };
}

function defaults() {
  return { welcome: defaultSection(), goodbye: defaultSection() };
}

export const WelcomeConfig = {
  get(guildId) {
    const saved = get(COLLECTION, guildId) ?? {};
    return {
      welcome: { ...defaultSection(), ...(saved.welcome ?? {}) },
      goodbye: { ...defaultSection(), ...(saved.goodbye ?? {}) },
    };
  },

  set(guildId, data) {
    set(COLLECTION, guildId, data);
  },

  updateSection(guildId, section, patch) {
    const current = WelcomeConfig.get(guildId);
    WelcomeConfig.set(guildId, {
      ...current,
      [section]: { ...current[section], ...patch },
    });
  },
};
