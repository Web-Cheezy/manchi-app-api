
/**
 * Normalizes location strings to match admin configuration.
 * Maps full addresses to short codes like 'Chasemall' or 'Aurora'.
 */
export function normalizeLocation(input: string | undefined | null): string {
  if (!input) return 'Chasemall'; // Default fallback

  const lowerInput = input.toLowerCase();

  if (lowerInput.includes('chasemall')) {
    return 'Chasemall';
  } else if (lowerInput.includes('aurora')) {
    return 'Aurora';
  }

  // If it doesn't match known patterns, return as is (or default to Chasemall if strict)
  // For now, we'll return the input to avoid data loss, but ideally it should match one of the above.
  return input; 
}
