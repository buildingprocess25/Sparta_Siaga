import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession } from './lib/jwt';
import { hasCurrentRefreshEnvironment } from './lib/session-environment';
import { isGateRequired, hasVerifiedGate } from './lib/environment-policy';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/internal/sparta/provision' && request.method === 'POST') {
    return NextResponse.next();
  }

  // 1. Public and PWA infrastructure assets (Must NEVER be redirected to /login)
  const isPwaOrStatic =
    pathname === '/manifest.webmanifest' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/_next') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.webmanifest');

  const publicPrefixes = [
    '/login',
    '/api/auth/login',
    '/api/auth/quick-login',
    '/api/auth/env-status',
    '/api/auth/refresh',
    '/auth/sso/callback',
    '/api/health/live',
    '/api/health/ready',
    '/api/notifications/worker',
    '/api/integrations/',
  ];

  // Allow unauthenticated GET access to public VAPID key ONLY (RFC 8292 Application Server Key).
  // POST (subscription registration) and DELETE (unsubscription) remain strictly protected by session authentication.
  const isPublicVapidKeyRequest =
    pathname === '/api/notifications/push/subscribe' && request.method === 'GET';

  const machineRoute = pathname === '/api/health/live' || pathname === '/api/health/ready' ||
    pathname === '/api/notifications/worker' || pathname.startsWith('/api/integrations/');
  const gateEntry = pathname === '/login' || pathname === '/api/auth/env-status' || pathname === '/api/auth/gate-verify';
  if (isPwaOrStatic || machineRoute || gateEntry) return NextResponse.next();
  if (isGateRequired(request) && !hasVerifiedGate(request)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'GATE_VERIFICATION_REQUIRED' }, { status: 403 });
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (isPublicVapidKeyRequest || publicPrefixes.some((p) => pathname === p)) return NextResponse.next();

  const sessionToken = request.cookies.get('siaga_session')?.value;
  const refreshToken = request.cookies.get('siaga_refresh')?.value;

  // 2. If valid short-lived access token is present, allow immediately
  if (sessionToken) {
    try {
      const payload = await verifySession(sessionToken);
      if (payload && payload.id) {
        return NextResponse.next();
      }
    } catch {
      // Access token expired; fall through to evaluate refresh token
    }
  }

  // 3. If access token is expired or missing but 30-day refresh token exists:
  // Allow pass-through so API routes (via getSessionUser) or client shell (via /api/auth/refresh)
  // can transparently renew the session without an abrupt forced logout.
  if (hasCurrentRefreshEnvironment(refreshToken)) {
    return NextResponse.next();
  }

  // 4. Neither session nor refresh token exists: deny unauthenticated access
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next.js assets and PWA files:
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|manifest.json|offline.html).*)',
  ],
};
