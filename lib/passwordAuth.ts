const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(password: unknown): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { ok: true, password };
}

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;
