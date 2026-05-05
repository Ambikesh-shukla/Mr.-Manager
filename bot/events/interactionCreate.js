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
import { embed, Colors } from '../utils/embeds.js';
import { handleWelcomeInteraction } from '../handlers/welcomeHandler.js';

export default {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client) {
    try {
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

        if (ns === 'suggest') return interaction.deferUpdate();

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
                  const msg = await ch.send({ embeds: [reviewEmbed(review)] });
                  Review.update(id, { messageId: msg.id });
                }
              } catch {}
            }
            return interaction.editReply({ embeds: [embed({ description: '✅ Review approved and posted.', color: Colors.success, timestamp: false })] });
          }
          if (action === 'deny') {
            Review.delete(id);
            return interaction.reply({ embeds: [embed({ description: '🗑️ Review denied and deleted.', color: Colors.error, timestamp: false })], flags: 64 });
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

      // ── Modal Submissions ──────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        const parts = interaction.customId.split(':');
        const ns = parts[0], action = parts[1];

        if (ns === 'setup' && action === 'modal') return handleSetupModal(interaction, parts.slice(2).join(':'));
        if (ns === 'welcome') return handleWelcomeInteraction(interaction, parts);
        if (ns === 'ticketmodal') return handleTicketModal(interaction);
        if (ns === 'ticketclose') return handleCloseModal(interaction);
        if (ns === 'ticketadduser') return handleAddUserModal(interaction);
        if (ns === 'ticketremoveuser') return handleRemoveUserModal(interaction);
        if (ns === 'ticketrename') return handleRenameModal(interaction);
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
