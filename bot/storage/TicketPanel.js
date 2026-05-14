import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'panels';
const LEGACY_COLLECTION = 'panel';
let panelIndexCache = null;

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
};

function normalizeRoleIds(value) {
  return asArray(value)
    .map(v => (v == null ? null : String(v).trim()))
    .filter(Boolean);
}

function normalizeTicketTypes(value) {
  const rawTypes = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? Object.values(value) : []);

  return rawTypes
    .filter(t => t != null)
    .map(t => {
      if (typeof t === 'string') {
        return {
          id: randomUUID(),
          label: t,
          description: null,
          emoji: null,
          category: null,
          supportRoles: [],
          questions: [],
        };
      }

      const questions = Array.isArray(t.questions) ? t.questions : [];
      return {
        id: String(t.id ?? t.typeId ?? randomUUID()),
        label: String(t.label ?? t.name ?? 'Support Ticket'),
        description: t.description ?? null,
        emoji: t.emoji ?? null,
        category: t.category ?? t.categoryId ?? null,
        supportRoles: normalizeRoleIds(t.supportRoles ?? t.supportRoleIds ?? t.supportRoleId),
        questions,
      };
    });
}

function normalizePanel(raw, { fallbackId = null, fallbackGuildId = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const source = raw.panel && typeof raw.panel === 'object' ? raw.panel : raw;

  const id = String(source.id ?? source.panelId ?? fallbackId ?? randomUUID());
  const guildId = source.guildId ?? raw.guildId ?? source.serverId ?? source.guild?.id ?? fallbackGuildId ?? null;
  if (!guildId) return null;

  const ticketTypes = normalizeTicketTypes(source.ticketTypes ?? raw.ticketTypes ?? []);
  const panelType = source.panelType
    ?? (ticketTypes.length > 0 && source.dropdown === true ? 'dropdown' : 'button');

  return {
    id,
    guildId: String(guildId),
    title: source.title ?? 'Support Tickets',
    description: source.description ?? 'Click a button below to open a ticket.',
    color: source.color ?? '#5865F2',
    footer: source.footer ?? '',
    thumbnail: source.thumbnail ?? '',
    banner: source.banner ?? '',
    bannerPosition: source.bannerPosition ?? 'bottom',
    emoji: source.emoji ?? '🎫',
    buttonLabel: source.buttonLabel ?? 'Open Ticket',
    dropdownLabel: source.dropdownLabel ?? 'Select ticket type',
    dropdownPlaceholder: source.dropdownPlaceholder ?? 'Choose a type...',
    supportCategory: source.supportCategory ?? source.categoryId ?? source.category ?? null,
    allowedRoles: normalizeRoleIds(source.allowedRoles ?? source.supportRoles ?? source.supportRoleIds ?? source.supportRoleId),
    pingRoles: normalizeRoleIds(source.pingRoles),
    namingFormat: source.namingFormat ?? 'ticket-{username}',
    panelChannel: source.panelChannel ?? source.channelId ?? null,
    logChannel: source.logChannel ?? source.logChannelId ?? null,
    transcriptChannel: source.transcriptChannel ?? source.transcriptChannelId ?? null,
    openMessage: source.openMessage ?? 'Thanks for opening a ticket! Support will be with you shortly.',
    closeMessage: source.closeMessage ?? 'Your ticket has been closed. Thank you!',
    panelType,
    ticketTypes,
    claimEnabled: source.claimEnabled ?? true,
    transcriptEnabled: source.transcriptEnabled ?? true,
    reopenEnabled: source.reopenEnabled ?? true,
    reopenWindow: source.reopenWindow ?? 24,
    inactivityClose: source.inactivityClose ?? 0,
    maxPerUser: source.maxPerUser ?? 1,
    maxGlobal: source.maxGlobal ?? 0,
    cooldownHours: source.cooldownHours ?? 0,
    modalEnabled: source.modalEnabled ?? false,
    blacklistEnabled: source.blacklistEnabled ?? false,
    blacklistedUsers: Array.isArray(source.blacklistedUsers) ? source.blacklistedUsers : [],
    messageId: source.messageId ?? source.panelMessageId ?? null,
    createdAt: source.createdAt ?? Date.now(),
  };
}

function buildLegacyCandidates() {
  const legacy = getAll(LEGACY_COLLECTION) ?? {};
  const entries = Object.entries(legacy);
  const out = [];

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;

    const maybeGuildId = /^\d{15,22}$/.test(key) ? key : null;

    if (Array.isArray(value.panels)) {
      for (const panel of value.panels) {
        const normalized = normalizePanel(panel, { fallbackGuildId: maybeGuildId });
        if (normalized) out.push(normalized);
      }
      continue;
    }

    if (Array.isArray(value.ticketPanels)) {
      for (const panel of value.ticketPanels) {
        const normalized = normalizePanel(panel, { fallbackGuildId: maybeGuildId });
        if (normalized) out.push(normalized);
      }
      continue;
    }

    const normalized = normalizePanel(value, { fallbackId: key, fallbackGuildId: maybeGuildId });
    if (normalized) out.push(normalized);
  }

  return out;
}

function buildPanelIndex() {
  if (panelIndexCache) return new Map(panelIndexCache);

  const map = new Map();
  const current = getAll(COLLECTION) ?? {};

  for (const [key, value] of Object.entries(current)) {
    const normalized = normalizePanel(value, { fallbackId: key });
    if (!normalized) continue;
    map.set(normalized.id, normalized);

    // Self-heal key mismatch if old primary entry was keyed differently
    if (key !== normalized.id) set(COLLECTION, normalized.id, normalized);
  }

  for (const panel of buildLegacyCandidates()) {
    if (!map.has(panel.id)) {
      map.set(panel.id, panel);
      set(COLLECTION, panel.id, panel);
    }
  }

  panelIndexCache = map;
  return new Map(map);
}

function findByAnyId(index, id) {
  if (id == null) return null;
  const needle = String(id);

  if (index.has(needle)) return index.get(needle);

  for (const panel of index.values()) {
    if (String(panel.id) === needle) return panel;
    if (panel.messageId && String(panel.messageId) === needle) return panel;
    if (panel.panelId && String(panel.panelId) === needle) return panel;
  }

  return null;
}

export const TicketPanel = {
  create: (guildId, data) => {
    const id = randomUUID();
    const panel = normalizePanel({ id, guildId, ...data }, { fallbackId: id, fallbackGuildId: guildId });
    if (!panel) return null;
    set(COLLECTION, id, panel);
    panelIndexCache = null;
    return panel;
  },

  get: (id) => {
    const index = buildPanelIndex();
    return findByAnyId(index, id);
  },

  update: (id, patch) => {
    const panel = TicketPanel.get(id);
    if (!panel) return null;
    const merged = { ...panel, ...patch };
    const normalized = normalizePanel(merged, { fallbackId: panel.id, fallbackGuildId: panel.guildId });
    const updated = normalized ? { ...merged, ...normalized } : merged;
    set(COLLECTION, updated.id ?? panel.id, updated);
    panelIndexCache = null;
    return updated;
  },

  delete: (id) => {
    const panel = TicketPanel.get(id);
    if (panel) del(COLLECTION, panel.id);
    del(COLLECTION, String(id));
    del(LEGACY_COLLECTION, String(id));
    panelIndexCache = null;
  },

  forGuild: (guildId) => {
    const gid = String(guildId);
    return [...buildPanelIndex().values()].filter(p => String(p.guildId) === gid);
  },

  all: () => [...buildPanelIndex().values()],
};
