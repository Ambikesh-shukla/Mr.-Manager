import { getDb } from '../database/mongo.js';
import { logger } from '../bot/utils/logger.js';

const GUILDS = 'guilds';
const TRANSACTIONS = 'credit_transactions';

/**
 * Fetch the billing-relevant guild document from MongoDB.
 * Returns null if the guild has no plan on record.
 *
 * @param {string} guildId
 */
export async function getGuildInfo(guildId) {
  try {
    const db = getDb();
    return (await db.collection(GUILDS).findOne({ guildId })) ?? null;
  } catch {
    return null;
  }
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
    const db = getDb();
    const guild = await db.collection(GUILDS).findOne({ guildId });

    if (!guild) {
      return { ok: false, reason: 'no_plan' };
    }

    // Pro plan — unlimited credits; only track usage.
    if (guild.credits === -1) {
      await _logTransaction(guildId, 'deduct', actionKey, cost);
      return { ok: true, unlimited: true };
    }

    // Atomic decrement guarded by credit balance.
    const updatedDoc = await db.collection(GUILDS).findOneAndUpdate(
      { guildId, credits: { $gte: cost } },
      { $inc: { credits: -cost }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );

    if (!updatedDoc) {
      return { ok: false, reason: 'insufficient_credits' };
    }

    await _logTransaction(guildId, 'deduct', actionKey, cost);
    const remaining = Number.isFinite(updatedDoc?.credits)
      ? updatedDoc.credits
      : updatedDoc?.value?.credits;
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
    const db = getDb();
    const guild = await db.collection(GUILDS).findOne({ guildId });
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
