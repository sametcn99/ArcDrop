// Failure shape shared by broker responses. Carries the fields the UI needs
// to render ArcDrop problem details without importing error classes across
// the messaging boundary (classes do not survive serialization).

export interface BrokerFailure {
  ok: false;
  /** ApiError code: NETWORK_ERROR, NOT_ARCDROP, HTTP_429, SESSION_EXPIRED, … */
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  /** Present when code is TOTP_REQUIRED. */
  challenge?: string;
  expiresAt?: string;
}
