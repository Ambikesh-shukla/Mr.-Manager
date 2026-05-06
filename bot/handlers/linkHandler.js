import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, EmbedBuilder,
} from 'discord.js';
import { LinkConfig } from '../storage/LinkConfig.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

// ── In-memory wizard sessions (10-minute TTL) ─────────────────────────────────
const sessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;

// Periodically remove stale sessions to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(key);
  }
}, SESSION_TTL_MS).unref();

function sessionKey(guildId, userId) { return `${guildId}_${userId}`; }
function getSession(guildId, userId) {
  const s = sessions.get(sessionKey(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) { sessions.delete(sessionKey(guildId, userId)); return null; }
  return s;
}
function setSession(guildId, userId, data) { sessions.set(sessionKey(guildId, userId), { ...data, createdAt: data.createdAt ?? Date.now() }); }
function clearSession(guildId, userId) { sessions.delete(sessionKey(guildId, userId)); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function yn(v) { return v ? '✅ Yes' : '❌ No'; }

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function showLinkDashboard(interaction) {
  const cfg = LinkConfig.get(interaction.guildId);

  const e = new EmbedBuilder()
    .setTitle('🔗 Link Block System')
    .setColor(cfg.enabled ? Colors.success : Colors.error)
    .setDescription('Control which users can post links in this server.\nUse **Start Setup** for the full wizard, or the quick-action buttons below.')
    .addFields(
      { name: '📊 Status', value: cfg.enabled ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
      { name: '👑 Owner Bypass', value: yn(cfg.allowOwner), inline: true },
      { name: '🛡️ Admin Bypass', value: yn(cfg.allowAdmins), inline: true },
      { name: '🤖 Bot Owner Bypass', value: yn(cfg.allowBotOwner), inline: true },
      {
        name: '👥 Allowed Users',
        value: cfg.allowedUsers.length > 0
          ? cfg.allowedUsers.map(id => `<@${id}>`).join(', ')
          : '`None`',
        inline: false,
      },
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:btn:setup').setLabel('Start Setup').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('link:btn:toggle')
      .setLabel(cfg.enabled ? 'Disable' : 'Enable')
      .setEmoji(cfg.enabled ? '🔴' : '🟢')
      .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('link:btn:manageusers').setLabel('Manage Allowed Users').setEmoji('👥').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:btn:status').setLabel('Status').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('link:btn:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [e], components: [row1, row2] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// ── Wizard step renderers ─────────────────────────────────────────────────────

async function showStep1(interaction, session) {
  const e = new EmbedBuilder()
    .setTitle('🔗 Link Block Setup — Step 1/4: Enable')
    .setColor(Colors.primary)
    .setDescription(
      'Should link blocking be **enabled** in this server?\n\n' +
      'When enabled, messages containing links will be deleted for users who are not allowed to bypass.',
    )
    .setFooter({ text: 'Step 1 of 4' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:wiz:s1:enable').setLabel('Enable').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('link:wiz:s1:disable').setLabel('Disable').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('link:wiz:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );

  const payload = { embeds: [e], components: [row] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

async function showStep2(interaction, session) {
  const { data } = session;
  const e = new EmbedBuilder()
    .setTitle('🔗 Link Block Setup — Step 2/4: Bypass Settings')
    .setColor(Colors.primary)
    .setDescription('Choose who can **bypass** the link block and post links freely.\nToggle each option, then click **Next**.')
    .addFields(
      { name: '👑 Server Owner', value: yn(data.allowOwner), inline: true },
      { name: '🛡️ Admins', value: yn(data.allowAdmins), inline: true },
      { name: '🤖 Bot Owner', value: yn(data.allowBotOwner), inline: true },
    )
    .setFooter({ text: 'Step 2 of 4' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link:wiz:s2:tgl:allowOwner')
      .setLabel(`Owner: ${data.allowOwner ? 'ON' : 'OFF'}`)
      .setEmoji('👑')
      .setStyle(data.allowOwner ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('link:wiz:s2:tgl:allowAdmins')
      .setLabel(`Admins: ${data.allowAdmins ? 'ON' : 'OFF'}`)
      .setEmoji('🛡️')
      .setStyle(data.allowAdmins ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('link:wiz:s2:tgl:allowBotOwner')
      .setLabel(`Bot Owner: ${data.allowBotOwner ? 'ON' : 'OFF'}`)
      .setEmoji('🤖')
      .setStyle(data.allowBotOwner ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:wiz:s2:next').setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('link:wiz:s2:back').setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('link:wiz:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [e], components: [row1, row2] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

async function showStep3(interaction, session) {
  const { data } = session;
  const e = new EmbedBuilder()
    .setTitle('🔗 Link Block Setup — Step 3/4: Allowed Users')
    .setColor(Colors.primary)
    .setDescription(
      'Select users who are **always allowed** to post links regardless of other settings.\n' +
      'Select up to 25 users, then click **Submit** on the menu. Click **Skip** to keep the current list.',
    )
    .addFields({
      name: '👥 Currently Selected',
      value: data.allowedUsers.length > 0
        ? data.allowedUsers.map(id => `<@${id}>`).join(', ')
        : '`None`',
    })
    .setFooter({ text: 'Step 3 of 4' })
    .setTimestamp();

  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('link:wiz:users')
      .setPlaceholder('Select allowed users…')
      .setMinValues(0)
      .setMaxValues(25),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:wiz:s3:skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('link:wiz:s3:back').setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('link:wiz:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [e], components: [selectRow, navRow] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

async function showPreview(interaction, session) {
  const { data } = session;
  const e = new EmbedBuilder()
    .setTitle('🔗 Link Block Setup — Step 4/4: Review & Save')
    .setColor(Colors.gold)
    .setDescription('Review your settings below, then click **Save** to apply them.')
    .addFields(
      { name: '📊 Status', value: data.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '👑 Owner Bypass', value: yn(data.allowOwner), inline: true },
      { name: '🛡️ Admin Bypass', value: yn(data.allowAdmins), inline: true },
      { name: '🤖 Bot Owner Bypass', value: yn(data.allowBotOwner), inline: true },
      {
        name: '👥 Allowed Users',
        value: data.allowedUsers.length > 0
          ? data.allowedUsers.map(id => `<@${id}>`).join(', ')
          : '`None`',
        inline: false,
      },
    )
    .setFooter({ text: 'Step 4 of 4 — Review your settings' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:wiz:preview:save').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('link:wiz:preview:back').setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('link:wiz:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [e], components: [row] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// ── Manage Users (quick access from dashboard) ────────────────────────────────

async function showManageUsers(interaction) {
  const cfg = LinkConfig.get(interaction.guildId);
  const e = new EmbedBuilder()
    .setTitle('👥 Manage Allowed Users')
    .setColor(Colors.primary)
    .setDescription(
      'Select users who are **always allowed** to post links.\n' +
      'Select up to 25 users, then click **Submit** on the menu. Submitting with no users selected will **clear** the list.',
    )
    .addFields({
      name: '👥 Current Allowed Users',
      value: cfg.allowedUsers.length > 0
        ? cfg.allowedUsers.map(id => `<@${id}>`).join(', ')
        : '`None`',
    })
    .setTimestamp();

  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('link:mgr:users')
      .setPlaceholder('Select allowed users…')
      .setMinValues(0)
      .setMaxValues(25),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link:mgr:cancel').setLabel('Back to Dashboard').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
  );

  const payload = { embeds: [e], components: [selectRow, navRow] };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// ── Main interaction handler ──────────────────────────────────────────────────

export async function handleLinkInteraction(interaction, parts) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission.')], flags: 64 });
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const type = parts[1]; // btn | wiz | mgr

  // ── Dashboard buttons: link:btn:{action} ────────────────────────────────────
  if (type === 'btn') {
    const action = parts[2];

    if (action === 'cancel') {
      await interaction.deferUpdate();
      return interaction.editReply({
        embeds: [embed({ description: '✖️ Dashboard closed.', color: Colors.error, timestamp: false })],
        components: [],
      });
    }

    if (action === 'toggle') {
      const cfg = LinkConfig.get(guildId);
      LinkConfig.update(guildId, { enabled: !cfg.enabled });
      await interaction.deferUpdate();
      return showLinkDashboard(interaction);
    }

    if (action === 'status') {
      const cfg = LinkConfig.get(guildId);
      const e = new EmbedBuilder()
        .setTitle('📊 Link Block Status')
        .setColor(cfg.enabled ? Colors.success : Colors.error)
        .addFields(
          { name: '📊 Status', value: cfg.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: '👑 Owner Bypass', value: yn(cfg.allowOwner), inline: true },
          { name: '🛡️ Admin Bypass', value: yn(cfg.allowAdmins), inline: true },
          { name: '🤖 Bot Owner Bypass', value: yn(cfg.allowBotOwner), inline: true },
          {
            name: '👥 Allowed Users',
            value: cfg.allowedUsers.length > 0
              ? cfg.allowedUsers.map(id => `<@${id}>`).join(', ')
              : '`None`',
            inline: false,
          },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [e], flags: 64 });
    }

    if (action === 'setup') {
      const cfg = LinkConfig.get(guildId);
      setSession(guildId, userId, {
        data: {
          enabled: cfg.enabled,
          allowAdmins: cfg.allowAdmins,
          allowOwner: cfg.allowOwner,
          allowBotOwner: cfg.allowBotOwner,
          allowedUsers: [...cfg.allowedUsers],
        },
      });
      await interaction.deferUpdate();
      return showStep1(interaction, getSession(guildId, userId));
    }

    if (action === 'manageusers') {
      await interaction.deferUpdate();
      return showManageUsers(interaction);
    }

    return interaction.deferUpdate();
  }

  // ── Wizard interactions: link:wiz:{step}[:{action}[:{extra}]] ───────────────
  if (type === 'wiz') {
    const step = parts[2];
    const action = parts[3];
    const extra = parts[4];

    // Universal wizard cancel
    if (step === 'cancel') {
      clearSession(guildId, userId);
      await interaction.deferUpdate();
      return interaction.editReply({
        embeds: [embed({ description: '✖️ Setup cancelled.', color: Colors.error, timestamp: false })],
        components: [],
      });
    }

    // UserSelectMenu submission for step 3: link:wiz:users
    if (step === 'users') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
      }
      const updated = { ...session, data: { ...session.data, allowedUsers: interaction.values ?? [] } };
      setSession(guildId, userId, updated);
      await interaction.deferUpdate();
      return showPreview(interaction, updated);
    }

    // Step 1: link:wiz:s1:{action}
    if (step === 's1') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
      }
      const updated = { ...session, data: { ...session.data, enabled: action === 'enable' } };
      setSession(guildId, userId, updated);
      await interaction.deferUpdate();
      return showStep2(interaction, updated);
    }

    // Step 2: link:wiz:s2:{action}[:{extra}]
    if (step === 's2') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
      }

      if (action === 'back') {
        await interaction.deferUpdate();
        return showStep1(interaction, session);
      }

      if (action === 'next') {
        await interaction.deferUpdate();
        return showStep3(interaction, session);
      }

      if (action === 'tgl') {
        if (!['allowOwner', 'allowAdmins', 'allowBotOwner'].includes(extra)) {
          return interaction.deferUpdate();
        }
        const updated = { ...session, data: { ...session.data, [extra]: !session.data[extra] } };
        setSession(guildId, userId, updated);
        await interaction.deferUpdate();
        return showStep2(interaction, updated);
      }

      return interaction.deferUpdate();
    }

    // Step 3: link:wiz:s3:{action}
    if (step === 's3') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
      }

      if (action === 'back') {
        await interaction.deferUpdate();
        return showStep2(interaction, session);
      }

      if (action === 'skip') {
        await interaction.deferUpdate();
        return showPreview(interaction, session);
      }

      return interaction.deferUpdate();
    }

    // Preview: link:wiz:preview:{action}
    if (step === 'preview') {
      if (action === 'back') {
        const session = getSession(guildId, userId);
        if (!session) {
          return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
        }
        await interaction.deferUpdate();
        return showStep3(interaction, session);
      }

      if (action === 'save') {
        const session = getSession(guildId, userId);
        if (!session) {
          return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/link` again.')], flags: 64 });
        }
        try {
          LinkConfig.set(guildId, session.data);
        } catch (err) {
          logger.error('Failed to save link config', err);
          return interaction.reply({ embeds: [errorEmbed('Failed to save settings. Please try again.')], flags: 64 });
        }
        clearSession(guildId, userId);
        await interaction.deferUpdate();
        return showLinkDashboard(interaction);
      }

      return interaction.deferUpdate();
    }

    return interaction.deferUpdate();
  }

  // ── Manager: link:mgr:{action} ────────────────────────────────────────────────
  if (type === 'mgr') {
    const action = parts[2];

    if (action === 'cancel') {
      await interaction.deferUpdate();
      return showLinkDashboard(interaction);
    }

    // UserSelectMenu: link:mgr:users
    if (action === 'users') {
      LinkConfig.update(guildId, { allowedUsers: interaction.values ?? [] });
      await interaction.deferUpdate();
      return showLinkDashboard(interaction);
    }

    return interaction.deferUpdate();
  }

  return interaction.deferUpdate();
}
