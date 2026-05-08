import "dotenv/config";
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const INSTANCE_ID = process.env.INSTANCE_ID;

if (!INSTANCE_ID) {
  throw new Error("Missing INSTANCE_ID in .env");
}
