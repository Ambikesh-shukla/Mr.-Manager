import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { shouldHandleInteraction } from "../../utils/instanceRouter.js";
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import { checkPermission, COMMAND_DEFAULTS } from '../utils/permissions.js';
import {
  handlePanelButton, handlePanelSelect,
  openTicket, handleTicketModal, handleCloseModal,
  handleCloseTicket, handleClaimTicket, handleReopenTicket,
  handleAddUser, handleAddUserModal,
  handleRemoveUser, handleRemoveUserModal,
  handleRenameTicket, handleRenameModal,
  handleDeleteTicket, handleTranscriptButton,
  handlePrioritySelect, handlePrioritySet,
  handlePlanBuy,
} from '../handlers/ticketInteractions.js';
import {
  handleSetupMenu, handleSetupButton, handleSetupModal,
  handleSetupChanSelect, handleSetupRoleSelect,
  handleSetupTypeSelect, handleSetupRemoveSelect,
  handleSetupDashButton, handleWizardButton,
} from '../handlers/setupHandler.js';
import { Review } from '../storage/Review.js';
import { GuildConfig } from '../storage/GuildConfig.js';
import { Ticket } from '../storage/Ticket.js';
import { embed, Colors, successEmbed } from '../utils/embeds.js';
import { handleWelcomeInteraction } from '../handlers/welcomeHandler.js';
import { handleLinkInteraction } from '../handlers/linkHandler.js';
import { handleServerInteraction } from '../handlers/serverHandler.js';

export default {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client) {
    try {
      const canHandle = await shouldHandleInteraction(interaction);

      if (!canHandle) {
        return;
      }
      
      // ── Slash Commands ─────────────────────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) {
          return interaction.reply({ embeds: [errorEmbed(`Command \`/${interaction.commandName}\` not found.`)], flags: 64 });
        }

        // ── Centralized permission check ─────────────────────────────────────
        // Determine effective default level:
        //   1. Check subcommandDefaults for the specific subcommand
        //   2. Fall back to cmd.defaultLevel
        //   3. Fall back to COMMAND_DEFAULTS global table
        //   4. Fall back to 'admin' (safe default)
        let effectiveDefault = cmd.defaultLevel ?? COMMAND_DEFAULTS[cmd.data.name] ?? 'admin';

        if (cmd.subcommandDefaults) {
          const subName = interaction.options.getSubcommand?.(false) ?? null;
          if (subName && cmd.subcommandDefaults[subName] !== undefined) {
            effectiveDefault = cmd.subcommandDefaults[subName];
          }
        }

        const allowed = checkPermission(interaction, cmd.data.name, effectiveDefault);
        if (!allowed) {
          const { CommandLock } = await import('../storage/CommandLock.js');
          const lock = CommandLock.get(interaction.guild?.id, cmd.data.name);
          const mode = lock?.mode ?? effectiveDefault;
          let msg;
          if (mode === 'role' && lock?.roleId) {
            msg = `You need the <@&${lock.roleId}> role to use \`/${cmd.data.name}\`.`;
          } else if (mode === 'staff') {
            msg = `You need a **staff role** or **Administrator** to use \`/${cmd.data.name}\`.`;
          } else {
            msg = `You need **Administrator** permission to use \`/${cmd.data.name}\`.`;
          }
          return interaction.reply({ embeds: [errorEmbed(msg)], flags: 64 });
        }

        logger.info(`Command: /${interaction.commandName} by ${interaction.user.tag}`);
        await cmd.execute(interaction, client);
        return;
      }

      // ── Autocomplete ───────────────────────────────────────────────────────
      if (interaction.isAutocomplete()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd?.autocomplete) await cmd.autocomplete(interaction);
        return;
      }

      // ── Buttons ────────────────────────────────────────────────────────────
      if (interaction.isButton()) {
        const parts = interaction.customId.split(':');
        const ns = parts[0], action = parts[1], id = parts[2], extra = parts[3];

        logger.info(`Button: ${interaction.customId} by ${interaction.user.tag}`);

        if (ns === 'setup') {
          if (action === 'btn') return handleSetupButton(interaction, parts.slice(2).join(':'));
          if (action === 'dash') return handleSetupDashButton(interaction, parts.slice(2).join(':'));
          if (action === 'wizard') return handleWizardButton(interaction, parts.slice(2).join(':'));
          return interaction.deferUpdate();
        }

        if (ns === 'welcome') return handleWelcomeInteraction(interaction, parts);

        if (ns === 'link') return handleLinkInteraction(interaction, parts);
        if (ns === 'server') return handleServerInteraction(interaction, parts);
        if (ns === 'panel') return handlePanelButton(interaction, id, extra ?? null);
        if (ns === 'ticketopentype') return openTicket(interaction, action, id);

        if (ns === 'ticket') {
          if (action === 'close') return handleCloseTicket(interaction, id);
          if (action === 'claim') return handleClaimTicket(interaction, id);
          if (action === 'reopen') return handleReopenTicket(interaction, id);
          if (action === 'add') return handleAddUser(interaction, id);
          if (action === 'remove') return handleRemoveUser(interaction, id);
          if (action === 'rename') return handleRenameTicket(interaction, id);
          if (action === 'delete') return handleDeleteTicket(interaction, id);
          if (action === 'transcript') return handleTranscriptButton(interaction, id);
          if (action === 'priority') return handlePrioritySelect(interaction, id);

          // ── Ticket Control Panel dashboard buttons (admin-only) ──────────────
          if (action === 'stats') {
            const s = Ticket.stats(interaction.guild.id);
            return interaction.reply({
              embeds: [embed({
                title: '📊 Server Ticket Statistics',
                color: Colors.info,
                fields: [
                  { name: '🟢 Open', value: String(s.open), inline: true },
                  { name: '🔒 Closed', value: String(s.closed), inline: true },
                  { name: '📋 Total', value: String(s.total), inline: true },
                  { name: '📅 Today', value: String(s.today), inline: true },
                  { name: '📆 This Week', value: String(s.week), inline: true },
                ],
              })],
              flags: 64,
            });
          }
          if (action === 'search' || action === 'blacklist') {
            return interaction.reply({ embeds: [errorEmbed('This feature is not yet available.')], flags: 64 });
          }
        }

        if (ns === 'plan_buy') return handlePlanBuy(interaction, action);
        if (ns === 'noop') {
          if (action === 'previewselect' || action === 'preview') return interaction.deferUpdate();
          return interaction.reply({ content: '⚠️ No ticket panel set up yet. Ask an admin to run `/setup-ticket`.', flags: 64 });
        }

        if (ns === 'review') {
          if (action === 'approve') {
            const review = Review.get(id);
            if (!review) return interaction.reply({ embeds: [errorEmbed('Review not found.')], flags: 64 });
            await interaction.deferReply({ flags: 64 });
            Review.update(id, { approved: true });
            const config = GuildConfig.get(interaction.guild.id);
            if (config.vouchChannel) {
              try {
                const { reviewEmbed } = await import('../utils/embeds.js');
                const ch = await interaction.guild.channels.fetch(config.vouchChannel);
                if (ch) {
                  // Remove "Give Review" button from the previous review message
                  if (config.latestReviewMessageId && config.latestReviewChannelId) {
                    try {
                      const prevCh = await interaction.guild.channels.fetch(config.latestReviewChannelId);
                      if (prevCh) {
                        const prevMsg = await prevCh.messages.fetch(config.latestReviewMessageId);
                        if (prevMsg) await prevMsg.edit({ components: [] });
                      }
                    } catch { /* message may have been deleted — ignore */ }
                  }

                  // Post new review with "Give Review" button
                  const giveReviewRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('review:give').setLabel('Give Review').setStyle(ButtonStyle.Primary),
                  );
                  const msg = await ch.send({ embeds: [reviewEmbed(review)], components: [giveReviewRow] });
                  Review.update(id, { messageId: msg.id });

                  // Persist latest review message info so the next approval can remove its button
                  GuildConfig.update(interaction.guild.id, {
                    latestReviewMessageId: msg.id,
                    latestReviewChannelId: ch.id,
                  });
                }
              } catch {}
            }
            return interaction.editReply({ embeds: [embed({ description: '✅ Review approved and posted.', color: Colors.success, timestamp: false })] });
          }
          if (action === 'deny') {
            Review.delete(id);
            return interaction.reply({ embeds: [embed({ description: '🗑️ Review denied and deleted.', color: Colors.error, timestamp: false })], flags: 64 });
          }
          if (action === 'give') {
            const config = GuildConfig.get(interaction.guild.id);
            const modal = new ModalBuilder()
              .setCustomId('review:give:modal')
              .setTitle('Submit a Review');
            const ratingInput = new TextInputBuilder()
              .setCustomId('rating')
              .setLabel('Rating (1–5)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a number from 1 to 5')
              .setMinLength(1)
              .setMaxLength(1)
              .setRequired(true);
            const reviewInput = new TextInputBuilder()
              .setCustomId('review')
              .setLabel('Your Review')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true);
            const serviceInput = new TextInputBuilder()
              .setCustomId('service')
              .setLabel('Service Used (optional)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false);
            modal.addComponents(
              new ActionRowBuilder().addComponents(ratingInput),
              new ActionRowBuilder().addComponents(reviewInput),
              new ActionRowBuilder().addComponents(serviceInput),
            );
            return interaction.showModal(modal);
          }
        }

        return;
      }

      // ── Select Menus ───────────────────────────────────────────────────────
      if (interaction.isStringSelectMenu()) {
        const parts = interaction.customId.split(':');
        const ns = parts[0], action = parts[1];

        if (ns === 'setup') {
          if (action === 'menu') return handleSetupMenu(interaction);
          if (action === 'typeselect') return handleSetupTypeSelect(interaction);
          if (action === 'removeselect') return handleSetupRemoveSelect(interaction);
          return interaction.deferUpdate();
        }
        if (ns === 'welcome') return handleWelcomeInteraction(interaction, parts);
        if (ns === 'server') return handleServerInteraction(interaction, parts);
        if (ns === 'panelselect') return handlePanelSelect(interaction, action);
        if (ns === 'ticketpriority_set') return handlePrioritySet(interaction, action);
        if (ns === 'noop') return interaction.deferUpdate();
        return;
      }

      // ── Channel Selects ────────────────────────────────────────────────────
      if (interaction.isChannelSelectMenu()) {
        const parts = interaction.customId.split(':');
        if (parts[0] === 'setup' && parts[1] === 'chan') return handleSetupChanSelect(interaction, parts[2]);
        if (parts[0] === 'welcome') return handleWelcomeInteraction(interaction, parts);
        return;
      }

      // ── Role Selects ───────────────────────────────────────────────────────
      if (interaction.isRoleSelectMenu()) {
        const parts = interaction.customId.split(':');
        if (parts[0] === 'setup' && parts[1] === 'role') return handleSetupRoleSelect(interaction);
        return;
      }

      // ── User Selects ───────────────────────────────────────────────────────
      if (interaction.isUserSelectMenu()) {
        const parts = interaction.customId.split(':');
        if (parts[0] === 'link') return handleLinkInteraction(interaction, parts);
        return;
      }

      // ── Modal Submissions ──────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        const parts = interaction.customId.split(':');
        const ns = parts[0], action = parts[1];

        if (ns === 'setup' && action === 'modal') return handleSetupModal(interaction, parts.slice(2).join(':'));
        if (ns === 'welcome') return handleWelcomeInteraction(interaction, parts);
        if (ns === 'server') return handleServerInteraction(interaction, parts);
        if (ns === 'ticketmodal') return handleTicketModal(interaction);
        if (ns === 'ticketclose') return handleCloseModal(interaction);
        if (ns === 'ticketadduser') return handleAddUserModal(interaction);
        if (ns === 'ticketremoveuser') return handleRemoveUserModal(interaction);
        if (ns === 'ticketrename') return handleRenameModal(interaction);

        if (ns === 'review' && action === 'give') {
          const ratingStr = interaction.fields.getTextInputValue('rating');
          const rating = parseInt(ratingStr, 10);
          if (isNaN(rating) || rating < 1 || rating > 5) {
            return interaction.reply({ embeds: [errorEmbed('Rating must be a number between 1 and 5.')], flags: 64 });
          }
          const content = interaction.fields.getTextInputValue('review');
          const service = interaction.fields.getTextInputValue('service') || '';
          const config = GuildConfig.get(interaction.guild.id);
          const review = Review.create(interaction.guild.id, {
            userId: interaction.user.id,
            username: interaction.user.tag,
            rating, content, service,
          });
          if (config.vouchApprovalChannel) {
            try {
              const approvalCh = await interaction.guild.channels.fetch(config.vouchApprovalChannel);
              if (approvalCh) {
                const row = new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId(`review:approve:${review.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                  new ButtonBuilder().setCustomId(`review:deny:${review.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
                );
                await approvalCh.send({
                  embeds: [embed({
                    title: `📝 New Review from ${interaction.user.tag}`,
                    description: content,
                    color: Colors.gold,
                    fields: [
                      { name: 'Rating', value: '⭐'.repeat(rating), inline: true },
                      { name: 'Service', value: service || 'Not specified', inline: true },
                    ],
                    footer: `Review ID: ${review.id}`,
                  })],
                  components: [row],
                });
              }
            } catch (err) {
              logger.warn('Failed to send review to approval channel', err);
            }
            return interaction.reply({ embeds: [successEmbed('Review Submitted', 'Your review has been submitted for approval. Thank you! 🙏')], flags: 64 });
          }
          // No approval channel — post review directly in the current channel
          try {
            const { reviewEmbed } = await import('../utils/embeds.js');
            const giveReviewRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('review:give').setLabel('Give Review').setStyle(ButtonStyle.Primary),
            );
            const msg = await interaction.channel.send({ embeds: [reviewEmbed(review)], components: [giveReviewRow] });
            Review.update(review.id, { approved: true, messageId: msg.id });
            GuildConfig.update(interaction.guild.id, {
              latestReviewMessageId: msg.id,
              latestReviewChannelId: interaction.channel.id,
            });
          } catch (err) {
            logger.warn('Failed to post review in current channel', err);
          }
          return interaction.reply({ embeds: [successEmbed('Review Submitted', 'Your review has been posted. Thank you! 🙏')], flags: 64 });
        }
        return;
      }

    } catch (err) {
      logger.error(`Interaction error [${interaction.customId ?? interaction.commandName ?? 'unknown'}]: ${err.message}`, err);
      try {
        const msg = { embeds: [errorEmbed('An unexpected error occurred. Please try again.')], flags: 64 };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch {}
    }
  },
};
