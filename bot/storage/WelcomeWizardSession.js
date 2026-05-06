const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000; // 10 minutes

function key(guildId, userId, section) {
  return `${guildId}:${userId}:${section}`;
}

export const WelcomeWizardSession = {
  create(guildId, userId, section, base = {}) {
    const k = key(guildId, userId, section);
    const session = {
      guildId,
      userId,
      section,
      channelId:     base.channelId     ?? null,
      message:       base.message       ?? null,
      backgroundUrl: base.backgroundUrl ?? null,
      logoUrl:       base.logoUrl       ?? null,
      theme:         base.theme         ?? 'dark',
      textColor:     base.textColor     ?? null,
      mentionUser:   base.mentionUser   ?? true,
      createdAt:     Date.now(),
    };
    sessions.set(k, session);
    return session;
  },

  get(guildId, userId, section) {
    const k = key(guildId, userId, section);
    const s = sessions.get(k);
    if (!s) return null;
    if (Date.now() - s.createdAt > SESSION_TTL) {
      sessions.delete(k);
      return null;
    }
    return s;
  },

  update(guildId, userId, section, patch) {
    const k = key(guildId, userId, section);
    const s = sessions.get(k);
    if (!s) return null;
    const { createdAt, ...rest } = patch; // prevent callers from tampering with TTL
    Object.assign(s, rest);
    return s;
  },

  delete(guildId, userId, section) {
    sessions.delete(key(guildId, userId, section));
  },
};
