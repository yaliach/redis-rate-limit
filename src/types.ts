// identity types, what user provides to identify the requester
export type RateLimitIdentity = {
  userId?: string | null;      // rl:user:${userId}
  apiKey?: string | null;      // rl:apikey:${apiKey}
  orgId?: string | null;       // rl:org:${orgId}
  tenantId?: string | null;    // rl:tenant:${tenantId}
  ip?: string | null;          // rl:ip:${ip}
  sessionId?: string | null;   // rl:session:${sessionId}
  custom?: string | null;      // custom key (no prefix)
};

// strategy for handling multiple keys
export type RateLimitStrategy = 
  | 'first'    // use first non null key
  | 'all';     // check all keys fail if any exceeds

// configuration
export type RateLimitConfig = {
  requests: number;
  window: string | number;        // '1m', '1h', '1d' or milliseconds
  strategy?: RateLimitStrategy;   // Default: 'first'
};

// predefined profile names
export type RateLimitProfileName = 'strict' | 'normal' | 'relaxed';

// result returned from rateLimit()
export type RateLimitResult = {
  limited: boolean;
  response: Response | null;     
  headers: Record<string, string>;
  remaining: number;
  resetAt: Date | null;
  limitedBy?: string;             
};
