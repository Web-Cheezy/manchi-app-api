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

/** Allowed absolute difference (in kobo) between Paystack charged amount and orders.total_amount. */
export const AMOUNT_TOLERANCE_KOBO = 100;

/** Convert an order total in Naira to kobo; returns null for non-finite / non-positive values. */
export function orderAmountToKobo(totalAmountNaira: unknown): number | null {
  const naira = Number(totalAmountNaira);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  return Math.round(naira * 100);
}

/**
 * Returns true when the charged amount and the order total (both in kobo)
 * are within the configured tolerance. Returns false when either is null or the
 * difference exceeds the tolerance.
 */
export function isAmountWithinTolerance(
  chargedAmountKobo: number | null | undefined,
  orderTotalKobo: number | null | undefined
): boolean {
  if (typeof chargedAmountKobo !== 'number' || !Number.isFinite(chargedAmountKobo)) return false;
  if (typeof orderTotalKobo !== 'number' || !Number.isFinite(orderTotalKobo)) return false;
  return Math.abs(chargedAmountKobo - orderTotalKobo) <= AMOUNT_TOLERANCE_KOBO;
}
