import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { randomUUID } from 'crypto';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';

const BOARD_SIZE = 5;
const MAX_NUMBER = BOARD_SIZE * BOARD_SIZE;
const GAME_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;
const BOT_KEY = 'bot';

const games = new Map();
const userToGame = new Map();
let cleanupStarted = false;
let sharedClient = null;

function touch(game) {
  game.lastActivity = Date.now();
}

function startCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  const timer = setInterval(async () => {
    const now = Date.now();
    const expired = [];
    for (const game of games.values()) {
      if (now - game.lastActivity >= GAME_TTL_MS) expired.push(game);
    }

    for (const game of expired) {
      await endGame(game, {
        title: '⌛ Bingo game expired',
        description: 'No activity for 5 minutes. Start a new game with `/bingo`.',
        color: Colors.warning,
      });
    }
  }, CLEANUP_INTERVAL_MS);

  timer.unref?.();
}

function shuffle(numbers) {
  for (let i = numbers.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function createBoard() {
  const numbers = shuffle(Array.from({ length: MAX_NUMBER }, (_, i) => i + 1));
  const rows = [];
  for (let i = 0; i < MAX_NUMBER; i += BOARD_SIZE) {
    rows.push(numbers.slice(i, i + BOARD_SIZE));
  }
  return {
    rows,
    marked: new Set(),
  };
}

function sameBoard(a, b) {
  return a.rows.flat().every((n, i) => n === b.rows.flat()[i]);
}

function createDifferentBoards() {
  const first = createBoard();
  let second = createBoard();
  while (sameBoard(first, second)) {
    second = createBoard();
  }
  return [first, second];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function boardText(board) {
  return board.rows
    .map((row) => row.map((num) => (board.marked.has(num) ? `🟩${pad(num)}` : `⬛${pad(num)}`)).join(' '))
    .join('\n');
}

function completedLines(board) {
  const has = (num) => board.marked.has(num);
  let lines = 0;

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    if (board.rows[r].every(has)) lines += 1;
  }

  for (let c = 0; c < BOARD_SIZE; c += 1) {
    let ok = true;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      if (!has(board.rows[r][c])) {
        ok = false;
        break;
      }
    }
    if (ok) lines += 1;
  }

  let diag1 = true;
  let diag2 = true;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    if (!has(board.rows[i][i])) diag1 = false;
    if (!has(board.rows[i][BOARD_SIZE - 1 - i])) diag2 = false;
  }
  if (diag1) lines += 1;
  if (diag2) lines += 1;

  return lines;
}

function winnerOf(game) {
  for (const id of Object.keys(game.boards)) {
    if (completedLines(game.boards[id]) > 0) return id;
  }
  return null;
}

function isParticipant(game, userId) {
  return game.playerIds.includes(userId);
}

function gameTitle(game) {
  if (game.mode === 'bot') return '🎲 Bingo — You vs Bot';
  return '🎲 Bingo — Player Challenge';
}

function mentionFor(id) {
  if (id === BOT_KEY) return '🤖 Bot';
  return `<@${id}>`;
}

function statusText(game) {
  if (game.status === 'pending') {
    return `Challenge sent by ${mentionFor(game.challengerId)} to ${mentionFor(game.opponentId)}.`;
  }
  return `Turn: **${mentionFor(game.turnUserId)}**`;
}

function buildGameEmbed(game, extraText = null) {
  const fields = game.playerIds.map((id) => ({
    name: `${mentionFor(id)} • Lines: ${completedLines(game.boards[id])}`,
    value: `\`\`\`\n${boardText(game.boards[id])}\n\`\`\``,
    inline: false,
  }));

  return embed({
    title: gameTitle(game),
    description: [
      statusText(game),
      '',
      '🟩 marked • ⬛ unmarked',
      extraText ?? '',
    ].filter(Boolean).join('\n'),
    color: Colors.primary,
    fields,
    footer: 'Select a number from your own board and mark it.',
    timestamp: false,
  });
}

function availableOptions(board) {
  return board.rows
    .flat()
    .filter((n) => !board.marked.has(n))
    .map((n) => ({
      label: `Mark ${pad(n)}`,
      value: String(n),
      description: `Mark ${n} on your board`,
    }));
}

function buildGameComponents(game) {
  if (game.status !== 'active') return [];

  const actorBoard = game.boards[game.turnUserId];
  const options = availableOptions(actorBoard);

  const pickRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bingo:mark_select:${game.id}`)
      .setPlaceholder(`Choose a number (${options.length} left)`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options),
  );

  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bingo:game_cancel:${game.id}`)
      .setLabel('Cancel Game')
      .setEmoji('🛑')
      .setStyle(ButtonStyle.Danger),
  );

  return [pickRow, cancelRow];
}

function ensureUserFree(userId) {
  return !userToGame.has(userId);
}

function registerGameUsers(game) {
  for (const userId of game.playerIds) {
    if (userId !== BOT_KEY) userToGame.set(userId, game.id);
  }
}

function removeGameUsers(game) {
  for (const userId of game.playerIds) {
    if (userId !== BOT_KEY && userToGame.get(userId) === game.id) userToGame.delete(userId);
  }
}

async function fetchMessage(game) {
  if (!sharedClient) return null;
  try {
    const channel = await sharedClient.channels.fetch(game.channelId);
    if (!channel?.messages) return null;
    return channel.messages.fetch(game.messageId);
  } catch {
    return null;
  }
}

async function updateGameMessage(game, payload) {
  const message = await fetchMessage(game);
  if (!message) return;
  await message.edit(payload).catch(() => {});
}

async function endGame(game, result) {
  game.status = 'ended';
  games.delete(game.id);
  removeGameUsers(game);

  await updateGameMessage(game, {
    embeds: [embed({
      title: result.title,
      description: result.description,
      color: result.color ?? Colors.info,
      fields: result.fields ?? undefined,
      timestamp: false,
    })],
    components: [],
  });
}

function makeModeComponents(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bingo:mode_bot:${userId}`).setLabel('Play vs Bot').setEmoji('🤖').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bingo:mode_pvp:${userId}`).setLabel('Challenge Player').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bingo:mode_cancel:${userId}`).setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function makeTargetComponents(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`bingo:pick_target:${userId}`)
        .setPlaceholder('Pick a player to challenge')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bingo:target_back:${userId}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bingo:mode_cancel:${userId}`).setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function challengeButtons(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bingo:challenge_accept:${gameId}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bingo:challenge_decline:${gameId}`).setLabel('Decline').setEmoji('❌').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bingo:challenge_cancel:${gameId}`).setLabel('Cancel').setEmoji('🛑').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function challengeEmbed(challengerId, opponentId) {
  return embed({
    title: '⚔️ Bingo Challenge',
    description: `<@${challengerId}> challenged <@${opponentId}> to Bingo.\n<@${opponentId}>, accept to start!`,
    color: Colors.gold,
    footer: 'Challenge expires in 5 minutes',
    timestamp: false,
  });
}

function startPvpGameState(game) {
  const [a, b] = createDifferentBoards();
  game.status = 'active';
  game.boards = {
    [game.challengerId]: a,
    [game.opponentId]: b,
  };
  game.turnUserId = game.challengerId;
  touch(game);
}

function startBotGameState(userId, channelId, messageId) {
  const [playerBoard, botBoard] = createDifferentBoards();
  const game = {
    id: randomUUID(),
    mode: 'bot',
    status: 'active',
    channelId,
    messageId,
    challengerId: userId,
    opponentId: BOT_KEY,
    playerIds: [userId, BOT_KEY],
    boards: {
      [userId]: playerBoard,
      [BOT_KEY]: botBoard,
    },
    turnUserId: userId,
    lastActivity: Date.now(),
  };
  games.set(game.id, game);
  registerGameUsers(game);
  return game;
}

async function runBotTurn(game) {
  const botBoard = game.boards[BOT_KEY];
  const options = botBoard.rows.flat().filter((n) => !botBoard.marked.has(n));
  if (options.length === 0) return null;

  const pick = options[Math.floor(Math.random() * options.length)];
  botBoard.marked.add(pick);
  touch(game);

  const winner = winnerOf(game);
  if (winner) return winner;

  game.turnUserId = game.challengerId;
  return null;
}

export async function startBingo(interaction) {
  sharedClient = interaction.client;
  startCleanup();

  if (!ensureUserFree(interaction.user.id)) {
    return interaction.reply({ embeds: [errorEmbed('You already have an active bingo game.')], flags: 64 });
  }

  await interaction.reply({
    embeds: [embed({
      title: '🎲 Bingo',
      description: 'Choose a game mode to start.',
      color: Colors.primary,
      timestamp: false,
    })],
    components: makeModeComponents(interaction.user.id),
  });
}

export async function handleBingoButton(interaction, parts) {
  sharedClient = interaction.client;
  startCleanup();

  const action = parts[1];
  const id = parts[2];

  if (action === 'mode_bot') {
    if (id !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Only the command user can choose mode.')], flags: 64 });
    if (!ensureUserFree(interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('You already have an active bingo game.')], flags: 64 });

    const game = startBotGameState(interaction.user.id, interaction.channelId, interaction.message.id);
    return interaction.update({
      embeds: [buildGameEmbed(game, `Your turn, ${mentionFor(interaction.user.id)}.`)],
      components: buildGameComponents(game),
    });
  }

  if (action === 'mode_pvp') {
    if (id !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Only the command user can choose mode.')], flags: 64 });
    if (!ensureUserFree(interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('You already have an active bingo game.')], flags: 64 });

    return interaction.update({
      embeds: [embed({
        title: '⚔️ Challenge Player',
        description: 'Select the player you want to challenge.',
        color: Colors.primary,
        timestamp: false,
      })],
      components: makeTargetComponents(interaction.user.id),
    });
  }

  if (action === 'target_back') {
    if (id !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Only the command user can use this button.')], flags: 64 });
    return interaction.update({
      embeds: [embed({
        title: '🎲 Bingo',
        description: 'Choose a game mode to start.',
        color: Colors.primary,
        timestamp: false,
      })],
      components: makeModeComponents(interaction.user.id),
    });
  }

  if (action === 'mode_cancel') {
    if (id !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Only the command user can cancel.')], flags: 64 });
    return interaction.update({
      embeds: [embed({ title: '🛑 Bingo cancelled', description: 'No game was started.', color: Colors.warning, timestamp: false })],
      components: [],
    });
  }

  if (action === 'challenge_accept' || action === 'challenge_decline' || action === 'challenge_cancel') {
    const game = games.get(id);
    if (!game) return interaction.reply({ embeds: [errorEmbed('This challenge is no longer active.')], flags: 64 });

    if (game.status !== 'pending') {
      return interaction.reply({ embeds: [errorEmbed('This challenge is already resolved.')], flags: 64 });
    }

    if (action === 'challenge_cancel') {
      if (interaction.user.id !== game.challengerId) return interaction.reply({ embeds: [errorEmbed('Only the challenger can cancel this challenge.')], flags: 64 });
      await interaction.update({
        embeds: [embed({ title: '🛑 Challenge cancelled', description: `${mentionFor(game.challengerId)} cancelled the challenge.`, color: Colors.warning, timestamp: false })],
        components: [],
      });
      games.delete(game.id);
      removeGameUsers(game);
      return;
    }

    if (interaction.user.id !== game.opponentId) {
      return interaction.reply({ embeds: [errorEmbed('Only the challenged player can respond.')], flags: 64 });
    }

    if (action === 'challenge_decline') {
      await interaction.update({
        embeds: [embed({ title: '❌ Challenge declined', description: `${mentionFor(game.opponentId)} declined the challenge.`, color: Colors.error, timestamp: false })],
        components: [],
      });
      games.delete(game.id);
      removeGameUsers(game);
      return;
    }

    if (!ensureUserFree(game.challengerId) && userToGame.get(game.challengerId) !== game.id) {
      await interaction.update({
        embeds: [embed({ title: '⚠️ Challenge expired', description: 'Challenger is now busy in another game.', color: Colors.warning, timestamp: false })],
        components: [],
      });
      games.delete(game.id);
      removeGameUsers(game);
      return;
    }

    startPvpGameState(game);
    touch(game);

    return interaction.update({
      embeds: [buildGameEmbed(game, `Game started! ${mentionFor(game.turnUserId)} goes first.`)],
      components: buildGameComponents(game),
    });
  }

  if (action === 'game_cancel') {
    const game = games.get(id);
    if (!game) return interaction.reply({ embeds: [errorEmbed('This game is no longer active.')], flags: 64 });
    if (!isParticipant(game, interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('Only game participants can interact with this game.')], flags: 64 });

    await interaction.update({
      embeds: [embed({ title: '🛑 Bingo cancelled', description: `${mentionFor(interaction.user.id)} cancelled the game.`, color: Colors.warning, timestamp: false })],
      components: [],
    });
    games.delete(game.id);
    removeGameUsers(game);
    return;
  }
}

export async function handleBingoUserSelect(interaction, parts) {
  sharedClient = interaction.client;
  startCleanup();

  const action = parts[1];
  const ownerId = parts[2];

  if (action !== 'pick_target') return;
  if (ownerId !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Only the command user can pick the target.')], flags: 64 });

  const target = interaction.users.first();
  if (!target) return interaction.reply({ embeds: [errorEmbed('Please select a valid user.')], flags: 64 });
  if (target.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('You cannot challenge yourself.')], flags: 64 });
  if (target.bot) return interaction.reply({ embeds: [errorEmbed('Use "Play vs Bot" mode to play against a bot.')], flags: 64 });

  if (!ensureUserFree(interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('You already have an active bingo game.')], flags: 64 });
  if (!ensureUserFree(target.id)) return interaction.reply({ embeds: [errorEmbed('That user already has an active bingo game.')], flags: 64 });

  const game = {
    id: randomUUID(),
    mode: 'pvp',
    status: 'pending',
    channelId: interaction.channelId,
    messageId: '',
    challengerId: interaction.user.id,
    opponentId: target.id,
    playerIds: [interaction.user.id, target.id],
    boards: {},
    turnUserId: null,
    lastActivity: Date.now(),
  };

  games.set(game.id, game);
  registerGameUsers(game);

  const challengeMsg = await interaction.channel.send({
    content: `<@${target.id}>`,
    embeds: [challengeEmbed(interaction.user.id, target.id)],
    components: challengeButtons(game.id),
    allowedMentions: { users: [target.id] },
  });

  game.messageId = challengeMsg.id;
  touch(game);

  return interaction.update({
    embeds: [embed({
      title: '✅ Challenge sent',
      description: `Challenge sent to <@${target.id}> in this channel.`,
      color: Colors.success,
      timestamp: false,
    })],
    components: [],
  });
}

export async function handleBingoStringSelect(interaction, parts) {
  sharedClient = interaction.client;
  startCleanup();

  const action = parts[1];
  const gameId = parts[2];
  if (action !== 'mark_select') return;

  const game = games.get(gameId);
  if (!game || game.status !== 'active') return interaction.reply({ embeds: [errorEmbed('This game is no longer active.')], flags: 64 });
  if (!isParticipant(game, interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('Only game participants can interact with this game.')], flags: 64 });
  if (interaction.user.id !== game.turnUserId) return interaction.reply({ embeds: [errorEmbed('It is not your turn yet.')], flags: 64 });

  const picked = Number(interaction.values[0]);
  const board = game.boards[interaction.user.id];
  if (!board || !board.rows.flat().includes(picked)) {
    return interaction.reply({ embeds: [errorEmbed('That number is not on your board.')], flags: 64 });
  }
  if (board.marked.has(picked)) {
    return interaction.reply({ embeds: [errorEmbed('That number is already marked.')], flags: 64 });
  }

  board.marked.add(picked);
  touch(game);

  const winner = winnerOf(game);
  if (winner) {
    await interaction.update({
      embeds: [embed({
        title: '🏆 Bingo Winner',
        description: `${mentionFor(winner)} wins!`,
        color: Colors.success,
        fields: [
          {
            name: `${mentionFor(game.playerIds[0])} • Lines: ${completedLines(game.boards[game.playerIds[0]])}`,
            value: `\`\`\`\n${boardText(game.boards[game.playerIds[0]])}\n\`\`\``,
            inline: false,
          },
          {
            name: `${mentionFor(game.playerIds[1])} • Lines: ${completedLines(game.boards[game.playerIds[1]])}`,
            value: `\`\`\`\n${boardText(game.boards[game.playerIds[1]])}\n\`\`\``,
            inline: false,
          },
        ],
        timestamp: false,
      })],
      components: [],
    });
    games.delete(game.id);
    removeGameUsers(game);
    return;
  }

  if (game.mode === 'bot') {
    game.turnUserId = BOT_KEY;
    const botWinner = await runBotTurn(game);

    if (botWinner) {
      await interaction.update({
        embeds: [embed({
          title: '🏆 Bingo Winner',
          description: `${mentionFor(botWinner)} wins!`,
          color: botWinner === BOT_KEY ? Colors.error : Colors.success,
          fields: [
            {
              name: `${mentionFor(game.playerIds[0])} • Lines: ${completedLines(game.boards[game.playerIds[0]])}`,
              value: `\`\`\`\n${boardText(game.boards[game.playerIds[0]])}\n\`\`\``,
              inline: false,
            },
            {
              name: `${mentionFor(game.playerIds[1])} • Lines: ${completedLines(game.boards[game.playerIds[1]])}`,
              value: `\`\`\`\n${boardText(game.boards[game.playerIds[1]])}\n\`\`\``,
              inline: false,
            },
          ],
          timestamp: false,
        })],
        components: [],
      });
      games.delete(game.id);
      removeGameUsers(game);
      return;
    }

    return interaction.update({
      embeds: [buildGameEmbed(game, 'You marked, then bot marked automatically. Your turn again.')],
      components: buildGameComponents(game),
    });
  }

  game.turnUserId = interaction.user.id === game.challengerId ? game.opponentId : game.challengerId;
  touch(game);

  return interaction.update({
    embeds: [buildGameEmbed(game, `${mentionFor(game.turnUserId)} to move.`)],
    components: buildGameComponents(game),
  });
}

export const bingoCommand = {
  data: new SlashCommandBuilder()
    .setName('bingo')
    .setDescription('Play modern interactive Bingo against bot or another player'),
  defaultLevel: 'public',
  async execute(interaction) {
    await startBingo(interaction);
  },
};
