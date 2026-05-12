import { connectMongo, getDb } from '../database/mongo.js';
import { logger } from '../bot/utils/logger.js';
import { unwrapFindOneAndUpdateResult } from './mongoResult.js';
import { redis } from './redis.js';

const GUILDS = 'guilds';
const TRANSACTIONS = 'credit_transactions';
const DEFAULT_PLAN = 'free';
const DEFAULT_CREDITS = 50;
const CREDITS_CACHE_TTL = 60; // seconds — for read-only display only

async function getDbWithReconnect() {
  try {
    return getDb();
  } catch (err) {
    logger.warn('[BILLING] MongoDB handle unavailable, attempting reconnect.', err);
    try {
      await connectMongo();
      return getDb();
    } catch (reconnectErr) {
      logger.error('[BILLING] MongoDB reconnect failed.', reconnectErr);
      return null;
    }
  }
}

export async function ensureGuildCredits(guildId) {
  if (!guildId) return null;

  const db = await getDbWithReconnect();
  if (!db) return null;

  const now = new Date();
  const result = await db.collection(GUILDS).findOneAndUpdate(
    { guildId },
    {
      $setOnInsert: {
        guildId,
        plan: DEFAULT_PLAN,
        credits: DEFAULT_CREDITS,
        totalUsed: 0,
        planExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return unwrapFindOneAndUpdateResult(result);
}

/**
 * Fetch the billing-relevant guild document from MongoDB.
 * Returns null if the guild has no plan on record.
 *
 * @param {string} guildId
 */
export async function getGuildInfo(guildId) {
  return ensureGuildCredits(guildId);
}

/**
 * Fetch guild info with a short Redis cache (CREDITS_CACHE_TTL seconds).
 * ONLY use this for read-only display (e.g. /credits command).
 * Never use this cache to authorise or deduct credits.
 *
 * @param {string} guildId
 */
export async function getGuildInfoCached(guildId) {
  const cacheKey = `credits:cache:${guildId}`;
  try {
    const raw = await redis.get(cacheKey);
    if (raw) {
      logger.debug(`[CREDITS] Cache hit for guild ${guildId}`);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch (err) {
    logger.warn('[CREDITS] Redis cache read error, falling back to MongoDB.', err);
  }

  const info = await ensureGuildCredits(guildId);
  if (info) {
    try {
      await redis.set(cacheKey, JSON.stringify(info), { ex: CREDITS_CACHE_TTL });
    } catch (err) {
      logger.warn('[CREDITS] Redis cache write error (non-fatal).', err);
    }
  }
  return info;
}

/**
 * Atomically deduct `cost` credits from the guild.
 * - Pro plan (credits === -1): tracks usage without deducting.
 * - Standard plan: deducts atomically; fails if insufficient credits.
 *
 * @param {string} guildId
 * @param {string} actionKey
 * @param {number} [cost=1]
 * @returns {Promise<{ok:boolean, reason?:string, unlimited?:boolean, remaining?:number}>}
 */
export async function deductCredit(guildId, actionKey, cost = 1) {
  try {
    const db = await getDbWithReconnect();
    if (!db) return { ok: false, reason: 'error' };

    const guild = await ensureGuildCredits(guildId);

    if (!guild) {
      return { ok: false, reason: 'no_plan' };
    }

    // Pro plan — unlimited credits; only track usage.
    if (guild.credits === -1) {
      await db.collection(GUILDS).updateOne(
        { guildId },
        { $inc: { totalUsed: cost }, $set: { updatedAt: new Date() } },
      );
      await _logTransaction(guildId, 'deduct', actionKey, cost);
      logger.info(`[CREDITS] Unlimited plan usage tracked for guild ${guildId} action "${actionKey}"`);
      return { ok: true, unlimited: true };
    }

    // Atomic decrement guarded by credit balance.
    const updateResult = await db.collection(GUILDS).findOneAndUpdate(
      { guildId, credits: { $gte: cost } },
      { $inc: { credits: -cost, totalUsed: cost }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    const updatedDoc = unwrapFindOneAndUpdateResult(updateResult);

    if (!updatedDoc) {
      logger.info(`[CREDITS] Insufficient credits for guild ${guildId} action "${actionKey}" (cost: ${cost})`);
      return { ok: false, reason: 'insufficient_credits' };
    }

    await _logTransaction(guildId, 'deduct', actionKey, cost);
    const remaining = updatedDoc.credits;
    logger.info(`[CREDITS] Deducted ${cost} credit(s) for guild ${guildId} action "${actionKey}" (remaining: ${remaining})`);
    return { ok: true, remaining };
  } catch (err) {
    logger.error('[BILLING] deductCredit error', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Refund `cost` credits to a guild after a failed action.
 * No-ops for Pro plan (credits = -1).
 *
 * @param {string} guildId
 * @param {string} actionKey
 * @param {number} [cost=1]
 */
export async function refundCredit(guildId, actionKey, cost = 1) {
  try {
    const db = await getDbWithReconnect();
    if (!db) return;

    const guild = await ensureGuildCredits(guildId);
    if (!guild) return;

    if (guild.credits !== -1) {
      await db.collection(GUILDS).updateOne(
        { guildId },
        { $inc: { credits: cost }, $set: { updatedAt: new Date() } },
      );
    }

    await _logTransaction(guildId, 'refund', actionKey, cost);
  } catch (err) {
    logger.error('[BILLING] refundCredit error', err);
  }
}

/**
 * Return the top N most-used billable actions for a guild.
 *
 * @param {string} guildId
 * @param {number} [limit=5]
 * @returns {Promise<Array<{actionKey:string, count:number}>>}
 */
export async function getTopActions(guildId, limit = 5) {
  try {
    const db = getDb();
    const rows = await db.collection(TRANSACTIONS).aggregate([
      { $match: { guildId, type: 'deduct' } },
      { $group: { _id: '$actionKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]).toArray();
    return rows.map(r => ({ actionKey: r._id, count: r.count }));
  } catch {
    return [];
  }
}

/**
 * Return the total number of credits consumed by a guild.
 *
 * @param {string} guildId
 * @returns {Promise<number>}
 */
export async function getTotalUsed(guildId) {
  try {
    const db = getDb();
    const [row] = await db.collection(TRANSACTIONS).aggregate([
      { $match: { guildId, type: 'deduct' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).toArray();
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _logTransaction(guildId, type, actionKey, amount) {
  try {
    const db = getDb();
    await db.collection(TRANSACTIONS).insertOne({
      guildId,
      type,
      actionKey,
      amount,
      createdAt: new Date(),
    });
  } catch (err) {
    logger.warn('[BILLING] logTransaction error', err);
  }
}
