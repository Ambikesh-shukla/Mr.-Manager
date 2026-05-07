import { SlashCommandBuilder } from 'discord.js';
import { startBingoCommand } from '../../handlers/bingoHandler.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bingo')
    .setDescription('Start a Bingo game (bot mode or challenge a player)')
    .addUserOption(opt =>
      opt
        .setName('opponent')
        .setDescription('Player to challenge (used with Challenge mode)')
        .setRequired(false)),

  defaultLevel: 'public',

  async execute(interaction) {
    logger.info(`[BINGO-DEBUG] command start | user=${interaction.user.id} guild=${interaction.guildId ?? 'dm'}`);
    return startBingoCommand(interaction);
  },
};
