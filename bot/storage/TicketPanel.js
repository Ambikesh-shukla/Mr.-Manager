import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'panels';

export const TicketPanel = {
  create: (guildId, data) => {
    const id = randomUUID();
    const panel = {
      id,
      guildId,
      title: data.title ?? 'Support Tickets',
      description: data.description ?? 'Click a button below to open a ticket.',
      color: data.color ?? '#5865F2',
      footer: data.footer ?? '',
      thumbnail: data.thumbnail ?? '',
      banner: data.banner ?? '',
      bannerPosition: data.bannerPosition ?? 'bottom',
      emoji: data.emoji ?? '🎫',
      buttonLabel: data.buttonLabel ?? 'Open Ticket',
      dropdownLabel: data.dropdownLabel ?? 'Select ticket type',
      dropdownPlaceholder: data.dropdownPlaceholder ?? 'Choose a type...',
      supportCategory: data.supportCategory ?? null,
      allowedRoles: data.allowedRoles ?? [],
      pingRoles: data.pingRoles ?? [],
      namingFormat: data.namingFormat ?? 'ticket-{username}',
      panelChannel: data.panelChannel ?? null,
      logChannel: data.logChannel ?? null,
      transcriptChannel: data.transcriptChannel ?? null,
      openMessage: data.openMessage ?? 'Thanks for opening a ticket! Support will be with you shortly.',
      closeMessage: data.closeMessage ?? 'Your ticket has been closed. Thank you!',
      panelType: data.panelType ?? 'button',
      ticketTypes: data.ticketTypes ?? [],
      claimEnabled: data.claimEnabled ?? true,
      transcriptEnabled: data.transcriptEnabled ?? true,
      reopenEnabled: data.reopenEnabled ?? true,
      reopenWindow: data.reopenWindow ?? 24,
      inactivityClose: data.inactivityClose ?? 0,
      maxPerUser: data.maxPerUser ?? 1,
      maxGlobal: data.maxGlobal ?? 0,
      cooldownHours: data.cooldownHours ?? 0,
      modalEnabled: data.modalEnabled ?? false,
      blacklistEnabled: data.blacklistEnabled ?? false,
      blacklistedUsers: data.blacklistedUsers ?? [],
      messageId: data.messageId ?? null,
      createdAt: Date.now(),
    };
    set(COLLECTION, id, panel);
    return panel;
  },
  get: (id) => get(COLLECTION, id),
  update: (id, patch) => {
    const panel = TicketPanel.get(id);
    if (!panel) return null;
    const updated = { ...panel, ...patch };
    set(COLLECTION, id, updated);
    return updated;
  },
  delete: (id) => del(COLLECTION, id),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(p => p.guildId === guildId),
  all: () => Object.values(getAll(COLLECTION)),
};
