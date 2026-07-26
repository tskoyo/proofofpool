import { NextResponse } from "next/server";

/**
 * Server-only. A fixed-window rate limiter held in process memory.
 *
 * NOTE the deliberate difference from lib/challenge.ts, which goes out of its
 * way to derive rather than store so it stays correct across restarts and
 * across multiple instances. This module does the opposite on purpose, and the
 * distinction matters:
 *
 *   - challenge.ts is a CORRECTNESS boundary. In-memory state there would be
 *     wrong on a second instance — a proof accepted by one server and rejected
 *     by another.
 *   - this is a BEST-EFFORT throttle. Losing counters on restart, or running
 *     one bucket per instance, degrades the limit; it does not break anything.
 *
 * So this is right for a single self-hosted process, which is what the public
 * demo runs on. If this app is ever moved to multi-instance serverless, the
 * limit silently becomes per-instance — replace it with a shared store rather
 * than assuming it still holds.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stop the map growing without bound when a lot of distinct IPs show up. */
function prune(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Best-effort client identity.
 *
 * Behind a tunnel (Cloudflare, ngrok) the socket address is always the tunnel,
 * so the forwarded headers are the only signal. `x-forwarded-for` is
 * client-spoofable in general — that is acceptable here because this throttles
 * accidental hammering and casual abuse, and is not an authorization boundary.
 *
 * If no header is present every caller shares the "unknown" bucket and the
 * limit becomes global. That is the safe direction to fail, but it means the
 * limits below should stay loose enough not to lock out a room of judges.
 */
function clientKey(req: Request): string {
  const forwarded = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Returns a 429 response when the caller is over budget, or null to proceed.
 *
 * Usage: `const limited = rateLimit(req, "verify", 10, 60); if (limited) return limited;`
 */
export function rateLimit(
  req: Request,
  name: string,
  limit: number,
  windowSeconds: number,
): NextResponse | null {
  const now = Date.now();
  prune(now);

  const key = `${name}:${clientKey(req)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1_000 });
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
  return NextResponse.json(
    { error: "rate limited", retry_after_seconds: retryAfter },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
