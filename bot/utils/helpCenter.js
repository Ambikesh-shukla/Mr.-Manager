import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { embed, Colors } from './embeds.js';

const HELP_DIVIDER = '━━━━━━━━━━━━━━━━';
export const HELP_MENU_CUSTOM_ID = 'help:menu';
const HELP_REPO_URL = 'https://github.com/Ambikesh-shukla/Mr.-Manager';

const HELP_SECTIONS = {
  overview: {
    menuLabel: 'Overview',
    menuDescription: 'What Mr. Manager does + fast setup',
    menuEmoji: '🏠',
    sectionTitle: '🏠 Help Overview',
    sectionBody: [
      'Mr. Manager helps you run a polished community support stack with tickets,',
      'hosting plans, server tools, review workflows, AFK status, and automation.',
    ].join('\n'),
    fields: [
      {
        name: '🧩 What the bot does',
        value: '🎟️ Tickets • 💼 Hosting plans • 🛠️ Server tools • ⭐ Reviews • 😴 AFK • 🤖 Automation',
        inline: false,
      },
      {
        name: '🧭 How to use this menu',
        value: 'Use the dropdown below to switch sections and get focused command guidance.',
        inline: false,
      },
      {
        name: '🚀 Quick setup path',
        value: '1. `/admin staffrole add`\n2. `/setup-ticket`\n3. `/plan create`\n4. `/plan sales`',
        inline: false,
      },
      {
        name: '🔗 Important links',
        value: 'Use the buttons below for invite, support, and source links.',
        inline: false,
      },
    ],
  },
  tickets: {
    menuLabel: 'Tickets',
    menuDescription: 'Support board and ticket workflow',
    menuEmoji: '🎟️',
    sectionTitle: '🎟️ Ticket Center',
    sectionBody: 'Build and operate a clean support board with setup wizard + ticket controls.',
    fields: [
      {
        name: '🛠️ Setup & management',
        value: '`/setup-ticket` • `/ticket list` • `/ticket edit` • `/ticket delete`',
        inline: false,
      },
      {
        name: '📨 Ticket actions',
        value: '`/ticket close` • `/ticket claim` • `/ticket add-user` • `/ticket remove-user` • `/ticket transcript`',
        inline: false,
      },
    ],
  },
  hosting: {
    menuLabel: 'Hosting',
    menuDescription: 'Plans, credits, and invite rewards',
    menuEmoji: '💼',
    sectionTitle: '💼 Hosting & Billing',
    sectionBody: 'Manage plans, sell services, and track credits from one flow.',
    fields: [
      {
        name: '📦 Plan tools',
        value: '`/plan create` • `/plan list` • `/plan sales` • `/plan config`',
        inline: false,
      },
      {
        name: '💳 Credits & rewards',
        value: '`/credits` • `/redeem` • `/invite`',
        inline: false,
      },
    ],
  },
  tools: {
    menuLabel: 'Server Tools',
    menuDescription: 'Moderation and utility command set',
    menuEmoji: '🛠️',
    sectionTitle: '🛠️ Server Tools',
    sectionBody: 'Daily operational tools for staff and admins.',
    fields: [
      {
        name: '👮 Admin controls',
        value: '`/admin config` • `/command-lock set/view/list/reset` • `/purge`',
        inline: false,
      },
      {
        name: '🌐 Utility',
        value: '`/serverinfo` • `/server panel` • `/link`',
        inline: false,
      },
    ],
  },
  automation: {
    menuLabel: 'Automation',
    menuDescription: 'Auto responses, welcome, and reviews',
    menuEmoji: '🤖',
    sectionTitle: '🤖 Automation Suite',
    sectionBody: 'Automate repetitive server workflows and engagement routines.',
    fields: [
      {
        name: '⚙️ Automation commands',
        value: '`/autoresponse add/remove/list` • `/welcome` • `/review config/list/submit` • `/afk set/remove/status`',
        inline: false,
      },
    ],
  },
};
export const HELP_SECTION_KEYS = Object.keys(HELP_SECTIONS);

function getInviteUrl(interaction) {
  const appId = interaction.client.application?.id ?? process.env.DISCORD_APPLICATION_ID;
  if (!appId) return HELP_REPO_URL;
  return `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=8&scope=bot%20applications.commands`;
}

export function buildHelpCenterEmbed(interaction, sectionKey = 'overview') {
  const section = HELP_SECTIONS[sectionKey] ?? HELP_SECTIONS.overview;
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
    fields: section.fields,
    footer: 'Powered by Mr. Manager ⚡',
    timestamp: true,
  });
}

export function buildHelpCenterComponents(interaction, sectionKey = 'overview') {
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
      .setURL(`${HELP_REPO_URL}/issues`),
    new ButtonBuilder()
      .setLabel('Source')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Link)
      .setURL(HELP_REPO_URL),
  );

  return [menuRow, linksRow];
}

export function buildHelpCenterPayload(interaction, sectionKey = 'overview') {
  return {
    embeds: [buildHelpCenterEmbed(interaction, sectionKey)],
    components: buildHelpCenterComponents(interaction, sectionKey),
  };
}
