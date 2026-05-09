import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { connectMongo, getDb } from '../database/mongo.js';
import { logger } from '../bot/utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REDEEM_CODES_PATH = join(__dirname, '../config/redeemCodes.json');
const REDEEM_CODES_COLLECTION = 'redeem_codes';
const GUILDS_COLLECTION = 'guilds';
const PLAN_REWARDS = Object.freeze({
  core: 200,
  pro: -1,
});
const PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

async function getDbWithReconnect() {
  try {
    return getDb();
  } catch {
    try {
      await connectMongo();
      return getDb();
    } catch {
      return null;
    }
  }
}

function normalizeCode(code) {
  return String(code ?? '').trim().toLowerCase();
}

function normalizeSeedCode(rawCode) {
  const code = normalizeCode(rawCode?.code);
  const plan = String(rawCode?.plan ?? '').trim().toLowerCase();
  if (!code || !plan || !(plan in PLAN_REWARDS)) return null;

  const expiresAt = rawCode?.expiresAt ? new Date(rawCode.expiresAt) : null;
  return {
    code,
    plan,
    credits: Number.isFinite(rawCode?.credits) ? rawCode.credits : PLAN_REWARDS[plan],
    maxUses: Number.isFinite(rawCode?.maxUses) ? Math.max(0, rawCode.maxUses) : 0,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    active: rawCode?.active !== false,
  };
}

export async function loadRedeemCodesFromConfig() {
  const raw = await readFile(REDEEM_CODES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const codes = Array.isArray(parsed?.codes) ? parsed.codes : [];
  return codes.map(normalizeSeedCode).filter(Boolean);
}

export async function syncRedeemCodesFromSeed() {
  const db = await getDbWithReconnect();
  if (!db) {
    logger.warn('Skipping redeem code seed sync because MongoDB is not connected.');
    return { synced: 0, inserted: 0 };
  }

  const seedCodes = await loadRedeemCodesFromConfig();
  if (seedCodes.length === 0) return { synced: 0, inserted: 0 };

  const now = new Date();
  const operations = seedCodes.map((seed) => ({
    updateOne: {
      filter: { code: seed.code },
      update: {
        $setOnInsert: {
          ...seed,
          usedCount: 0,
          redemptions: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      upsert: true,
    },
  }));

  const result = await db.collection(REDEEM_CODES_COLLECTION).bulkWrite(operations, { ordered: false });
  const inserted = result?.upsertedCount ?? 0;
  logger.info(`[REDEEM] Seed sync complete (${inserted} new / ${seedCodes.length} total)`);
  return { synced: seedCodes.length, inserted };
}

export async function redeemCodeForGuild({ code, guildId, userId }) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return { ok: false, reason: 'invalid_code' };

  const db = await getDbWithReconnect();
  if (!db) {
    return { ok: false, reason: 'storage_unavailable' };
  }

  const now = new Date();
  const codesCollection = db.collection(REDEEM_CODES_COLLECTION);

  let existing = await codesCollection.findOne({ code: normalizedCode });
  if (!existing) {
    try {
      await syncRedeemCodesFromSeed();
      existing = await codesCollection.findOne({ code: normalizedCode });
    } catch (err) {
      logger.warn('[REDEEM] Failed to sync/reload redeem codes before validation', err);
    }
  }
  if (!existing) return { ok: false, reason: 'not_found' };
  if (!existing.active) return { ok: false, reason: 'inactive' };

  if (existing.expiresAt) {
    const expiresAt = new Date(existing.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return { ok: false, reason: 'expired' };
  }

  const maxUses = Number.isFinite(existing.maxUses) ? existing.maxUses : 0;
  const usedCount = Number.isFinite(existing.usedCount) ? existing.usedCount : 0;
  if (maxUses > 0 && usedCount >= maxUses) return { ok: false, reason: 'max_uses_reached' };

  const plan = String(existing.plan ?? '').toLowerCase();
  if (!(plan in PLAN_REWARDS)) return { ok: false, reason: 'invalid_plan' };

  const redemptionRecord = {
    guildId,
    redeemedBy: userId,
    redeemedAt: now,
  };

  const atomicResult = await codesCollection.findOneAndUpdate(
    {
      code: normalizedCode,
      active: true,
      $and: [
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
        {
          $or: [
            { maxUses: { $exists: false } },
            { maxUses: { $lte: 0 } },
            {
              $expr: {
                $lt: [
                  { $ifNull: ['$usedCount', 0] },
                  '$maxUses',
                ],
              },
            },
          ],
        },
      ],
    },
    {
      $inc: { usedCount: 1 },
      $push: { redemptions: redemptionRecord },
      $set: { updatedAt: now },
    },
    { returnDocument: 'after' },
  );

  if (!atomicResult) {
    return { ok: false, reason: 'max_uses_reached' };
  }

  const planExpiresAt = new Date(now.getTime() + PLAN_DURATION_MS);
  const credits = Number.isFinite(existing.credits) ? existing.credits : PLAN_REWARDS[plan];
  await db.collection(GUILDS_COLLECTION).updateOne(
    { guildId },
    {
      $set: {
        guildId,
        plan,
        credits,
        planExpiresAt,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        totalUsed: 0,
      },
    },
    { upsert: true },
  );

  return {
    ok: true,
    code: normalizedCode,
    plan,
    credits,
    planExpiresAt,
    usedCount: atomicResult.usedCount ?? (usedCount + 1),
    maxUses: atomicResult.maxUses ?? maxUses,
  };
}
