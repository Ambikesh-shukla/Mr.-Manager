const sessions = new Map();

export const SetupSession = {
  key: (guildId, userId) => `${guildId}:${userId}`,

  create: (guildId, userId) => {
    const k = `${guildId}:${userId}`;
    const session = {
      guildId,
      userId,
      title: 'Support Tickets',
      description: 'Click below to open a support ticket.',
      color: '#5865F2',
      footer: '',
      thumbnail: '',
      banner: '',
      namingFormat: 'ticket-{username}',
      supportCategory: null,
      logChannel: null,
      transcriptChannel: null,
      allowedRoles: [],
      pingRoles: [],
      cooldownHours: 0,
      maxPerUser: 1,
      maxGlobal: 0,
      modalEnabled: false,
      panelType: 'button',
      openMessage: 'Thanks for opening a ticket! Support will be with you shortly.',
      ticketTypes: [],
      _editingPanelId: null,
    };
    sessions.set(k, session);
    return session;
  },

  fromPanel: (guildId, userId, panel) => {
    const k = `${guildId}:${userId}`;
    const session = {
      guildId,
      userId,
      title: panel.title,
      description: panel.description,
      color: panel.color,
      footer: panel.footer ?? '',
      thumbnail: panel.thumbnail ?? '',
      banner: panel.banner ?? '',
      namingFormat: panel.namingFormat ?? 'ticket-{username}',
      supportCategory: panel.supportCategory ?? null,
      logChannel: panel.logChannel ?? null,
      transcriptChannel: panel.transcriptChannel ?? null,
      allowedRoles: [...(panel.allowedRoles ?? [])],
      pingRoles: [...(panel.pingRoles ?? [])],
      cooldownHours: panel.cooldownHours ?? 0,
      maxPerUser: panel.maxPerUser ?? 1,
      maxGlobal: panel.maxGlobal ?? 0,
      modalEnabled: panel.modalEnabled ?? false,
      panelType: panel.panelType ?? 'button',
      openMessage: panel.openMessage ?? 'Thanks for opening a ticket!',
      ticketTypes: JSON.parse(JSON.stringify(panel.ticketTypes ?? [])),
      _editingPanelId: panel.id,
    };
    sessions.set(k, session);
    return session;
  },

  get: (guildId, userId) => sessions.get(`${guildId}:${userId}`) ?? null,

  update: (guildId, userId, patch) => {
    const s = sessions.get(`${guildId}:${userId}`);
    if (!s) return null;
    Object.assign(s, patch);
    return s;
  },

  delete: (guildId, userId) => sessions.delete(`${guildId}:${userId}`),

  has: (guildId, userId) => sessions.has(`${guildId}:${userId}`),
};
