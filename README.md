# redis-rate-limit

Granular rate limiting with sliding window for any Node.js application.
## Features

- **Framework agnostic** - Works with Next.js, Express, Fastify, or any Node.js framework
- **Sliding window algorithm** - More accurate than fixed windows
- **Multiple identity types** - Rate limit by userId, API key, IP, org, tenant, session, or custom keys
- **Flexible strategies** - Rate limit by first key or enforce limits across all keys
- **TypeScript first** - Full type safety out of the box
- **Zero dependencies** (except Redis)

## Installation

```bash
npm install redis-rate-limit redis
```

## Quick Start

```typescript
import { rateLimit } from 'redis-rate-limit';

export async function POST(req: Request) {
  // Rate limit by user ID
  const rl = await rateLimit(req, 'normal', {userId: 'user_123'});
  
  if (rl.limited) {
    return rl.response; // Returns 429 with rate limit headers
  }
  
  // Your API logic here
  return Response.json({ success: true });
}
```

## Configuration

### Environment Variables

  ```bash
  RL_REDIS_URL=redis://localhost:6379
  # or with auth
  RL_REDIS_URL=redis://username:password@host:port
  ```

### Rate Limit Profiles

Three predefined profiles are available:
- strict: 10 requests per minute
- normal: 100 requests per minute
- relaxed: 1000 requests per minute

Example with normal profile:

```typescript
  const rl = await rateLimit(req, 'normal', {
    userId: 'user_123'
  });
```

### Custom Configuration

Custom configuration instead of using a profile:

```typescript
const rl = await rateLimit(req, {
  requests: 50,
  window: '5m',      // '1s', '1m', '1h', '1d' or milliseconds
  strategy: 'first'  // 'first' or 'all'
}, {
  userId: 'user_123'
});
```

## Identity Types

The package supports multiple identity types for rate limiting:

```typescript
type RateLimitIdentity = {
  userId?: string;      // Rate limit by user ID
  apiKey?: string;      // Rate limit by API key
  orgId?: string;       // Rate limit by organization
  tenantId?: string;    // Rate limit by tenant
  ip?: string;          // Rate limit by IP address
  sessionId?: string;   // Rate limit by session
  custom?: string;      // Custom key (no prefix)
}
```

### Examples

#### Rate Limit by User ID

```typescript
const rl = await rateLimit(req, 'strict', {
  userId: session?.user?.id
});
```

#### Rate Limit by API Key

```typescript
const rl = await rateLimit(req, 'normal', {
  apiKey: req.headers.get('x-api-key')
});
```

#### Rate Limit by IP Address

```typescript
const rl = await rateLimit(req, 'relaxed', {
  ip: req.headers.get('x-forwarded-for')
});
```

#### Rate Limit by Custom Key

```typescript
const rl = await rateLimit(req, 'strict', {
  custom: `project:${projectId}:endpoint:${endpoint}`
});
```

## Strategies

### `'first'` Strategy (Default)

Rate limits by the **first provided key** in the order you specify them.

```typescript
// Example 1: apiKey is checked first
const rl = await rateLimit(req, 'normal', {
  apiKey: 'key_abc',       // This will be used (provided first)
  userId: 'user_123',      // Ignored (provided second)
});

// Example 2: userId is checked first
const rl = await rateLimit(req, 'normal', {
  userId: 'user_123',      // This will be used (provided first)
  apiKey: 'key_abc',       // Ignored (provided second)
});
```

**How it works:**
- The package respects the insertion order of properties in your identity object
- Only the first non-null, non-empty key is used for rate limiting
- This gives you full control over priority based on how you structure the object

**Best Practice:** List your properties in order of importance for your use case.

### `'all'` Strategy

Rate limits by **ALL provided keys**. Request is blocked if ANY key exceeds its limit.

```typescript
const rl = await rateLimit(req, {
  requests: 100,
  window: '1m',
  strategy: 'all'  // Check ALL keys
}, {
  userId: 'user_123',  // Checked
  apiKey: 'key_abc',   // Also checked
});

if (rl.limited) {
  console.log('Limited by:', rl.limitedBy); // Shows which key caused the limit
  return rl.response;
}
```

**Use cases for `'all'` strategy:**
- Prevent abuse across multiple dimensions
- Enforce per-user AND per-API-key limits simultaneously
- Multi-tenant applications with org-level and user-level limits

## Response Format

### `RateLimitResult` Object

```typescript
type RateLimitResult = {
  limited: boolean;              // true if rate limited
  response: Response | null;     // Ready-to-return 429 response
  headers: Record<string, string>; // Rate limit headers
  remaining: number;             // Requests remaining
  resetAt: Date | null;          // When limit resets
  limitedBy?: string;            // Which key caused limit ('all' strategy)
}
```

### Rate Limit Headers

All responses include standard rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 2024-03-31T12:00:00.000Z
```

### Error Response (429)

```json
{
  "data": null,
  "error": "Rate limit exceeded"
}
```

## Framework Integration

### Next.js App Router (with Better Auth)

```typescript
// app/api/protected/route.ts
import { rateLimit } from 'redis-rate-limit';
import { auth } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  
  const rl = await rateLimit(req, 'strict', {
    userId: session?.user?.id,
    apiKey: req.headers.get('x-api-key'),
  });
  
  if (rl.limited) return rl.response;
  
  // Your API logic here
  return Response.json({ success: true });
}
```

### Express.js Middleware

```typescript
import { rateLimit } from 'redis-rate-limit';
import express from 'express';

const app = express();

app.use(async (req, res, next) => {
  const rl = await rateLimit(req, 'normal', {
    ip: req.ip || req.headers['x-forwarded-for']?.toString()
  });
  
  // Add rate limit headers
  Object.entries(rl.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  if (rl.limited) {
    const body = await rl.response!.json();
    return res.status(429).json(body);
  }
  
  next();
});
```

## My Personal Usage

This section demonstrates how I use `redis-rate-limit` in my Next.js application with Better Auth to create modular API routes that support both API key authentication and session-based user authentication.

### Modular Route Pattern

Here's how I structure my API routes to handle both authentication methods:

```typescript
// app/api/v1/users/route.ts
import { NextResponse } from 'next/server'
import { rateLimit } from 'redis-rate-limit'
import { auth } from '@/lib/auth'
import { checkPermissions } from '@/lib/permissions'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const requestLogger = logger.child({ path: '/api/v1/users', method: 'GET' })
  
  // Step 1: Get session (handles both cookies and API keys via Better Auth)
  const session = await auth.api.getSession({ headers: req.headers })
  
  // Step 2: Rate limit using BOTH userId and API key
  // The 'first' strategy uses whichever is available
  const rl = await rateLimit(req, 'strict', {
    userId: session?.user?.id,
    apiKey: req.headers.get('x-api-key'),
  })
  if (rl.limited) return rl.response
  
  // Step 3: Permission check (reuse session from Step 1)
  const perm = await checkPermissions(req, 'GET', { session })
  if (perm.forbidden) return perm.response
  
  // Step 4: Your business logic
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    })
    
    requestLogger.info({ count: users.length }, 'Users fetched successfully')
    
    return NextResponse.json(
      { data: users, error: null },
      { headers: rl.headers }  // Include rate limit headers
    )
  } catch (err) {
    requestLogger.error({ err }, 'Failed to fetch users')
    return NextResponse.json(
      { data: null, error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}
```

### Why I Use This Pattern

1. **Flexible Rate Limiting**: By passing both `userId` and `apiKey` to `rateLimit()`, my route supports both API key and session authentication. The package automatically uses whichever is available:
   - Authenticated user with session: Rate limited by `userId`
   - API key request: Rate limited by `apiKey`
   - Both present: Uses `userId` (because it's listed first in the object)

2. **Reusable Session**: Fetch the session once and reuse it for both rate limiting and permission checks.

3. **Clean Null Handling**: No need to manually check for `null` or `undefined` - the package handles it automatically.

### Fail-Open Behavior

The package is designed to **fail open** - if Redis is unavailable or returns an error, requests are allowed through and an error is logged to the console.

## TypeScript

Full TypeScript support with exported types:

```typescript
import { 
  rateLimit, 
  RATE_LIMIT_PROFILES,
  type RateLimitConfig,
  type RateLimitIdentity,
  type RateLimitResult,
  type RateLimitStrategy,
  type RateLimitProfileName,
} from 'redis-rate-limit';
```

## How It Works

The package uses a **sliding window** algorithm implemented with Redis sorted sets:

1. Each request adds a timestamp to a sorted set
2. Old entries outside the time window are removed
3. The number of entries is counted
4. If count < limit, request is allowed
5. Otherwise, request is rate limited

This provides more accurate rate limiting than fixed windows and prevents burst issues at window boundaries.

## License

MIT
