import { rateLimitCheck } from './redis';
import { parseTimeWindow, buildKeysFromIdentity, buildRateLimitHeaders } from './utils';
import type {
  RateLimitConfig,
  RateLimitIdentity,
  RateLimitResult,
  RateLimitProfileName,
  RateLimitStrategy,
} from './types';

// predefined profiles
export const RATE_LIMIT_PROFILES = {
  strict: { requests: 10, window: '1m' },
  normal: { requests: 100, window: '1m' },
  relaxed: { requests: 1000, window: '1m' },
} as const;

// execute rate limit check based on strategy
async function executeStrategy(
  keys: string[],
  limit: number,
  windowMs: number,
  strategy: RateLimitStrategy
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number | null;
  limitedBy?: string;
}> {
  if (keys.length === 0) {
    // no keys fail open
    return { allowed: true, remaining: limit, resetAt: null };
  }

  if (strategy === 'first') {
    // use first key only
    const key = keys[0];
    const result = await rateLimitCheck(key, limit, windowMs);
    return result;
  }
  
  // strategy 'all'
  // check all keys, fail if ANY exceeds
  const results = await Promise.all(
    keys.map(key => rateLimitCheck(key, limit, windowMs))
  );
  
  // find first limited key
  const limitedIndex = results.findIndex(r => !r.allowed);
  
  if (limitedIndex >= 0) {
    return {
      ...results[limitedIndex],
      limitedBy: keys[limitedIndex],
    };
  }
  
  // all passed return most restrictive remaining count
  const minRemaining = Math.min(...results.map(r => r.remaining));
  return {
    allowed: true,
    remaining: minRemaining,
    resetAt: results[0].resetAt,
  };
}

export async function rateLimit(
  req: Request,
  config: RateLimitConfig | RateLimitProfileName,
  identity?: RateLimitIdentity
): Promise<RateLimitResult> {
  // resolve config from profile or use direct config
  const resolvedConfig: RateLimitConfig = typeof config === 'string' 
    ? RATE_LIMIT_PROFILES[config] 
    : config;

  const { requests, window, strategy = 'first' } = resolvedConfig;
  const windowMs = parseTimeWindow(window);

  // build keys from identity
  const keys = buildKeysFromIdentity(identity);

  // if no keys fail open (allow request)
  if (keys.length === 0) {
    return {
      limited: false,
      response: null,
      headers: {},
      remaining: requests,
      resetAt: null,
    };
  }

  // execute rate limit check based on strategy
  const result = await executeStrategy(keys, requests, windowMs, strategy);
  const headers = buildRateLimitHeaders(result, requests);

  // if rate limited, return error response
  if (!result.allowed) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({ data: null, error: "Rate limit exceeded" }),
        { 
          status: 429, 
          headers: {
            'Content-Type': 'application/json',
            ...headers 
          }
        }
      ),
      headers,
      remaining: result.remaining,
      resetAt: result.resetAt ? new Date(result.resetAt) : null,
      limitedBy: result.limitedBy,
    };
  }

  // not rate limited, return success
  return {
    limited: false,
    response: null,
    headers,
    remaining: result.remaining,
    resetAt: result.resetAt ? new Date(result.resetAt) : null,
  };
}
