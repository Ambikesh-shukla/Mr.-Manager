import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAdmin } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embeds.js';
import { startSetup } from '../../handlers/setupHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Set up your ticket system with an easy interactive guide')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
    }
    return startSetup(interaction, null);
  },
};
