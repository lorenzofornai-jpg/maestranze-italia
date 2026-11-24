/**
 * Errore applicativo. `code` è una chiave stabile che web e app traducono nella lingua attiva.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const Errors = {
  validation: (fields: Record<string, string>) => new ApiError(400, "VALIDATION_FAILED", fields),
  invalidCredentials: () => new ApiError(401, "INVALID_CREDENTIALS"),
  emailNotVerified: () => new ApiError(403, "EMAIL_NOT_VERIFIED"),
  accountLocked: (until: Date) => new ApiError(423, "ACCOUNT_LOCKED", undefined, { until: until.toISOString() }),
  accountSuspended: () => new ApiError(403, "ACCOUNT_SUSPENDED"),
  invalidToken: () => new ApiError(400, "INVALID_OR_EXPIRED_TOKEN"),
  challengeExpired: () => new ApiError(401, "CHALLENGE_EXPIRED"),
  invalidCode: (attemptsLeft: number) => new ApiError(401, "INVALID_CODE", undefined, { attemptsLeft }),
  methodNotAvailable: () => new ApiError(400, "MFA_METHOD_NOT_AVAILABLE"),
  otpRateLimited: (retryAfterSeconds: number) => new ApiError(429, "OTP_RATE_LIMITED", undefined, { retryAfterSeconds }),
  unauthenticated: () => new ApiError(401, "UNAUTHENTICATED"),
  forbidden: () => new ApiError(403, "FORBIDDEN"),
  reauthRequired: () => new ApiError(403, "REAUTHENTICATION_REQUIRED"),
  invalidSignature: () => new ApiError(401, "INVALID_DEVICE_SIGNATURE"),
  deviceRevoked: () => new ApiError(401, "DEVICE_NOT_ACTIVE"),
  notFound: () => new ApiError(404, "NOT_FOUND"),
};
