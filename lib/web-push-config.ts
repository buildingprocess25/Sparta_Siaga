import webpush from 'web-push';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// Development/testing fallback keypair (Strictly disabled in production)
const DEV_FALLBACK_PUBLIC_KEY =
  "BAh5v_2YEu78XM7VZoMKmUe0QNs2GiKb5B4fYtn14-ChYW1EpzbvbgORAat1Qux5cr2H_5lxya_UOEUdg7JcW7E";
const DEV_FALLBACK_PRIVATE_KEY =
  "dw-5D-q_3PY9j_PB9FK4KeCXT8lKBl2ZqBbaSUmt4SI";
const DEV_FALLBACK_SUBJECT =
  "mailto:sparta-siaga@alfamart.co.id";

let isConfigured = false;

/**
 * Returns the active VAPID configuration.
 * In production (NODE_ENV === 'production'), all VAPID variables MUST be explicitly provided.
 * Hardcoded development fallbacks are strictly prohibited in production.
 */
export function getVapidConfig(): VapidConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (isProd) {
    if (!privateKey || privateKey === DEV_FALLBACK_PRIVATE_KEY) {
      throw new Error(
        "[Web Push Security Error] VAPID_PRIVATE_KEY is required in production and must not use development fallback credentials."
      );
    }
    if (!publicKey || publicKey === DEV_FALLBACK_PUBLIC_KEY) {
      throw new Error(
        "[Web Push Security Error] NEXT_PUBLIC_VAPID_PUBLIC_KEY is required in production and must not use development fallback credentials."
      );
    }
    if (!subject) {
      throw new Error(
        "[Web Push Security Error] VAPID_SUBJECT is required in production (e.g. mailto:admin@domain.com)."
      );
    }
    return {
      publicKey,
      privateKey,
      subject,
    };
  }

  // Non-production (dev/test/CI) fallback for local testing
  return {
    publicKey: publicKey || DEV_FALLBACK_PUBLIC_KEY,
    privateKey: privateKey || DEV_FALLBACK_PRIVATE_KEY,
    subject: subject || DEV_FALLBACK_SUBJECT,
  };
}

/**
 * Ensures web-push is configured with VAPID credentials before sending.
 */
export function ensureWebPushConfigured(): void {
  if (isConfigured) return;
  const config = getVapidConfig();

  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    isConfigured = true;
  } catch (err) {
    console.error("[Web Push] Failed to configure VAPID details:", err);
    throw err;
  }
}

/**
 * Returns the VAPID Public Key for client-side PushManager.subscribe.
 */
export function getVapidPublicKey(): string {
  return getVapidConfig().publicKey;
}
