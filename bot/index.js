import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

import { loadAll } from './storage/db.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { logger } from './utils/logger.js';
import { deployOnStartup } from './utils/deployOnStartup.js';
import { startHeartbeat } from "../utils/heartbeat.js";
import { startClusterSync } from "../utils/instanceRouter.js";
import { connectMongo } from '../database/mongo.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID } = process.env;

if (!DISCORD_BOT_TOKEN) {
  logger.error('DISCORD_BOT_TOKEN is not set. Check your .env file or environment secrets.');
  process.exit(1);
}
if (!DISCORD_APPLICATION_ID) {
  logger.error('DISCORD_APPLICATION_ID is not set. Check your .env file or environment secrets.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── Anti-crash handlers ──────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', err);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});

// ── Boot sequence ────────────────────────────────────────────────────────────
async function boot() {
  if (process.env.MONGO_URI) {
    logger.info('Connecting to MongoDB...');
    await connectMongo();
    logger.success('MongoDB connected');
  } else {
    logger.warn('MONGO_URI is not set. Starting without MongoDB.');
  }

  logger.info('Loading storage...');
  await loadAll();

  logger.info('Loading commands...');
  const commandJsons = await loadCommands(client);

  logger.info('Deploying slash commands...');
  await deployOnStartup(commandJsons);

  logger.info('Loading events...');
  await loadEvents(client);

  logger.info('Connecting to Discord...');

  startHeartbeat();
  startClusterSync();
  
  await client.login(DISCORD_BOT_TOKEN);
}

boot().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
