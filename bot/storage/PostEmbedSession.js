const sessions = new Map();

const SESSION_TTL = 2 * 60 * 1000; // 2 minutes inactivity timeout

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function baseSession(guildId, userId) {
  return {
    guildId,
    userId,
    title: null,
    description: null,
    color: '#5865F2',
    image: null,
    thumbnail: null,
    footer: null,
    targetChannelId: null,
    step: null,
    inputChannelId: null,
    webhook: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function isExpired(session) {
  return Date.now() - session.updatedAt > SESSION_TTL;
}

export const PostEmbedSession = {
  create(guildId, userId) {
    const s = baseSession(guildId, userId);
    sessions.set(key(guildId, userId), s);
    return s;
  },

  get(guildId, userId) {
    const k = key(guildId, userId);
    const s = sessions.get(k);
    if (!s) return null;
    if (isExpired(s)) {
      sessions.delete(k);
      return null;
    }
    return s;
  },

  update(guildId, userId, patch) {
    const s = this.get(guildId, userId);
    if (!s) return null;
    Object.assign(s, patch, { updatedAt: Date.now() });
    return s;
  },

  resetDraft(guildId, userId) {
    const s = this.get(guildId, userId);
    if (!s) return null;
    Object.assign(s, {
      title: null,
      description: null,
      color: '#5865F2',
      image: null,
      thumbnail: null,
      footer: null,
      targetChannelId: null,
      step: null,
      inputChannelId: null,
      updatedAt: Date.now(),
    });
    return s;
  },

  touch(guildId, userId) {
    const s = this.get(guildId, userId);
    if (!s) return null;
    s.updatedAt = Date.now();
    return s;
  },

  delete(guildId, userId) {
    sessions.delete(key(guildId, userId));
  },

  getWaitingInChannel(guildId, channelId, userId) {
    const s = this.get(guildId, userId);
    if (!s) return null;
    if (s.inputChannelId !== channelId || !s.step) return null;
    return s;
  },
};

