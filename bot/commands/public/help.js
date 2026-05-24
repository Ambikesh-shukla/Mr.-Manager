import { ComponentType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildHelpCenterPayload, HELP_MENU_IDLE_MS } from '../../utils/helpCenter.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Open the interactive Mr. Manager Help Center'),

  defaultLevel: 'public',

  async execute(interaction) {
    let activeSection = 'quickStart';
    const message = await interaction.reply({
      ...buildHelpCenterPayload(interaction, 'quickStart'),
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      idle: HELP_MENU_IDLE_MS,
      filter: (selectInteraction) => selectInteraction.user.id === interaction.user.id,
    });

    collector.on('collect', (selectInteraction) => {
      const selected = selectInteraction.values?.[0];
      if (selected) activeSection = selected;
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply(buildHelpCenterPayload(interaction, activeSection, { menuDisabled: true }));
      } catch (err) {
        logger.error('[HELP] Failed to disable help menu after inactivity timeout.', err);
      }
    });
  },
};
