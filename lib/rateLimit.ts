import { NextRequest } from 'next/server';

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();

function nowMs() {
  return Date.now();
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  return 'unknown';
}

export function normalizeEmail(value: unknown): string {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetAt: number } {
  const t = nowMs();
  const existing = counters.get(key);

  if (!existing || existing.resetAt <= t) {
    const resetAt = t + windowMs;
    counters.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

