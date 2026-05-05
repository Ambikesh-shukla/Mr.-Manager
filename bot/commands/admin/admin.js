import { SlashCommandBuilder } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { CommandLock } from '../../storage/CommandLock.js';
import { successEmbed, errorEmbed, embed, Colors } from '../../utils/embeds.js';
import { COMMAND_DEFAULTS } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Server admin settings')
    .addSubcommandGroup(g => g.setName('staffrole').setDescription('Manage staff roles')
      .addSubcommand(s => s.setName('add').setDescription('Add a staff role')
        .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a staff role')
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List all staff roles')))
    .addSubcommand(s => s.setName('config').setDescription('View full bot configuration')),

  defaultLevel: 'admin',

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ── staffrole group ──────────────────────────────────────────────────
    if (group === 'staffrole') {
      const config = GuildConfig.get(interaction.guild.id);
      const staffRoles = config.staffRoles ?? [];

      if (sub === 'add') {
        const role = interaction.options.getRole('role');
        if (staffRoles.includes(role.id)) {
          return interaction.reply({ embeds: [errorEmbed(`${role} is already a staff role.`)], flags: 64 });
        }
        staffRoles.push(role.id);
        GuildConfig.update(interaction.guild.id, { staffRoles });
        return interaction.reply({ embeds: [successEmbed('Staff Role Added', `${role} can now use staff commands.`)], flags: 64 });
      }

      if (sub === 'remove') {
        const role = interaction.options.getRole('role');
        const filtered = staffRoles.filter(id => id !== role.id);
        GuildConfig.update(interaction.guild.id, { staffRoles: filtered });
        return interaction.reply({ embeds: [successEmbed('Removed', `${role} removed from staff roles.`)], flags: 64 });
      }

      if (sub === 'list') {
        if (staffRoles.length === 0) {
          return interaction.reply({ embeds: [embed({ description: 'No staff roles configured. Admins always have full access.', color: Colors.warning })], flags: 64 });
        }
        return interaction.reply({
          embeds: [embed({ title: '👮 Staff Roles', description: staffRoles.map(id => `<@&${id}>`).join('\n'), color: Colors.info })],
          flags: 64,
        });
      }
    }

    // ── config ───────────────────────────────────────────────────────────
    if (sub === 'config') {
      const config = GuildConfig.get(interaction.guild.id);
      const panels = TicketPanel.forGuild(interaction.guild.id);
      const locks = CommandLock.getAll(interaction.guild.id);

      const lockLines = Object.keys(COMMAND_DEFAULTS).map(cmd => {
        const lock = locks[cmd];
        const mode = lock?.mode ?? COMMAND_DEFAULTS[cmd];
        const roleStr = mode === 'role' && lock?.roleId ? ` → <@&${lock.roleId}>` : '';
        const icon = mode === 'public' ? '🌐' : mode === 'staff' ? '👮' : '🔒';
        return `${icon} \`${cmd}\` — ${mode}${roleStr}`;
      }).join('\n');

      return interaction.reply({
        embeds: [embed({
          title: `⚙️ Bot Configuration — ${interaction.guild.name}`,
          color: Colors.primary,
          fields: [
            { name: '📋 Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : 'Not set', inline: true },
            { name: '💡 Suggestions', value: config.suggestionChannel ? `<#${config.suggestionChannel}>` : 'Not set', inline: true },
            { name: '⭐ Vouches', value: config.vouchChannel ? `<#${config.vouchChannel}>` : 'Not set', inline: true },
            { name: '✅ Vouch Approval', value: config.vouchApprovalChannel ? `<#${config.vouchApprovalChannel}>` : 'Not set', inline: true },
            { name: '👮 Staff Roles', value: config.staffRoles?.map(r => `<@&${r}>`).join(', ') || 'None set', inline: false },
            { name: `🎫 Ticket Panels (${panels.length})`, value: panels.map(p => `**${p.title}** \`${p.id}\``).join('\n') || 'None', inline: false },
            { name: '🤖 Auto-Responses', value: String(config.autoResponses?.length ?? 0), inline: true },
            { name: '🔐 Command Permissions', value: lockLines || 'All defaults', inline: false },
          ],
          footer: 'Use /command-lock to override permissions per command',
        })],
        flags: 64,
      });
    }
  },
};
