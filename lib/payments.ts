/** Paystack transaction statuses treated as paid (matches foodbackend admin panel). */
export const PAID_TRANSACTION_STATUSES = ['success', 'completed'] as const;

export function isPaidTransaction(status: string): boolean {
  return PAID_TRANSACTION_STATUSES.includes(
    status.toLowerCase() as (typeof PAID_TRANSACTION_STATUSES)[number]
  );
}

/**
 * Resolve order id from transaction / Paystack metadata.
 * Accepts orderId (preferred), order_id, orderID, order — string or number.
 */
export function extractOrderIdFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const raw = m.orderId ?? m.order_id ?? m.orderID ?? m.order;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
