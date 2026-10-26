import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isIP } from "node:net";
import { getVapidPublicKey } from "@/lib/web-push-config";
import { 
  savePushSubscription, 
  deletePushSubscription,
  ensurePushSubscriptionTable 
} from "@/lib/web-push-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/push/subscribe
 * Exposes the active VAPID Public Key for client-side PushManager.subscribe.
 */
export async function GET() {
  try {
    const publicKey = getVapidPublicKey();
    return NextResponse.json({
      success: true,
      publicKey,
    });
  } catch (err: unknown) {
    console.error("[GET /api/notifications/push/subscribe]", err);
    return NextResponse.json(
      { error: "Gagal memuat kunci publik VAPID." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/push/subscribe
 * Registers or updates a user push subscription.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized: Sesi diperlukan." }, { status: 401 });
    }

    const body = await request.json();
    const { endpoint, keys } = body;

    if (
      typeof endpoint !== "string" ||
      typeof keys?.p256dh !== "string" ||
      typeof keys?.auth !== "string" ||
      endpoint.length > 4096
    ) {
      return NextResponse.json(
        { error: "Payload push subscription tidak valid (endpoint, p256dh, auth wajib ada)." },
        { status: 400 }
      );
    }

    // Endpoints come from the browser Push API and must target valid public HTTPS push services.
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      return NextResponse.json({ error: "URL endpoint push tidak valid." }, { status: 400 });
    }
    const host = endpointUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      endpointUrl.protocol !== "https:" ||
      Boolean(endpointUrl.username || endpointUrl.password) ||
      isIP(host) !== 0 ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      !host.includes(".")
    ) {
      return NextResponse.json(
        { error: "Endpoint push harus berupa layanan HTTPS publik yang valid." },
        { status: 400 }
      );
    }

    const decodedKey = (value: string) => {
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
      return Buffer.from(value, "base64url");
    };
    if (decodedKey(keys.p256dh)?.length !== 65 || decodedKey(keys.auth)?.length !== 16) {
      return NextResponse.json(
        { error: "Kunci subscription push tidak valid (p256dh/auth)." },
        { status: 400 }
      );
    }

    const userAgent = request.headers.get("user-agent") || null;
    const subId = await savePushSubscription({
      userId: sessionUser.id,
      branch: sessionUser.branch || null,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      message: "Push subscription berhasil didaftarkan.",
      data: {
        subscriptionId: subId,
        userId: sessionUser.id,
      },
    });
  } catch (err: unknown) {
    console.error("[POST /api/notifications/push/subscribe]", err instanceof Error ? err.message : "Internal Error");
    return NextResponse.json({ error: "Gagal menyimpan subscription push." }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/push/subscribe
 * Unsubscribes a user device push subscription.
 */
export async function DELETE(request: Request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized: Sesi diperlukan." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const endpoint = body.endpoint || new URL(request.url).searchParams.get("endpoint");

    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json(
        { error: "Endpoint push wajib disertakan untuk unregister." },
        { status: 400 }
      );
    }

    const deleted = await deletePushSubscription(endpoint, sessionUser.id);

    return NextResponse.json({
      success: true,
      deleted,
      message: deleted
        ? "Push subscription berhasil dihapus (unsubscribed)."
        : "Subscription tidak ditemukan atau telah dihapus sebelumnya.",
    });
  } catch (err: unknown) {
    console.error("[DELETE /api/notifications/push/subscribe]", err instanceof Error ? err.message : "Internal Error");
    return NextResponse.json({ error: "Gagal menghapus subscription push." }, { status: 500 });
  }
}
