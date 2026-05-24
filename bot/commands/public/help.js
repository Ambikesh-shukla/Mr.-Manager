import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildHelpCenterPayload } from '../../utils/helpCenter.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Open the interactive Mr. Manager Help Center'),

  defaultLevel: 'public',

  async execute(interaction) {
    await interaction.reply({
      ...buildHelpCenterPayload(interaction, 'quickStart'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
