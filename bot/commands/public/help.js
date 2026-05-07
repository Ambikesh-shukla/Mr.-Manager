import { SlashCommandBuilder } from 'discord.js';
import { embed, Colors } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available bot commands'),

  defaultLevel: 'public',

  async execute(interaction) {
    await interaction.reply({
      embeds: [embed({
        title: '🤖 Mr. Manager — Command Reference',
        description: 'Minecraft server provider bot. All commands are slash commands — type `/` to see them.\n\u200b',
        color: Colors.primary,
        fields: [
          {
            name: '🔐 Admin Commands *(Admin only by default)*',
            value: [
              '`/admin staffrole` `add/remove/list` — Manage who counts as staff',
              '`/admin config` — View full server configuration',
              '`/command-lock set/view/list/reset` — Control who can use each command',
              '`/setup-ticket` — **Interactive ticket panel wizard**',
              '`/ticket list/info/edit/delete` — Manage existing ticket panels',
              '`/post announce/embed/faq` — Post announcements, embeds, FAQs',
              '`/autoresponse add/remove/list` — Keyword auto-responses',
            ].join('\n'),
            inline: false,
          },
          {
            name: '👮 Staff Commands *(Staff or Admin by default)*',
            value: [
              '`/order create/update/list` — Manage customer orders',
              '`/plan create/delete/list/sales/config` — Hosting plans & sales panel',
              '`/review config/list` — Configure & view reviews',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎟️ Ticket Commands *(Public — inside ticket channels)*',
            value: [
              '`/ticket close [reason]` — Close this ticket',
              '`/ticket claim` — Claim / unclaim a ticket (staff)',
              '`/ticket add-user/remove-user @user` — Manage ticket members',
              '`/ticket rename name` — Rename the ticket channel',
              '`/ticket info` — View ticket details',
              '`/ticket reopen` — Reopen a closed ticket',
              '`/ticket transcript` — Generate a transcript',
              '`/ticket search/stats/blacklist` — Staff management tools',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🌐 Public Commands *(Everyone)*',
            value: [
              '`/review submit` — Submit a review/vouch',
              '`/bingo` — Interactive bingo (bot or player challenge)',
              '`/afk set/remove/status` — AFK status with auto-reply on mention',
              '`/serverinfo` — Server statistics',
              '`/ping` — Bot latency check',
              '`/help` — This menu',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🔐 Command Lock System',
            value: 'Admins can override any command\'s access level:\n`/command-lock set post public` — make it public\n`/command-lock set ticket staff` — staff-only\n`/command-lock set order role @Sales` — specific role\n`/command-lock list` — see all current settings',
            inline: false,
          },
          {
            name: '⚡ Quick Start',
            value: '1. `/admin staffrole add @Support` — set your staff\n2. `/setup-ticket` — create your support panel\n3. `/plan create` — add your hosting plans\n4. `/plan sales` — post the sales panel',
            inline: false,
          },
        ],
        footer: 'Mr. Manager • Use /command-lock to customize access levels',
        timestamp: false,
      })],
      flags: 64,
    });
  },
};
