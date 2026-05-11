import "dotenv/config";
import { Redis } from "@upstash/redis";

// Real Upstash Redis client
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const INSTANCE_ID = process.env.INSTANCE_ID || 'default-instance';

console.log('[REDIS] Connected to Upstash Redis');
