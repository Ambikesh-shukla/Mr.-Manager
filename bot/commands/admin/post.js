import { SlashCommandBuilder } from 'discord.js';
import { openPostEmbedWizard } from '../../handlers/postHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post content to a channel')
    .addSubcommand(s => s.setName('embed')
      .setDescription('Open the step-by-step embed builder wizard')),

  defaultLevel: 'admin',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── embed ──────────────────────────────────────────────────────────────
    if (sub === 'embed') {
      return openPostEmbedWizard(interaction);
    }
  },
};
