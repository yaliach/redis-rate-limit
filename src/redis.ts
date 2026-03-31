import { createClient } from "redis";

let redisClient: ReturnType<typeof createClient> | null = null;
let scriptSha: string | null = null;

const SLIDING_WINDOW_SCRIPT = `
  local key        = KEYS[1]
  local limit      = tonumber(ARGV[1])
  local windowMs   = tonumber(ARGV[2])
  local now        = tonumber(ARGV[3])
  local windowStart = now - windowMs

  redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
  local count = tonumber(redis.call('ZCARD', key))

  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    redis.call('PEXPIRE', key, windowMs)
    return { 1, limit - count - 1, -1 }
  end

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = tonumber(oldest[2]) + windowMs

  return { 0, 0, resetAt }
`;

export function getRedisClient(): ReturnType<typeof createClient> {
  if (!redisClient) {
    const url = process.env.RL_REDIS_URL;
    if (!url) {
      throw new Error("RL_REDIS_URL environment variable is not set");
    }
    
    redisClient = createClient({ url });
    redisClient.on("error", (err) => 
      console.error("[@yaliach/redis-rate-limit] Redis error:", err)
    );
    redisClient.connect();
  }
  
  return redisClient;
}

export async function loadScript(): Promise<string> {
  if (!scriptSha) {
    const redis = getRedisClient();
    scriptSha = await redis.scriptLoad(SLIDING_WINDOW_SCRIPT);
  }
  return scriptSha;
}

export async function rateLimitCheck(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number | null }> {
  try {
    const redis = getRedisClient();
    const sha = await loadScript();
    const now = Date.now();

    const [allowed, remaining, resetAt] = (await redis.evalSha(sha, {
      keys: [key],
      arguments: [String(limit), String(windowMs), String(now)],
    })) as [number, number, number];

    return {
      allowed: allowed === 1,
      remaining,
      resetAt: resetAt === -1 ? null : resetAt,
    };
  } catch (err) {
    // fail open if redis fails
    console.error("[@yaliach/redis-rate-limit] Redis error, allowing request:", err);
    return {
      allowed: true,
      remaining: limit,
      resetAt: null,
    };
  }
}
