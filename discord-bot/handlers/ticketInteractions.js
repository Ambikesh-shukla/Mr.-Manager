import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { TicketPanel } from '../storage/TicketPanel.js';
import { Ticket } from '../storage/Ticket.js';
import { Cooldown } from '../storage/Cooldown.js';
import { GuildConfig } from '../storage/GuildConfig.js';
import { embed, successEmbed, errorEmbed, Colors } from '../utils/embeds.js';
import { isAdmin, isStaff, canCloseTicket, canClaimTicket } from '../utils/permissions.js';
import { generateTranscript } from '../utils/transcript.js';
import { logger } from '../utils/logger.js';

// ─── build ticket control panel ────────────────────────────────────────────
function buildControlPanel(ticket, panel) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel(ticket.claimedBy ? 'Unclaim' : 'Claim').setEmoji('🎯').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:transcript:${ticket.id}`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:priority:${ticket.id}`).setLabel('Priority').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:add:${ticket.id}`).setLabel('Add User').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket:remove:${ticket.id}`).setLabel('Remove User').setEmoji('➖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:rename:${ticket.id}`).setLabel('Rename').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

function buildReopenRow(ticket) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:reopen:${ticket.id}`).setLabel('Reopen Ticket').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel('Delete Ticket').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

// ─── safe reply helper (works before or after defer) ─────────────────────────
async function safeReply(interaction, payload) {
  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

// ─── open ticket ────────────────────────────────────────────────────────────
export async function openTicket(interaction, panelId, ticketTypeId) {
  const panel = TicketPanel.get(panelId);
  if (!panel) return safeReply(interaction, { embeds: [errorEmbed('Panel not found.')], flags: 64 });

  const guild = interaction.guild;
  const member = interaction.member;

  // Blacklist check
  if (panel.blacklistEnabled && panel.blacklistedUsers?.includes(member.id)) {
    return safeReply(interaction, { embeds: [errorEmbed('You are blacklisted from opening tickets.')], flags: 64 });
  }

  // Max per user
  const openTickets = Ticket.openForUser(guild.id, member.id);
  if (panel.maxPerUser > 0 && openTickets.length >= panel.maxPerUser) {
    const links = openTickets.slice(0, 3).map(t => `<#${t.channelId}>`).join(', ');
    return safeReply(interaction, { embeds: [errorEmbed(`You already have ${openTickets.length} open ticket(s): ${links}`)], flags: 64 });
  }

  // Cooldown check
  const cooldown = Cooldown.get(guild.id, member.id, panelId);
  if (cooldown) {
    return safeReply(interaction, {
      embeds: [errorEmbed(`You're on cooldown. You can open a new ticket in **${Cooldown.remaining(cooldown)}**.`)], flags: 64
    });
  }

  // Max global for panel
  if (panel.maxGlobal > 0) {
    const panelOpen = Ticket.openForPanel(panelId);
    if (panelOpen.length >= panel.maxGlobal) {
      return safeReply(interaction, { embeds: [errorEmbed('Maximum ticket limit reached for this panel. Please try again later.')], flags: 64 });
    }
  }

  // Resolve ticket type
  const ticketType = panel.ticketTypes?.find(t => t.id === ticketTypeId) ?? null;

  // CRITICAL: showModal must be the FIRST response — check before any defer/reply
  if (panel.modalEnabled && ticketType?.questions?.length > 0 && !interaction.deferred && !interaction.replied) {
    const modal = new ModalBuilder()
      .setCustomId(`ticketmodal:${panelId}:${ticketTypeId ?? 'default'}`)
      .setTitle(ticketType.label ?? 'Open a Ticket');
    const rows = ticketType.questions.slice(0, 5).map(q =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required ?? true)
          .setPlaceholder(q.placeholder ?? '')
      )
    );
    modal.addComponents(...rows);
    return interaction.showModal(modal);
  }

  // Only defer once — skip if already deferred (e.g. called after deferUpdate)
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 64 });
  }

  await createTicketChannel(interaction, panel, ticketType, {});
}

export async function handleTicketModal(interaction) {
  const [, panelId, ticketTypeId] = interaction.customId.split(':');
  const panel = TicketPanel.get(panelId);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('Panel not found.')], flags: 64 });

  const ticketType = panel.ticketTypes?.find(t => t.id === ticketTypeId) ?? null;
  const answers = {};
  if (ticketType?.questions) {
    for (const q of ticketType.questions) {
      answers[q.label] = interaction.fields.getTextInputValue(q.id) || '';
    }
  } else {
    // Default modal — capture the 'summary' field if present
    try {
      const summary = interaction.fields.getTextInputValue('summary');
      if (summary) answers['Issue Summary'] = summary;
    } catch {}
  }

  await interaction.deferReply({ flags: 64 });
  await createTicketChannel(interaction, panel, ticketType, answers);
}

async function createTicketChannel(interaction, panel, ticketType, modalAnswers) {
  const guild = interaction.guild;
  const member = interaction.member;

  try {
    const ticketNumber = Ticket.nextNumber(guild.id);
    const name = (panel.namingFormat ?? 'ticket-{username}')
      .replace('{username}', member.user.username.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .replace('{number}', ticketNumber)
      .replace('{type}', (ticketType?.label ?? 'ticket').toLowerCase().replace(/\s+/g, '-'))
      .slice(0, 100);

    const supportCategory = ticketType?.category ?? panel.supportCategory ?? null;

    // Build permission overwrites
    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];

    const supportRoles = [...(panel.allowedRoles ?? []), ...(ticketType?.supportRoles ?? [])];
    for (const roleId of supportRoles) {
      try {
        overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      } catch {}
    }

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: supportCategory,
      permissionOverwrites: overwrites,
      topic: `Ticket by ${member.user.tag} | Type: ${ticketType?.label ?? 'General'} | #${ticketNumber}`,
    });

    const ticket = Ticket.create({
      guildId: guild.id,
      panelId: panel.id,
      channelId: channel.id,
      userId: member.id,
      username: member.user.tag,
      ticketType: ticketType?.id ?? 'general',
      ticketNumber,
      modalAnswers,
    });

    // Build opening embed
    const fields = [];
    if (Object.keys(modalAnswers).length > 0) {
      for (const [label, val] of Object.entries(modalAnswers)) {
        fields.push({ name: label, value: val || 'Not provided', inline: false });
      }
    }
    fields.push({ name: '🎫 Ticket Type', value: ticketType?.label ?? 'General Support', inline: true });
    fields.push({ name: '📋 Ticket #', value: `#${ticketNumber}`, inline: true });
    fields.push({ name: '🏷️ Priority', value: 'Normal', inline: true });

    const openEmbed = embed({
      title: `${panel.emoji ?? '🎫'} ${ticketType?.label ?? 'Support Ticket'} #${ticketNumber}`,
      description: panel.openMessage,
      color: panel.color ? parseInt(panel.color.replace('#', ''), 16) : Colors.primary,
      fields,
      footer: `Opened by ${member.user.tag}`,
    });

    const controlRows = buildControlPanel(ticket, panel);
    await channel.send({ content: `${member} ${(panel.pingRoles ?? []).map(r => `<@&${r}>`).join(' ')}`, embeds: [openEmbed], components: controlRows });

    // Log
    if (panel.logChannel) {
      try {
        const logCh = await guild.channels.fetch(panel.logChannel);
        if (logCh) {
          await logCh.send({
            embeds: [embed({
              title: '🎫 Ticket Created',
              color: Colors.success,
              fields: [
                { name: 'User', value: `${member} (${member.user.tag})`, inline: true },
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Type', value: ticketType?.label ?? 'General', inline: true },
                { name: 'Ticket #', value: `#${ticketNumber}`, inline: true },
              ],
            })]
          });
        }
      } catch {}
    }

    // Inactivity auto-close
    if (panel.inactivityClose > 0) {
      scheduleInactivityClose(channel, ticket, panel);
    }

    await interaction.editReply({ embeds: [successEmbed('Ticket Created', `Your ticket has been created: <#${channel.id}>`)] });
  } catch (err) {
    logger.error('Failed to create ticket channel', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to create ticket. Please contact an admin.')] });
  }
}

const inactivityTimers = new Map();
function scheduleInactivityClose(channel, ticket, panel) {
  clearTimeout(inactivityTimers.get(ticket.id));
  const ms = panel.inactivityClose * 60 * 60 * 1000;
  const timer = setTimeout(async () => {
    const fresh = Ticket.getByChannel(channel.id);
    if (!fresh || fresh.status !== 'open') return;
    const elapsed = Date.now() - fresh.lastActivity;
    if (elapsed >= ms) {
      try {
        await channel.send({ embeds: [embed({ title: '⏰ Auto-Closed', description: `This ticket was auto-closed due to ${panel.inactivityClose}h of inactivity.`, color: Colors.warning })] });
        await doCloseTicket(channel, fresh, panel, null, 'Inactivity auto-close');
      } catch {}
    }
  }, ms);
  inactivityTimers.set(ticket.id, timer);
}

// ─── close ticket ───────────────────────────────────────────────────────────
export async function handleCloseTicket(interaction, ticketId) {
  const ticket = Ticket.get(ticketId);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket not found.')], flags: 64 });

  const panel = TicketPanel.get(ticket.panelId);
  if (!canCloseTicket(interaction.member, ticket, panel)) {
    return interaction.reply({ embeds: [errorEmbed('You do not have permission to close this ticket.')], flags: 64 });
  }

  // Show close reason modal
  const modal = new ModalBuilder()
    .setCustomId(`ticketclose:${ticketId}`)
    .setTitle('Close Ticket');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for closing (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('Issue resolved, etc.')
    )
  );
  await interaction.showModal(modal);
}

export async function handleCloseModal(interaction) {
  const ticketId = interaction.customId.split(':')[1];
  const ticket = Ticket.get(ticketId);
  const reason = interaction.fields.getTextInputValue('reason') || 'No reason provided';
  await interaction.deferReply({ flags: 64 });

  try {
    const channel = interaction.channel;
    const panel = TicketPanel.get(ticket.panelId);
    await doCloseTicket(channel, ticket, panel, interaction.member, reason);
    await interaction.editReply({ embeds: [successEmbed('Ticket Closed', `This ticket has been closed.`)] });
  } catch (err) {
    logger.error('Close ticket error', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to close ticket.')] });
  }
}

async function doCloseTicket(channel, ticket, panel, closedByMember, reason) {
  const guild = channel.guild;
  const updated = Ticket.update(ticket.id, {
    status: 'closed',
    closeTime: Date.now(),
    closeReason: reason,
    closedBy: closedByMember?.user.tag ?? 'System',
  });

  // Remove open access for ticket creator
  try {
    await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false });
  } catch {}

  // Generate transcript
  let transcriptAttachment = null;
  if (panel?.transcriptEnabled !== false) {
    try { transcriptAttachment = await generateTranscript(channel, updated); } catch {}
  }

  const closeEmbed = embed({
    title: '🔒 Ticket Closed',
    description: panel?.closeMessage ?? 'This ticket has been closed.',
    color: Colors.error,
    fields: [
      { name: 'Closed by', value: closedByMember?.toString() ?? 'System', inline: true },
      { name: 'Reason', value: reason, inline: true },
      { name: 'Ticket #', value: `#${ticket.ticketNumber}`, inline: true },
    ],
  });

  const reopenRow = panel?.reopenEnabled !== false ? buildReopenRow(updated) : null;
  const msgPayload = { embeds: [closeEmbed] };
  if (reopenRow) msgPayload.components = [reopenRow];
  await channel.send(msgPayload);

  // Send transcript to log channel
  if (transcriptAttachment && panel?.transcriptChannel) {
    try {
      const tCh = await guild.channels.fetch(panel.transcriptChannel);
      if (tCh) {
        await tCh.send({
          embeds: [embed({
            title: '📄 Ticket Transcript',
            color: Colors.info,
            fields: [
              { name: 'Ticket', value: `#${ticket.ticketNumber} — ${ticket.ticketType}`, inline: true },
              { name: 'User', value: `<@${ticket.userId}>`, inline: true },
              { name: 'Claimed by', value: ticket.claimedBy ?? 'Nobody', inline: true },
              { name: 'Reason', value: reason, inline: false },
            ],
          })],
          files: [transcriptAttachment],
        });
      }
    } catch {}
  }

  // Log channel
  if (panel?.logChannel) {
    try {
      const lCh = await guild.channels.fetch(panel.logChannel);
      if (lCh) {
        await lCh.send({
          embeds: [embed({
            title: '🔒 Ticket Closed',
            color: Colors.warning,
            fields: [
              { name: 'Ticket', value: `#${ticket.ticketNumber}`, inline: true },
              { name: 'User', value: `<@${ticket.userId}>`, inline: true },
              { name: 'Closed by', value: closedByMember?.toString() ?? 'System', inline: true },
              { name: 'Reason', value: reason, inline: false },
            ],
          })]
        });
      }
    } catch {}
  }

  // Set cooldown
  if (panel?.cooldownHours > 0) {
    Cooldown.set(guild.id, ticket.userId, ticket.panelId, panel.cooldownHours);
  }

  // DM ticket creator
  try {
    const creator = await guild.members.fetch(ticket.userId);
    await creator.send({
      embeds: [embed({
        title: `🔒 Ticket #${ticket.ticketNumber} Closed`,
        description: `Your ticket in **${guild.name}** has been closed.\n**Reason:** ${reason}`,
        color: Colors.warning,
        timestamp: false,
      })]
    });
  } catch {}
}

// ─── reopen ticket ──────────────────────────────────────────────────────────
export async function handleReopenTicket(interaction, ticketId) {
  const ticket = Ticket.get(ticketId);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket not found.')], flags: 64 });
  const panel = TicketPanel.get(ticket.panelId);

  if (!canClaimTicket(interaction.member, panel)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can reopen tickets.')], flags: 64 });
  }

  if (ticket.status !== 'closed') {
    return interaction.reply({ embeds: [errorEmbed('This ticket is not closed.')], flags: 64 });
  }

  // Check reopen window
  if (panel?.reopenWindow > 0 && ticket.closeTime) {
    const msSinceClosed = Date.now() - ticket.closeTime;
    const windowMs = panel.reopenWindow * 3600000;
    if (msSinceClosed > windowMs) {
      return interaction.reply({ embeds: [errorEmbed(`This ticket can no longer be reopened (window: ${panel.reopenWindow}h).`)], flags: 64 });
    }
  }

  await interaction.deferUpdate();
  Ticket.update(ticketId, { status: 'open', closeTime: null, closedBy: null });

  // Restore access
  try {
    await interaction.channel.permissionOverwrites.edit(ticket.userId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    });
  } catch {}

  await interaction.channel.send({
    embeds: [embed({
      title: '🔓 Ticket Reopened',
      description: `This ticket has been reopened by ${interaction.member}.`,
      color: Colors.success,
    })],
    components: buildControlPanel(Ticket.get(ticketId), panel),
  });
}

// ─── claim / unclaim ────────────────────────────────────────────────────────
export async function handleClaimTicket(interaction, ticketId) {
  const ticket = Ticket.get(ticketId);
  if (!ticket) return interaction.reply({ embeds: [errorEmbed('Ticket not found.')], flags: 64 });
  const panel = TicketPanel.get(ticket.panelId);

  if (!canClaimTicket(interaction.member, panel)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can claim tickets.')], flags: 64 });
  }

  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.tag) {
    return interaction.reply({ embeds: [errorEmbed(`This ticket is already claimed by **${ticket.claimedBy}**.`)], flags: 64 });
  }

  await interaction.deferUpdate();
  const unclaiming = ticket.claimedBy === interaction.user.tag;
  Ticket.update(ticketId, { claimedBy: unclaiming ? null : interaction.user.tag });

  await interaction.channel.send({
    embeds: [embed({
      title: unclaiming ? '🎯 Ticket Unclaimed' : '🎯 Ticket Claimed',
      description: unclaiming
        ? `${interaction.member} has unclaimed this ticket.`
        : `${interaction.member} has claimed this ticket and will assist you.`,
      color: unclaiming ? Colors.warning : Colors.success,
    })]
  });
}

// ─── add / remove user ─────────────────────────────────────────────────────
export async function handleAddUser(interaction, ticketId) {
  const panel = TicketPanel.get(Ticket.get(ticketId)?.panelId);
  if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can add users.')], flags: 64 });
  }
  const modal = new ModalBuilder().setCustomId(`ticketadduser:${ticketId}`).setTitle('Add User to Ticket');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('userid').setLabel('User ID or @mention').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('123456789012345678')
  ));
  await interaction.showModal(modal);
}

export async function handleAddUserModal(interaction) {
  const ticketId = interaction.customId.split(':')[1];
  const ticket = Ticket.get(ticketId);
  const raw = interaction.fields.getTextInputValue('userid').replace(/[<@!>]/g, '').trim();

  await interaction.deferReply({ flags: 64 });
  try {
    const member = await interaction.guild.members.fetch(raw);
    if (!member) return interaction.editReply({ embeds: [errorEmbed('User not found.')] });

    await interaction.channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    });
    const addedUsers = [...(ticket.addedUsers ?? [])];
    if (!addedUsers.includes(member.id)) addedUsers.push(member.id);
    Ticket.update(ticketId, { addedUsers });
    await interaction.editReply({ embeds: [successEmbed('User Added', `${member} has been added to this ticket.`)] });
    await interaction.channel.send({ embeds: [embed({ description: `➕ ${member} was added by ${interaction.member}.`, color: Colors.success, timestamp: false })] });
  } catch {
    await interaction.editReply({ embeds: [errorEmbed('Could not find or add that user.')] });
  }
}

export async function handleRemoveUser(interaction, ticketId) {
  const panel = TicketPanel.get(Ticket.get(ticketId)?.panelId);
  if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can remove users.')], flags: 64 });
  }
  const modal = new ModalBuilder().setCustomId(`ticketremoveuser:${ticketId}`).setTitle('Remove User from Ticket');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('userid').setLabel('User ID or @mention').setStyle(TextInputStyle.Short).setRequired(true)
  ));
  await interaction.showModal(modal);
}

export async function handleRemoveUserModal(interaction) {
  const ticketId = interaction.customId.split(':')[1];
  const ticket = Ticket.get(ticketId);
  const raw = interaction.fields.getTextInputValue('userid').replace(/[<@!>]/g, '').trim();

  await interaction.deferReply({ flags: 64 });
  try {
    const member = await interaction.guild.members.fetch(raw);
    if (member.id === ticket.userId) return interaction.editReply({ embeds: [errorEmbed('Cannot remove the ticket creator.')] });
    await interaction.channel.permissionOverwrites.delete(member.id);
    const addedUsers = (ticket.addedUsers ?? []).filter(id => id !== member.id);
    Ticket.update(ticketId, { addedUsers });
    await interaction.editReply({ embeds: [successEmbed('User Removed', `${member} removed from this ticket.`)] });
    await interaction.channel.send({ embeds: [embed({ description: `➖ ${member} was removed by ${interaction.member}.`, color: Colors.warning, timestamp: false })] });
  } catch {
    await interaction.editReply({ embeds: [errorEmbed('Could not find or remove that user.')] });
  }
}

// ─── rename ─────────────────────────────────────────────────────────────────
export async function handleRenameTicket(interaction, ticketId) {
  const panel = TicketPanel.get(Ticket.get(ticketId)?.panelId);
  if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can rename tickets.')], flags: 64 });
  }
  const modal = new ModalBuilder().setCustomId(`ticketrename:${ticketId}`).setTitle('Rename Ticket');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('name').setLabel('New channel name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('ticket-username')
  ));
  await interaction.showModal(modal);
}

export async function handleRenameModal(interaction) {
  const ticketId = interaction.customId.split(':')[1];
  const rawName = interaction.fields.getTextInputValue('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100);
  await interaction.deferReply({ flags: 64 });
  try {
    await interaction.channel.setName(rawName);
    await interaction.editReply({ embeds: [successEmbed('Renamed', `Channel renamed to **${rawName}**.`)] });
  } catch {
    await interaction.editReply({ embeds: [errorEmbed('Failed to rename the channel.')] });
  }
}

// ─── delete ticket ──────────────────────────────────────────────────────────
export async function handleDeleteTicket(interaction, ticketId) {
  const ticket = Ticket.get(ticketId);
  const panel = TicketPanel.get(ticket?.panelId);
  if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can delete tickets.')], flags: 64 });
  }
  await interaction.reply({ embeds: [embed({ description: '🗑️ Deleting ticket in 5 seconds...', color: Colors.error, timestamp: false })] });
  setTimeout(async () => {
    try {
      Ticket.delete(ticketId);
      await interaction.channel.delete('Ticket deleted');
    } catch {}
  }, 5000);
}

// ─── transcript on demand ───────────────────────────────────────────────────
export async function handleTranscriptButton(interaction, ticketId) {
  await interaction.deferReply({ flags: 64 });
  const ticket = Ticket.get(ticketId);
  if (!ticket) return interaction.editReply({ embeds: [errorEmbed('Ticket not found.')] });
  try {
    const file = await generateTranscript(interaction.channel, ticket);
    if (!file) return interaction.editReply({ embeds: [errorEmbed('Failed to generate transcript.')] });
    await interaction.editReply({ embeds: [successEmbed('Transcript Generated', 'Transcript attached below.')], files: [file] });
  } catch (e) {
    logger.error('Transcript error', e);
    await interaction.editReply({ embeds: [errorEmbed('Error generating transcript.')] });
  }
}

// ─── priority ───────────────────────────────────────────────────────────────
export async function handlePrioritySelect(interaction, ticketId) {
  const panel = TicketPanel.get(Ticket.get(ticketId)?.panelId);
  if (!isStaff(interaction.member, panel) && !isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('Only staff can set priority.')], flags: 64 });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`ticketpriority_set:${ticketId}`)
    .setPlaceholder('Select priority')
    .addOptions([
      { label: '🟢 Low', value: 'low' },
      { label: '🟡 Normal', value: 'normal' },
      { label: '🔴 High', value: 'high' },
      { label: '🚨 Critical', value: 'critical' },
    ]);
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
}

export async function handlePrioritySet(interaction, ticketId) {
  const priority = interaction.values[0];
  Ticket.update(ticketId, { priority });
  await interaction.update({ content: `🏷️ Priority set to **${priority}**.`, components: [] });
  await interaction.channel.send({
    embeds: [embed({ description: `🏷️ Ticket priority changed to **${priority}** by ${interaction.member}.`, color: Colors.info, timestamp: false })]
  });
}

// ─── panel button handler ───────────────────────────────────────────────────
export async function handlePanelButton(interaction, panelId, typeId = null) {
  const panel = TicketPanel.get(panelId);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('This panel no longer exists.')], flags: 64 });

  // Multi-type button panels embed the typeId directly in the customId
  if (typeId) {
    return openTicket(interaction, panelId, typeId);
  }

  // Default modal (no types configured, modal enabled)
  if (panel.modalEnabled && (!panel.ticketTypes || panel.ticketTypes.length === 0)) {
    const modal = new ModalBuilder()
      .setCustomId(`ticketmodal:${panelId}:default`)
      .setTitle(panel.title ?? 'Open a Ticket');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('summary').setLabel('Briefly describe your issue').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Please describe why you are opening this ticket...')
      )
    );
    return interaction.showModal(modal);
  }

  await openTicket(interaction, panelId, null);
}

export async function handlePanelSelect(interaction, panelId) {
  const ticketTypeId = interaction.values[0];
  const panel = TicketPanel.get(panelId);
  if (!panel) return interaction.reply({ embeds: [errorEmbed('Panel not found.')], flags: 64 });

  const ticketType = panel.ticketTypes?.find(t => t.id === ticketTypeId);
  if (ticketType && panel.modalEnabled && ticketType.questions?.length > 0) {
    const modal = new ModalBuilder()
      .setCustomId(`ticketmodal:${panelId}:${ticketTypeId}`)
      .setTitle(ticketType.label ?? 'Open a Ticket');
    const rows = ticketType.questions.slice(0, 5).map(q =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required ?? true)
          .setPlaceholder(q.placeholder ?? '')
      )
    );
    modal.addComponents(...rows);
    return interaction.showModal(modal);
  }

  // Let openTicket handle its own defer — do NOT defer here
  await openTicket(interaction, panelId, ticketTypeId);
}
