import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

const GAME_EXPIRE_MS = 10 * 60 * 1000;
const activeBingoGames = new Map(); // gameId -> game

function makeGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function shuffle(nums) {
  for (let i = nums.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

function createBoard() {
  const numbers = shuffle(Array.from({ length: 25 }, (_, i) => i + 1));
  const marks = Array(25).fill(false);
  marks[12] = true; // free center
  return { numbers, marks };
}

function countLines(marks) {
  let lines = 0;
  for (let r = 0; r < 5; r += 1) {
    if ([0, 1, 2, 3, 4].every(c => marks[r * 5 + c])) lines += 1;
  }
  for (let c = 0; c < 5; c += 1) {
    if ([0, 1, 2, 3, 4].every(r => marks[r * 5 + c])) lines += 1;
  }
  if ([0, 1, 2, 3, 4].every(i => marks[i * 6])) lines += 1;
  if ([0, 1, 2, 3, 4].every(i => marks[(i + 1) * 4])) lines += 1;
  return lines;
}

function isWin(marks) {
  return countLines(marks) >= 5;
}

function buildModeComponents(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`bingo:mode:${gameId}`)
        .setPlaceholder('Select Bingo mode')
        .addOptions(
          { label: 'Bot Mode', value: 'bot', description: 'Play against the bot' },
          { label: 'Challenge Player', value: 'challenge', description: 'Challenge another member' },
        ),
    ),
  ];
}

function buildBoardRows(game) {
  const board = game.boards[game.turnUserId];
  const rows = [];
  for (let r = 0; r < 5; r += 1) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c += 1) {
      const idx = r * 5 + c;
      const marked = board.marks[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`bingo:cell:${game.id}:${idx}`)
          .setLabel(String(board.numbers[idx]))
          .setStyle(marked ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(marked || game.status !== 'active'),
      );
    }
    rows.push(row);
  }
  return rows;
}

function gameTitle(game) {
  return game.isBot ? '🤖 Bingo (Bot Mode)' : '🎯 Bingo Challenge';
}

function gameDescription(game) {
  if (game.status === 'pending') {
    return `Challenge sent to <@${game.opponentId}>.\nClick **Accept Challenge** to start.`;
  }
  const hostLines = countLines(game.boards[game.hostId].marks);
  const oppLines = countLines(game.boards[game.opponentId].marks);
  return [
    `Turn: <@${game.turnUserId}>`,
    `Host lines: **${hostLines}/5**`,
    `${game.isBot ? 'Bot' : 'Opponent'} lines: **${oppLines}/5**`,
  ].join('\n');
}

function gameEmbed(game, extra = '') {
  return embed({
    title: gameTitle(game),
    description: `${gameDescription(game)}${extra ? `\n\n${extra}` : ''}`,
    color: Colors.primary,
    timestamp: false,
  });
}

function scheduleExpire(game) {
  if (game.expireTimer) clearTimeout(game.expireTimer);
  game.expireAt = Date.now() + GAME_EXPIRE_MS;
  game.expireTimer = setTimeout(async () => {
    if (!activeBingoGames.has(game.id)) return;
    activeBingoGames.delete(game.id);
    logger.info(`[BINGO-DEBUG] game expire | game=${game.id}`);
    try {
      const ch = await game.client.channels.fetch(game.channelId);
      if (!ch) return;
      const msg = await ch.messages.fetch(game.messageId);
      if (!msg) return;
      await msg.edit({
        embeds: [gameEmbed(game, '⌛ Game expired due to inactivity.')],
        components: [],
      });
    } catch {}
  }, GAME_EXPIRE_MS);
}

async function startActiveGame(interaction, game) {
  game.status = 'active';
  game.turnUserId = game.hostId;
  game.boards[game.hostId] = createBoard();
  game.boards[game.opponentId] = createBoard();
  logger.info(`[BINGO-DEBUG] board creation | game=${game.id} host=${game.hostId} opp=${game.opponentId}`);
  const editPayload = {
    embeds: [gameEmbed(game)],
    components: buildBoardRows(game),
  };
  if (interaction.message?.id === game.messageId) {
    await interaction.update(editPayload);
  } else {
    await interaction.editReply(editPayload);
  }
  scheduleExpire(game);
}

function ensureParticipant(interaction, game) {
  const userId = interaction.user.id;
  if (userId !== game.hostId && userId !== game.opponentId) return false;
  return true;
}

export async function startBingoCommand(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ embeds: [errorEmbed('Bingo can only be used in a server.')], flags: 64 });
  }

  const gameId = makeGameId();
  const opponent = interaction.options.getUser('opponent');
  const game = {
    id: gameId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: null,
    hostId: interaction.user.id,
    opponentId: opponent?.id ?? interaction.client.user.id,
    isBot: false,
    status: 'mode',
    turnUserId: null,
    boards: {},
    expireTimer: null,
    expireAt: null,
    client: interaction.client,
  };
  activeBingoGames.set(gameId, game);
  scheduleExpire(game);

  const reply = await interaction.reply({
    embeds: [embed({
      title: '🎮 Bingo',
      description: 'Choose how you want to play Bingo.',
      color: Colors.primary,
      timestamp: false,
    })],
    components: buildModeComponents(gameId),
    fetchReply: true,
  });
  game.messageId = reply?.id ?? null;
}

export async function handleBingoInteraction(interaction, parts) {
  const action = parts[1];
  const gameId = parts[2];
  const game = activeBingoGames.get(gameId);

  if (!game) {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const fn = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
      return interaction[fn]({ embeds: [errorEmbed('This Bingo game is no longer active.')], flags: 64 });
    }
    return;
  }

  if (action === 'mode' && interaction.isStringSelectMenu()) {
    logger.info(`[BINGO-DEBUG] mode select | game=${game.id} user=${interaction.user.id}`);
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ embeds: [errorEmbed('Only the player who started the game can choose mode.')], flags: 64 });
    }
    const selected = interaction.values?.[0];
    if (selected === 'bot') {
      game.isBot = true;
      game.opponentId = interaction.client.user.id;
      return startActiveGame(interaction, game);
    }

    const targetId = game.opponentId;
    if (!targetId || targetId === interaction.client.user.id || targetId === game.hostId) {
      return interaction.reply({ embeds: [errorEmbed('Use `/bingo opponent:@user`, then pick Challenge mode.')], flags: 64 });
    }
    game.isBot = false;
    game.status = 'pending';
    await interaction.update({
      embeds: [gameEmbed(game)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`bingo:accept:${game.id}`)
            .setLabel('Accept Challenge')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`bingo:decline:${game.id}`)
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
    return;
  }

  if (action === 'accept' && interaction.isButton()) {
    logger.info(`[BINGO-DEBUG] challenge accept | game=${game.id} user=${interaction.user.id}`);
    if (interaction.user.id !== game.opponentId) {
      return interaction.reply({ embeds: [errorEmbed('Only the challenged player can accept.')], flags: 64 });
    }
    return startActiveGame(interaction, game);
  }

  if (action === 'decline' && interaction.isButton()) {
    if (interaction.user.id !== game.opponentId) {
      return interaction.reply({ embeds: [errorEmbed('Only the challenged player can decline.')], flags: 64 });
    }
    activeBingoGames.delete(game.id);
    if (game.expireTimer) clearTimeout(game.expireTimer);
    return interaction.update({
      embeds: [embed({
        title: '🎯 Bingo Challenge',
        description: 'Challenge declined.',
        color: Colors.warning,
        timestamp: false,
      })],
      components: [],
    });
  }

  if (action === 'cell' && interaction.isButton()) {
    const idx = Number(parts[3]);
    logger.info(`[BINGO-DEBUG] button click | game=${game.id} user=${interaction.user.id} cell=${idx}`);

    if (!ensureParticipant(interaction, game)) {
      return interaction.reply({ embeds: [errorEmbed('Only participants in this game can interact.')], flags: 64 });
    }
    if (game.status !== 'active') {
      return interaction.reply({ embeds: [errorEmbed('This Bingo game is not active.')], flags: 64 });
    }
    if (interaction.user.id !== game.turnUserId) {
      return interaction.reply({ embeds: [errorEmbed('It is not your turn.')], flags: 64 });
    }

    const board = game.boards[interaction.user.id];
    if (!board || Number.isNaN(idx) || idx < 0 || idx > 24) {
      return interaction.reply({ embeds: [errorEmbed('Invalid Bingo move.')], flags: 64 });
    }
    if (board.marks[idx]) {
      return interaction.reply({ embeds: [errorEmbed('That cell is already marked.')], flags: 64 });
    }

    board.marks[idx] = true;

    if (isWin(board.marks)) {
      logger.info(`[BINGO-DEBUG] win detection | game=${game.id} winner=${interaction.user.id}`);
      game.status = 'ended';
      activeBingoGames.delete(game.id);
      if (game.expireTimer) clearTimeout(game.expireTimer);
      await interaction.update({
        embeds: [gameEmbed(game, `🏆 <@${interaction.user.id}> wins!`)],
        components: [],
      });
      return;
    }

    game.turnUserId = interaction.user.id === game.hostId ? game.opponentId : game.hostId;
    logger.info(`[BINGO-DEBUG] turn update | game=${game.id} turn=${game.turnUserId}`);

    if (game.isBot && game.turnUserId === game.opponentId) {
      const botBoard = game.boards[game.opponentId];
      const choices = botBoard.marks.map((m, i) => (!m ? i : -1)).filter(i => i >= 0);
      if (choices.length > 0) {
        const botIdx = choices[Math.floor(Math.random() * choices.length)];
        botBoard.marks[botIdx] = true;
        logger.info(`[BINGO-DEBUG] button click | game=${game.id} player=${game.opponentId} cell=${botIdx}`);
        if (isWin(botBoard.marks)) {
          logger.info(`[BINGO-DEBUG] win detection | game=${game.id} winner=${game.opponentId}`);
          game.status = 'ended';
          activeBingoGames.delete(game.id);
          if (game.expireTimer) clearTimeout(game.expireTimer);
          return interaction.update({
            embeds: [gameEmbed(game, '🏆 Bot wins!')],
            components: [],
          });
        }
      }
      game.turnUserId = game.hostId;
      logger.info(`[BINGO-DEBUG] turn update | game=${game.id} turn=${game.turnUserId}`);
    }

    scheduleExpire(game);
    return interaction.update({
      embeds: [gameEmbed(game)],
      components: buildBoardRows(game),
    });
  }

  return interaction.reply({ embeds: [errorEmbed('Unknown Bingo interaction.')], flags: 64 });
}
