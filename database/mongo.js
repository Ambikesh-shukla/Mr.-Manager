import { logger } from '../bot/utils/logger.js';

// Singleton connection state:
// - mongoClient stores the shared MongoClient instance
// - mongoDb stores the selected Database instance
// - connectPromise ensures concurrent callers reuse one in-flight connect
let mongoClient;
let mongoDb;
let connectPromise;

async function createIndexes(db) {
  const indexes = [
    { collection: 'guilds', keys: { guildId: 1 }, options: { unique: true } },
    { collection: 'redeem_codes', keys: { code: 1 }, options: { unique: true } },
    { collection: 'credit_transactions', keys: { guildId: 1, createdAt: -1 }, options: {} },
  ];

  await Promise.all(indexes.map(async ({ collection, keys, options }) => {
    try {
      await db.collection(collection).createIndex(keys, options);
    } catch (error) {
      throw new Error(`Failed to create index for ${collection}`, { cause: error });
    }
  }));
}

export async function connectMongo() {
  if (mongoDb) return mongoDb;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  if (!connectPromise) {
    connectPromise = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(uri, {
        minPoolSize: 0,
        maxPoolSize: 10,
      });
      await client.connect();
      mongoClient = client;
      const dbName = process.env.MONGO_DB_NAME;
      mongoDb = dbName ? mongoClient.db(dbName) : mongoClient.db();
      await createIndexes(mongoDb);
      return mongoDb;
    })().catch(async (error) => {
      logger.error('MongoDB connection setup failed', error);
      try {
        if (mongoClient) await mongoClient.close();
      } catch (closeErr) {
        logger.error('Failed to close MongoDB client after error', closeErr);
      }
      connectPromise = null;
      mongoClient = undefined;
      mongoDb = undefined;
      throw error;
    });
  }

  return connectPromise;
}

export function getDb() {
  if (!mongoDb) {
    throw new Error('MongoDB is not connected yet. Await connectMongo() before calling getDb().');
  }
  return mongoDb;
}
