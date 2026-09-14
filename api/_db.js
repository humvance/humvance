import { Redis } from '@upstash/redis';

export const kv = new Redis({
  url: process.env.STORAGE_REST_API_URL,
  token: process.env.STORAGE_REST_API_TOKEN,
});
