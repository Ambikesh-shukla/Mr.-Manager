import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAdmin } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embeds.js';
import { showWelcomeDashboard } from '../../handlers/welcomeHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Set up the welcome & goodbye card system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
    }
    try {
      return await showWelcomeDashboard(interaction);
    } catch (error) {
      console.error(error);
      try {
        const msg = { content: `❌ Error: \`${error.message}\``, flags: 64 };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch { /* ignore secondary reply errors to avoid infinite loops */ }
    }
  },
};
