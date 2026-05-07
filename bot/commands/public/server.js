import { SlashCommandBuilder } from 'discord.js';
import { showServerDashboard } from '../../handlers/serverHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Open the Minecraft server provisioning dashboard'),

  defaultLevel: 'public',

  async execute(interaction) {
    return showServerDashboard(interaction);
  },
};
