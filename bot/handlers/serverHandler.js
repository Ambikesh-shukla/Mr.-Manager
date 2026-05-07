import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ServerProvision } from '../storage/ServerProvision.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';

function buildDashboard(guildId, userId, isUserAdmin) {
  const data = ServerProvision.ensureGuild(guildId);
  const userServers = data.createdServerRecords?.[userId] ?? [];
  const userClaim = data.userClaims?.[userId] ?? null;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('server:btn:setup')
      .setLabel('Setup Panel')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!isUserAdmin),
    new ButtonBuilder()
      .setCustomId('server:btn:create')
      .setLabel('Create Server')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('server:btn:rewards')
      .setLabel('Invite Rewards')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('server:btn:my')
      .setLabel('My Server')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('server:btn:admin')
      .setLabel('Admin Controls')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isUserAdmin),
    new ButtonBuilder()
      .setCustomId('server:btn:cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed({
      title: '🧭 Minecraft Server Dashboard',
      color: Colors.primary,
      description: 'Choose an option below to manage base server provisioning.',
      fields: [
        { name: 'Guild ID', value: guildId, inline: false },
        { name: 'Panel Config', value: data.panelConfigRef ? `Configured (\`${data.panelConfigRef}\`)` : 'Not configured', inline: true },
        { name: 'Invite Requirement', value: String(data.inviteRequirement ?? 0), inline: true },
        { name: 'My Claims', value: userClaim ? `Used: ${userClaim.claimCount ?? 0}` : 'None yet', inline: true },
        { name: 'My Servers', value: String(userServers.length), inline: true },
      ],
    })],
    components: [row1, row2],
  };
}

export async function showServerDashboard(interaction) {
  const isUserAdmin = isAdmin(interaction.member);
  const payload = buildDashboard(interaction.guildId, interaction.user.id, isUserAdmin);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

export async function handleServerInteraction(interaction, parts) {
  const type = parts[1];
  if (type !== 'btn') return interaction.deferUpdate();

  const action = parts[2];
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const admin = isAdmin(interaction.member);

  if (action === 'cancel') {
    await interaction.deferUpdate();
    return interaction.editReply({
      embeds: [embed({ description: '✖️ Server dashboard closed.', color: Colors.error, timestamp: false })],
      components: [],
    });
  }

  if (action === 'setup' || action === 'admin') {
    if (!admin) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission for this control.')], flags: 64 });
    }
    await interaction.deferUpdate();
    return interaction.followUp({
      embeds: [embed({
        title: action === 'setup' ? '⚙️ Setup Panel' : '🛠️ Admin Controls',
        description: 'Base structure is ready. Configuration actions will be added in the next phase.',
        color: Colors.info,
      })],
      flags: 64,
    });
  }

  if (action === 'create') {
    ServerProvision.ensureUserClaim(guildId, userId);
    ServerProvision.ensureUserServers(guildId, userId);
    ServerProvision.ensureUserCooldowns(guildId, userId);
    await interaction.deferUpdate();
    return interaction.followUp({
      embeds: [embed({
        title: '🆕 Create Server',
        description: 'Base flow initialized. API provisioning is intentionally disabled in this phase.',
        color: Colors.success,
      })],
      flags: 64,
    });
  }

  if (action === 'rewards') {
    ServerProvision.ensureUserClaim(guildId, userId);
    await interaction.deferUpdate();
    return interaction.followUp({
      embeds: [embed({
        title: '🎁 Invite Rewards',
        description: 'Reward claim scaffolding is ready. Invite reward validation will be added later.',
        color: Colors.info,
      })],
      flags: 64,
    });
  }

  if (action === 'my') {
    const servers = ServerProvision.ensureUserServers(guildId, userId);
    ServerProvision.ensureUserCooldowns(guildId, userId);
    await interaction.deferUpdate();
    return interaction.followUp({
      embeds: [embed({
        title: '🖥️ My Server',
        description: `You currently have **${servers.length}** recorded server(s).`,
        color: Colors.info,
      })],
      flags: 64,
    });
  }

  return interaction.deferUpdate();
}
