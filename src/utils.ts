import type { RateLimitIdentity } from './types';

// helper function to check if a value is valid (non null, non undefined, non empty string)
function isValidValue(value: any): value is string {
  return typeof value === 'string' && value.length > 0;
}

// parse time window string to milliseconds
export function parseTimeWindow(window: string | number): number {
  if (typeof window === 'number') return window;
  
  const match = window.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid time window format: ${window}. Use format like '1m', '1h', '1d'`
    );
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  const multipliers: Record<string, number> = {
    s: 1000,                    // seconds
    m: 60 * 1000,               // minutes
    h: 60 * 60 * 1000,          // hours
    d: 24 * 60 * 60 * 1000,     // days
  };
  
  return value * multipliers[unit];
}

// build Redis keys from identity object
// filters out null, undefined, and empty strings automatically
// respects insertion order the first non-null key you provide will be used for 'first' strategy
export function buildKeysFromIdentity(identity?: RateLimitIdentity): string[] {
  if (!identity) return [];
  
  const keys: string[] = [];
  
  // iterate over object entries in insertion order
  for (const [key, value] of Object.entries(identity)) {
    if (!isValidValue(value)) continue;
    
    switch (key) {
      case 'userId':
        keys.push(`rl:user:${value}`);
        break;
      case 'apiKey':
        keys.push(`rl:apikey:${value}`);
        break;
      case 'orgId':
        keys.push(`rl:org:${value}`);
        break;
      case 'tenantId':
        keys.push(`rl:tenant:${value}`);
        break;
      case 'ip':
        keys.push(`rl:ip:${value}`);
        break;
      case 'sessionId':
        keys.push(`rl:session:${value}`);
        break;
      case 'custom':
        keys.push(value);  // no prefix for custom keys
        break;
    }
  }
  
  return keys;
}

// build rate limit headers
export function buildRateLimitHeaders(
  result: { remaining: number; resetAt: number | null },
  limit: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
  };
  
  if (result.resetAt) {
    headers["X-RateLimit-Reset"] = new Date(result.resetAt).toISOString();
  }
  
  return headers;
}
