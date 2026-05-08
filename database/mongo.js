let mongoClient;
let mongoDb;
let connectPromise;

async function createIndexes(db) {
  await Promise.all([
    db.collection('guilds').createIndex({ guildId: 1 }, { unique: true }),
    db.collection('redeem_codes').createIndex({ code: 1 }, { unique: true }),
    db.collection('credit_transactions').createIndex({ guildId: 1, createdAt: -1 }),
  ]);
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
      mongoClient = new MongoClient(uri, {
        minPoolSize: 0,
        maxPoolSize: 10,
      });
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      await createIndexes(mongoDb);
      return mongoDb;
    })().catch((error) => {
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
    throw new Error('MongoDB is not connected. Call connectMongo() first.');
  }
  return mongoDb;
}
