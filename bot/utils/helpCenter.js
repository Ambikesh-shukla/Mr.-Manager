import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { embed, Colors } from './embeds.js';
import { logger } from './logger.js';

const HELP_DIVIDER = '━━━━━━━━━━━━━━━━';
export const HELP_MENU_CUSTOM_ID = 'help:menu';
const HELP_REPO_URL = 'https://github.com/Ambikesh-shukla/Mr.-Manager';
const DEFAULT_SUPPORT_URL = `${HELP_REPO_URL}/issues`;
let inviteUrlFallbackWarned = false;
let supportUrlFallbackWarned = false;

const HELP_SECTIONS = {
  admin: {
    menuLabel: 'Admin Commands',
    menuDescription: 'Core configuration and moderation tools',
    menuEmoji: '🔐',
    sectionTitle: '🔐 Admin Commands',
    sectionBody: [
      '`/admin config` → View the full bot configuration snapshot',
      '`/admin staffrole add` → Grant a role access to staff-level actions',
      '`/admin staffrole remove` → Remove a role from staff access',
      '`/welcome` → Configure welcome and goodbye card flows',
      '`/autoresponse add` → Add an auto-reply trigger for common questions',
      '`/post embed` → Launch the guided embed posting wizard',
      '`/purge all` → Bulk-delete recent messages in the current channel',
      '`/link` → Manage the server link-block protection system',
    ].join('\n'),
  },
  staff: {
    menuLabel: 'Staff Commands',
    menuDescription: 'Operational commands for moderators and team roles',
    menuEmoji: '👨‍💼',
    sectionTitle: '👨‍💼 Staff Commands',
    sectionBody: [
      '`/review list` → Check pending reviews waiting for approval',
      '`/ticket edit` → Open the ticket panel editor for updates',
      '`/ticket delete` → Remove a ticket panel by panel ID',
      '`/plan list` → Show all currently available plans',
      '`/server` → Open the provisioning dashboard to create and manage server instances',
    ].join('\n'),
  },
  tickets: {
    menuLabel: 'Ticket Commands',
    menuDescription: 'Ticket setup and panel management',
    menuEmoji: '🎫',
    sectionTitle: '🎫 Ticket Commands',
    sectionBody: [
      '`/setup-ticket` → Create ticket panels with the guided setup flow',
      '`/ticket edit` → Modify an existing ticket panel by panel ID',
      '`/ticket delete` → Delete a ticket panel and remove its message',
    ].join('\n'),
  },
  public: {
    menuLabel: 'Public Commands',
    menuDescription: 'Everyday commands available to members',
    menuEmoji: '🌍',
    sectionTitle: '🌍 Public Commands',
    sectionBody: [
      '`/help` → Open this interactive help board',
      '`/ping` → Check bot and API latency status',
      '`/serverinfo` → Show server owner, members, and stats',
      '`/credits` → View server credits, plan, and usage',
      '`/redeem` → Redeem a Core/Pro server code',
      '`/invite` → Check invite stats and reward eligibility',
      '`/afk set` → Set your away status with an optional reason',
      '`/afk remove` → Clear your AFK status',
      '`/afk status` → Check a member’s AFK status',
      '`/review submit` → Submit a review or vouch',
    ].join('\n'),
  },
  commandLock: {
    menuLabel: 'Command Lock System',
    menuDescription: 'Control command access by role and level',
    menuEmoji: '🔒',
    sectionTitle: '🔒 Command Lock System',
    sectionBody: [
      '`/command-lock set` → Set a command mode (public/staff/admin/role)',
      '`/command-lock view` → Inspect the current lock for one command',
      '`/command-lock list` → List lock settings for all commands',
      '`/command-lock reset` → Restore one command to its default mode',
    ].join('\n'),
  },
  quickStart: {
    menuLabel: 'Quick Start',
    menuDescription: 'Fast launch path for a new server setup',
    menuEmoji: '⚡',
    sectionTitle: '⚡ Quick Start',
    sectionBody: [
      '`/admin staffrole add` → Add your support role first',
      '`/setup-ticket` → Build and publish your ticket panel',
      '`/plan create` → Publish your first hosting/service plan',
      '`/post embed` → Publish a polished info or sales embed in your channels',
      '`/command-lock set` → Lock sensitive commands before going live',
      '`/help` → Reopen this board anytime for command reference',
    ].join('\n'),
  },
};
export const HELP_SECTION_KEYS = Object.keys(HELP_SECTIONS);

function isValidHttpsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getInviteUrl(interaction) {
  const appId = interaction.client.application?.id ?? process.env.DISCORD_APPLICATION_ID;
  if (!appId) {
    if (!inviteUrlFallbackWarned) {
      logger.warn('[HELP] Missing Discord application ID; invite button is falling back to repository URL.');
      inviteUrlFallbackWarned = true;
    }
    return HELP_REPO_URL;
  }
  return `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=0&scope=bot%20applications.commands`;
}

function getSupportUrl() {
  const configured = (process.env.SUPPORT_URL ?? '').trim();
  if (!configured) return DEFAULT_SUPPORT_URL;
  if (isValidHttpsUrl(configured)) return configured;
  if (!supportUrlFallbackWarned) {
    logger.warn('[HELP] SUPPORT_URL is invalid; support button is falling back to default support URL.');
    supportUrlFallbackWarned = true;
  }
  return DEFAULT_SUPPORT_URL;
}

export function buildHelpCenterEmbed(interaction, sectionKey = 'quickStart') {
  const section = HELP_SECTIONS[sectionKey] ?? HELP_SECTIONS.quickStart;
  const thumbnail = interaction.client.user?.displayAvatarURL({ size: 256 }) ?? undefined;

  return embed({
    title: '🤖 Mr. Manager Help Center',
    description: [
      `**${section.sectionTitle}**`,
      HELP_DIVIDER,
      section.sectionBody,
    ].join('\n'),
    color: Colors.primary,
    thumbnail,
    fields: [],
    footer: 'Powered by Mr. Manager ⚡',
    timestamp: true,
  });
}

export function buildHelpCenterComponents(interaction, sectionKey = 'quickStart') {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(HELP_MENU_CUSTOM_ID)
    .setPlaceholder('Navigate Help Center')
    .addOptions(Object.entries(HELP_SECTIONS).map(([key, section]) => ({
      label: section.menuLabel,
      description: section.menuDescription,
      value: key,
      emoji: section.menuEmoji,
      default: key === sectionKey,
    })));

  const menuRow = new ActionRowBuilder().addComponents(menu);

  const linksRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Invite Bot')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Link)
      .setURL(getInviteUrl(interaction)),
    new ButtonBuilder()
      .setLabel('Support')
      .setEmoji('🛟')
      .setStyle(ButtonStyle.Link)
      .setURL(getSupportUrl()),
    new ButtonBuilder()
      .setLabel('Source')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Link)
      .setURL(HELP_REPO_URL),
  );

  return [menuRow, linksRow];
}

export function buildHelpCenterPayload(interaction, sectionKey = 'quickStart') {
  return {
    embeds: [buildHelpCenterEmbed(interaction, sectionKey)],
    components: buildHelpCenterComponents(interaction, sectionKey),
  };
}
