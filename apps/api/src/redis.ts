import { Redis } from "ioredis";
import { config } from "./config.js";

export const publisher = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
export const subscriber = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
publisher.on("error", (error) => console.error({ err: error.message }, "Redis publisher error"));
subscriber.on("error", (error) => console.error({ err: error.message }, "Redis subscriber error"));
