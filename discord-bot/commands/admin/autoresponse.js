import { SlashCommandBuilder } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { successEmbed, errorEmbed, embed, Colors } from '../../utils/embeds.js';
import { requireAdmin } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('autoresponse')
    .setDescription('Manage auto-responses')
    .addSubcommand(s => s.setName('add')
      .setDescription('Add an auto-response trigger')
      .addStringOption(o => o.setName('trigger').setDescription('Trigger word/phrase').setRequired(true))
      .addStringOption(o => o.setName('response').setDescription('Bot response').setRequired(true))
      .addBooleanOption(o => o.setName('exact').setDescription('Exact match? (default: contains)').setRequired(false)))
    .addSubcommand(s => s.setName('remove')
      .setDescription('Remove an auto-response')
      .addStringOption(o => o.setName('trigger').setDescription('Trigger to remove').setRequired(true)))
    .addSubcommand(s => s.setName('list')
      .setDescription('List all auto-responses')),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();
    const config = GuildConfig.get(interaction.guild.id);
    const responses = config.autoResponses ?? [];

    if (sub === 'add') {
      const trigger = interaction.options.getString('trigger').toLowerCase();
      const response = interaction.options.getString('response');
      const exact = interaction.options.getBoolean('exact') ?? false;

      if (responses.find(r => r.trigger === trigger)) {
        return interaction.reply({ embeds: [errorEmbed(`Trigger \`${trigger}\` already exists.`)], flags: 64 });
      }
      if (responses.length >= 50) {
        return interaction.reply({ embeds: [errorEmbed('Maximum 50 auto-responses allowed.')], flags: 64 });
      }

      responses.push({ trigger, response, exact });
      GuildConfig.update(interaction.guild.id, { autoResponses: responses });
      return interaction.reply({ embeds: [successEmbed('Auto-Response Added', `Trigger: \`${trigger}\`\nResponse: ${response}`)], flags: 64 });
    }

    if (sub === 'remove') {
      const trigger = interaction.options.getString('trigger').toLowerCase();
      const filtered = responses.filter(r => r.trigger !== trigger);
      if (filtered.length === responses.length) {
        return interaction.reply({ embeds: [errorEmbed(`Trigger \`${trigger}\` not found.`)], flags: 64 });
      }
      GuildConfig.update(interaction.guild.id, { autoResponses: filtered });
      return interaction.reply({ embeds: [successEmbed('Removed', `Auto-response for \`${trigger}\` removed.`)], flags: 64 });
    }

    if (sub === 'list') {
      if (responses.length === 0) {
        return interaction.reply({ embeds: [embed({ description: 'No auto-responses configured.', color: Colors.warning })], flags: 64 });
      }
      const fields = responses.map(r => ({
        name: `"${r.trigger}" ${r.exact ? '(exact)' : '(contains)'}`,
        value: r.response.slice(0, 200),
        inline: false,
      }));
      return interaction.reply({ embeds: [embed({ title: `🤖 Auto-Responses (${responses.length})`, fields, color: Colors.info })], flags: 64 });
    }
  },
};
