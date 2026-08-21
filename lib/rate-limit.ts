/**
 * Fixed-window rate limiting for abuse-prone endpoints (login, signup).
 *
 * Uses Upstash Redis (REST API) when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are
 * configured so limits hold across serverless instances. Falls back to a per-process memory
 * store for local development and tests; the memory store still slows single-instance abuse
 * but is not a durable production control on its own.
 */

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type MemoryWindow = {
  count: number;
  resetAtMs: number;
};

const memoryWindows = new Map<string, MemoryWindow>();

function getUpstashConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function consumeFromMemory(key: string, limit: number, windowSeconds: number): RateLimitDecision {
  const now = Date.now();
  const existing = memoryWindows.get(key);

  if (!existing || existing.resetAtMs <= now) {
    memoryWindows.set(key, { count: 1, resetAtMs: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

async function consumeFromUpstash(
  config: { url: string; token: string },
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitDecision | null> {
  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds), "NX"],
        ["TTL", key]
      ]),
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const results = (await response.json()) as Array<{ result?: unknown }>;
    const count = Number(results[0]?.result);
    const ttl = Number(results[2]?.result);
    if (!Number.isFinite(count)) {
      return null;
    }

    const retryAfterSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : windowSeconds;
    if (count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  } catch {
    return null;
  }
}

/** Reports whether a key is currently over its limit without recording an attempt. */
export async function peekRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitDecision> {
  const namespacedKey = `skillmatch:ratelimit:${input.key}`;
  const upstash = getUpstashConfig();

  if (upstash) {
    try {
      const response = await fetch(`${upstash.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstash.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([
          ["GET", namespacedKey],
          ["TTL", namespacedKey]
        ]),
        cache: "no-store"
      });

      if (response.ok) {
        const results = (await response.json()) as Array<{ result?: unknown }>;
        const count = Number(results[0]?.result ?? 0);
        const ttl = Number(results[1]?.result);
        const retryAfterSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : input.windowSeconds;
        if (Number.isFinite(count) && count >= input.limit) {
          return { allowed: false, remaining: 0, retryAfterSeconds };
        }
        return { allowed: true, remaining: input.limit - (Number.isFinite(count) ? count : 0), retryAfterSeconds: 0 };
      }
    } catch {
      // Fall through to the memory store below.
    }
  }

  const now = Date.now();
  const existing = memoryWindows.get(namespacedKey);
  if (!existing || existing.resetAtMs <= now) {
    return { allowed: true, remaining: input.limit, retryAfterSeconds: 0 };
  }

  if (existing.count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000))
    };
  }

  return { allowed: true, remaining: input.limit - existing.count, retryAfterSeconds: 0 };
}

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitDecision> {
  const namespacedKey = `skillmatch:ratelimit:${input.key}`;
  const upstash = getUpstashConfig();

  if (upstash) {
    const decision = await consumeFromUpstash(upstash, namespacedKey, input.limit, input.windowSeconds);
    if (decision) {
      return decision;
    }
    // A Redis outage should not lock out sign-in; fall through to the memory store.
  }

  return consumeFromMemory(namespacedKey, input.limit, input.windowSeconds);
}

export async function clearRateLimit(key: string): Promise<void> {
  const namespacedKey = `skillmatch:ratelimit:${key}`;
  memoryWindows.delete(namespacedKey);

  const upstash = getUpstashConfig();
  if (upstash) {
    await fetch(`${upstash.url}/del/${encodeURIComponent(namespacedKey)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${upstash.token}` },
      cache: "no-store"
    }).catch(() => undefined);
  }
}

/** First client IP from proxy headers; empty string when unavailable. */
export function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.headers.get("x-real-ip")?.trim() ?? "";
}

export function resetRateLimitsForTests() {
  memoryWindows.clear();
}
