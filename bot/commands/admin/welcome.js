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
    return showWelcomeDashboard(interaction);
  },
};
