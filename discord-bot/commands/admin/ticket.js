import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Ticket } from '../../storage/Ticket.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { embed, Colors, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff, isAdmin, canCloseTicket, canManageTicket } from '../../utils/permissions.js';
import { generateTranscript } from '../../utils/transcript.js';
import { Cooldown } from '../../storage/Cooldown.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management commands')
    .addSubcommand(sc => sc
      .setName('close')
      .setDescription('Close this ticket channel')
      .addStringOption(o => o.setName('reason').setDescription('Reason for closing').setRequired(false))
    )
    .addSubcommand(sc => sc.setName('claim').setDescription('Claim or unclaim this ticket'))
    .addSubcommand(sc => sc
      .setName('add-user')
      .setDescription('Add a user to this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('remove-user')
      .setDescription('Remove a user from this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('rename')
      .setDescription('Rename this ticket channel')
      .addStringOption(o => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90))
    )
    .addSubcommand(sc => sc.setName('info').setDescription('View details about this ticket'))
    .addSubcommand(sc => sc.setName('reopen').setDescription('Reopen this closed ticket'))
    .addSubcommand(sc => sc.setName('transcript').setDescription('Generate a transcript for this ticket'))
    .addSubcommand(sc => sc
      .setName('search')
      .setDescription('Search tickets across the server')
      .addUserOption(o => o.setName('user').setDescription('Filter by user').setRequired(false))
      .addStringOption(o => o.setName('status').setDescription('Filter by status').addChoices({ name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' }).setRequired(false))
      .addStringOption(o => o.setName('type').setDescription('Filter by ticket type').setRequired(false))
    )
    .addSubcommand(sc => sc.setName('stats').setDescription('View ticket statistics for this server'))
    .addSubcommand(sc => sc
      .setName('blacklist')
      .setDescription('Add or remove a user from the ticket blacklist')
      .addStringOption(o => o.setName('action').setDescription('add or remove').addChoices({ name: 'Add to blacklist', value: 'add' }, { name: 'Remove from blacklist', value: 'remove' }).setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID (leave blank to apply to all panels)').setRequired(false))
    ),

  defaultLevel: 'public',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── close ─────────────────────────────────────────────────────────────────
    if (sub === 'close') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!canCloseTicket(interaction.member, ticket, panel)) {
        return interaction.reply({ embeds: [errorEmbed('You do not have permission to close this ticket.')], flags: 64 });
      }
      if (ticket.status === 'closed') return interaction.reply({ embeds: [errorEmbed('Ticket is already closed.')], flags: 64 });

      const reason = interaction.options.getString('reason') || 'Closed via command';
      await interaction.deferReply({ flags: 64 });
      try {
        const updated = Ticket.update(ticket.id, { status: 'closed', closeTime: Date.now(), closeReason: reason, closedBy: interaction.user.tag });
        try { await interaction.channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }); } catch {}

        if (panel?.cooldownHours > 0) Cooldown.set(interaction.guild.id, ticket.userId, ticket.panelId, panel.cooldownHours);

        let transcript = null;
        if (panel?.transcriptEnabled !== false) {
          try { transcript = await generateTranscript(interaction.channel, updated); } catch {}
        }

        const closeEmbed = embed({
          title: '🔒 Ticket Closed',
          color: Colors.error,
          fields: [
            { name: 'Closed By', value: `${interaction.member}`, inline: true },
            { name: 'Reason', value: reason, inline: true },
          ],
          timestamp: false,
        });
        const files = transcript ? [transcript] : [];
        await interaction.channel.send({ embeds: [closeEmbed], files });

        if (panel?.logChannel) {
          try {
            const logCh = await interaction.guild.channels.fetch(panel.logChannel);
            if (logCh) await logCh.send({ embeds: [embed({ title: '🔒 Ticket Closed', color: Colors.error, fields: [{ name: 'Channel', value: interaction.channel.name, inline: true }, { name: 'User', value: `<@${ticket.userId}>`, inline: true }, { name: 'Reason', value: reason, inline: true }] })], files: transcript ? [transcript] : [] });
          } catch {}
        }

        if (panel?.reopenEnabled) {
          const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
          await interaction.channel.send({
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`ticket:reopen:${ticket.id}`).setLabel('Reopen Ticket').setEmoji('🔓').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel('Delete Ticket').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
            )],
          });
        }

        await interaction.editReply({ embeds: [successEmbed('Ticket Closed', 'This ticket has been closed.')] });
      } catch (err) {
        logger.error('Close ticket error', err);
        await interaction.editReply({ embeds: [errorEmbed('Failed to close ticket.')] });
      }
      return;
    }

    // ── claim ─────────────────────────────────────────────────────────────────
    if (sub === 'claim') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Only staff can claim tickets.')], flags: 64 });
      }
      const unclaiming = ticket.claimedBy === interaction.user.tag;
      Ticket.update(ticket.id, { claimedBy: unclaiming ? null : interaction.user.tag });
      await interaction.reply({ embeds: [embed({ description: unclaiming ? `🎯 Ticket unclaimed by ${interaction.member}.` : `🎯 Ticket claimed by ${interaction.member}.`, color: Colors.info, timestamp: false })], flags: 64 });
      return;
    }

    // ── add-user ──────────────────────────────────────────────────────────────
    if (sub === 'add-user') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Only staff can add users.')], flags: 64 });
      }
      const user = interaction.options.getUser('user');
      await interaction.deferReply({ flags: 64 });
      try {
        const member = await interaction.guild.members.fetch(user.id);
        await interaction.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        Ticket.update(ticket.id, { addedUsers: [...(ticket.addedUsers ?? []), user.id] });
        await interaction.channel.send({ embeds: [embed({ description: `➕ ${member} was added to this ticket by ${interaction.member}.`, color: Colors.success, timestamp: false })] });
        await interaction.editReply({ embeds: [successEmbed('User Added', `${user.tag} now has access.`)] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to add user. Are they in this server?')] });
      }
      return;
    }

    // ── remove-user ───────────────────────────────────────────────────────────
    if (sub === 'remove-user') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Only staff can remove users.')], flags: 64 });
      }
      const user = interaction.options.getUser('user');
      await interaction.deferReply({ flags: 64 });
      try {
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
        Ticket.update(ticket.id, { addedUsers: (ticket.addedUsers ?? []).filter(id => id !== user.id) });
        await interaction.channel.send({ embeds: [embed({ description: `➖ ${user.tag} was removed from this ticket by ${interaction.member}.`, color: Colors.warning, timestamp: false })] });
        await interaction.editReply({ embeds: [successEmbed('User Removed', `${user.tag} lost access.`)] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to remove user.')] });
      }
      return;
    }

    // ── rename ────────────────────────────────────────────────────────────────
    if (sub === 'rename') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!canManageTicket(interaction.member, ticket, panel)) {
        return interaction.reply({ embeds: [errorEmbed('You do not have permission to rename this ticket.')], flags: 64 });
      }
      const name = interaction.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
      await interaction.deferReply({ flags: 64 });
      try {
        await interaction.channel.setName(name);
        await interaction.editReply({ embeds: [successEmbed('Renamed', `Channel renamed to **${name}**.`)] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to rename. Check bot permissions.')] });
      }
      return;
    }

    // ── info ──────────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      const e = embed({
        title: `🎫 Ticket #${ticket.ticketNumber} Info`,
        color: Colors.info,
        fields: [
          { name: 'Status', value: ticket.status === 'open' ? '🟢 Open' : '🔴 Closed', inline: true },
          { name: 'Owner', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Type', value: ticket.ticketType ?? 'General', inline: true },
          { name: 'Panel', value: panel?.title ?? `\`${ticket.panelId}\``, inline: true },
          { name: 'Claimed By', value: ticket.claimedBy ?? 'Unclaimed', inline: true },
          { name: 'Priority', value: ticket.priority ?? 'Normal', inline: true },
          { name: 'Opened', value: `<t:${Math.floor(ticket.openTime / 1000)}:R>`, inline: true },
          { name: 'Close Reason', value: ticket.closeReason ?? 'N/A', inline: true },
        ],
        footer: `ID: ${ticket.id}`,
      });
      return interaction.reply({ embeds: [e], flags: 64 });
    }

    // ── reopen ────────────────────────────────────────────────────────────────
    if (sub === 'reopen') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      if (ticket.status !== 'closed') return interaction.reply({ embeds: [errorEmbed('This ticket is already open.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!panel?.reopenEnabled) return interaction.reply({ embeds: [errorEmbed('Reopening is disabled for this panel.')], flags: 64 });
      if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Only staff can reopen tickets.')], flags: 64 });
      }
      await interaction.deferReply({ flags: 64 });
      try {
        Ticket.update(ticket.id, { status: 'open', reopenTime: Date.now() });
        await interaction.channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await interaction.channel.send({ embeds: [embed({ description: `🔓 Ticket reopened by ${interaction.member}.`, color: Colors.success, timestamp: false })] });
        await interaction.editReply({ embeds: [successEmbed('Ticket Reopened', 'The ticket is now open again.')] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to reopen ticket.')] });
      }
      return;
    }

    // ── transcript ────────────────────────────────────────────────────────────
    if (sub === 'transcript') {
      const ticket = Ticket.getByChannel(interaction.channelId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('This is not a ticket channel.')], flags: 64 });
      const panel = TicketPanel.get(ticket.panelId);
      if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Only staff can generate transcripts.')], flags: 64 });
      }
      await interaction.deferReply({ flags: 64 });
      try {
        const attachment = await generateTranscript(interaction.channel, ticket);
        await interaction.editReply({ embeds: [successEmbed('Transcript Generated', 'Here is the ticket transcript:')], files: [attachment] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to generate transcript.')] });
      }
      return;
    }

    // ── search ────────────────────────────────────────────────────────────────
    if (sub === 'search') {
      if (!isStaff(interaction.member) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Staff only.')], flags: 64 });
      }
      const user = interaction.options.getUser('user');
      const status = interaction.options.getString('status');
      const type = interaction.options.getString('type');

      let tickets = Ticket.forGuild(interaction.guild.id);
      if (user) tickets = tickets.filter(t => t.userId === user.id);
      if (status) tickets = tickets.filter(t => t.status === status);
      if (type) tickets = tickets.filter(t => t.ticketType?.toLowerCase().includes(type.toLowerCase()));
      tickets = tickets.slice(0, 15);

      if (tickets.length === 0) {
        return interaction.reply({ embeds: [embed({ description: 'No tickets found.', color: Colors.warning })], flags: 64 });
      }

      await interaction.reply({
        embeds: [embed({
          title: `🔍 Ticket Search (${tickets.length})`,
          color: Colors.info,
          fields: tickets.map(t => ({
            name: `#${t.ticketNumber} — ${t.ticketType ?? 'General'} [${t.status.toUpperCase()}]`,
            value: `User: <@${t.userId}> | ${t.channelId ? `<#${t.channelId}>` : 'Deleted'} | Claimed: ${t.claimedBy ?? 'No'}\nOpened: <t:${Math.floor(t.openTime / 1000)}:R>`,
            inline: false,
          })),
        })],
        flags: 64,
      });
      return;
    }

    // ── stats ─────────────────────────────────────────────────────────────────
    if (sub === 'stats') {
      if (!isStaff(interaction.member) && !isAdmin(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Staff only.')], flags: 64 });
      }
      const all = Ticket.forGuild(interaction.guild.id);
      const open = all.filter(t => t.status === 'open').length;
      const closed = all.filter(t => t.status === 'closed').length;
      const today = all.filter(t => Date.now() - t.openTime < 86400000).length;
      const panels = TicketPanel.forGuild(interaction.guild.id);
      await interaction.reply({
        embeds: [embed({
          title: '📊 Ticket Statistics',
          color: Colors.info,
          fields: [
            { name: '📂 Total Tickets', value: String(all.length), inline: true },
            { name: '🟢 Open', value: String(open), inline: true },
            { name: '🔴 Closed', value: String(closed), inline: true },
            { name: '📅 Opened Today', value: String(today), inline: true },
            { name: '🎛️ Panels', value: String(panels.length), inline: true },
          ],
        })],
        flags: 64,
      });
      return;
    }

    // ── blacklist ─────────────────────────────────────────────────────────────
    if (sub === 'blacklist') {
      if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [errorEmbed('Administrator only.')], flags: 64 });
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('user');
      const panelId = interaction.options.getString('panel_id');

      const panels = panelId
        ? [TicketPanel.get(panelId)].filter(p => p?.guildId === interaction.guild.id)
        : TicketPanel.forGuild(interaction.guild.id);

      if (panels.length === 0) return interaction.reply({ embeds: [errorEmbed('No panels found.')], flags: 64 });

      for (const panel of panels) {
        let list = [...(panel.blacklistedUsers ?? [])];
        if (action === 'add') {
          if (!list.includes(user.id)) list.push(user.id);
          TicketPanel.update(panel.id, { blacklistedUsers: list, blacklistEnabled: true });
        } else {
          TicketPanel.update(panel.id, { blacklistedUsers: list.filter(id => id !== user.id) });
        }
      }

      const label = action === 'add' ? 'Blacklisted' : 'Removed from blacklist';
      await interaction.reply({
        embeds: [successEmbed(label, `${user.tag} has been ${action === 'add' ? 'blacklisted from' : 'removed from the blacklist of'} ${panels.length} panel(s).`)],
        flags: 64,
      });
    }
  },
};
