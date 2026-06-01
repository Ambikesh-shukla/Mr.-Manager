import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { showLinkDashboard } from '../../handlers/linkHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Configure the link-block system for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  defaultLevel: 'public',

  async execute(interaction) {
    try {
      return await showLinkDashboard(interaction);
    } catch (err) {
      try {
        const msg = { embeds: [errorEmbed(`Error: \`${err.message}\``)], flags: 64 };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch { /* ignore secondary reply errors */ }
    }
  },
};
