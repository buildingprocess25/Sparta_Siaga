/**
 * SPARTA SIAGA — PWA Native Web Push Client Helper
 * Supports Android Chrome, iOS 16.4+ Safari PWA (Standalone), and Desktop browsers.
 */

/**
 * Converts a base64url-encoded string to a Uint8Array for PushManager.subscribe.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks whether the current browser environment supports native Web Push.
 */
export function isPushManagerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Detects whether the current device is iOS running in Standalone PWA mode.
 * On iOS, Web Push is ONLY supported when added to Home Screen (standalone).
 */
export function isIosStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return isIos && isStandalone;
}

/**
 * Retrieves the active PushSubscription from the service worker registration.
 */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushManagerSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn("[PWA Push Client] Error getting current subscription:", err);
    return null;
  }
}

let inFlightRegistrationPromise: Promise<{
  success: boolean;
  subscription?: PushSubscription;
  error?: string;
}> | null = null;

/**
 * Subscribes the current device/browser to Web Push and syncs subscription with the server.
 * Implements single-flight deduplication to avoid redundant concurrent requests.
 */
export async function registerPushSubscription(): Promise<{
  success: boolean;
  subscription?: PushSubscription;
  error?: string;
}> {
  if (!isPushManagerSupported()) {
    return { success: false, error: "Web Push tidak didukung pada browser ini." };
  }

  if (inFlightRegistrationPromise) {
    return inFlightRegistrationPromise;
  }

  inFlightRegistrationPromise = (async () => {
    try {
      // 1. Request notification permission if not yet granted
      const permission = Notification.permission === 'granted' 
        ? 'granted' 
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        return { success: false, error: "Izin notifikasi ditolak oleh pengguna." };
      }

      // 2. Fetch VAPID public key from backend with retry
      let keyRes: Response | null = null;
      let keyData: { success?: boolean; publicKey?: string; error?: string } | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          keyRes = await fetch('/api/notifications/push/subscribe');
          if (keyRes.ok) {
            keyData = await keyRes.json();
            if (keyData?.publicKey) break;
          }
        } catch {
          // Retry on network glitch
        }
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }

      if (!keyRes || !keyRes.ok || !keyData?.publicKey) {
        const statusSuffix = keyRes ? ` (HTTP ${keyRes.status})` : "";
        throw new Error(`Gagal mengambil kunci publik VAPID dari server${statusSuffix}.`);
      }
      const vapidPublicKey = keyData.publicKey;

      // 3. Register with PushManager
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey as unknown as BufferSource,
        });
      }

      // 4. Send subscription details to server with safe retry
      const subJson = subscription.toJSON();
      let saveRes: Response | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          saveRes = await fetch('/api/notifications/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subJson.keys?.p256dh,
                auth: subJson.keys?.auth,
              },
            }),
          });
          if (saveRes.ok) break;
          // Do not retry 401 Unauthorized or 400 Bad Request
          if (saveRes.status === 401 || saveRes.status === 400) break;
        } catch {
          // Retry on network glitch
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }

      if (!saveRes || !saveRes.ok) {
        if (saveRes?.status === 401) {
          // User is not authenticated yet; subscription is stored in PushManager and will be synced upon login
          return {
            success: false,
            subscription,
            error: "Sesi belum terautentikasi. Push subscription akan disinkronkan otomatis setelah login.",
          };
        }
        const errBody = saveRes ? await saveRes.json().catch(() => ({})) : {};
        throw new Error(errBody.error || `Gagal menyimpan subscription ke server (HTTP ${saveRes?.status || "network"}).`);
      }

      return { success: true, subscription };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Terjadi kesalahan saat mendaftarkan push notification.";
      console.error("[PWA Push Client] Registration error:", message);
      return { success: false, error: message };
    }
  })();

  try {
    return await inFlightRegistrationPromise;
  } finally {
    inFlightRegistrationPromise = null;
  }
}

/**
 * Unsubscribes the current device from Web Push and informs the server.
 */
export async function unregisterPushSubscription(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isPushManagerSupported()) {
    return { success: false, error: "Web Push tidak didukung pada browser ini." };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await fetch('/api/notifications/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch((e) => console.warn("[PWA Push Client] Server unregister warning:", e));
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal membatalkan langganan push notification.";
    console.error("[PWA Push Client] Unregister error:", err);
    return { success: false, error: message };
  }
}
