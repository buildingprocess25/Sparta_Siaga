import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from './lib/runtime-config';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public and PWA infrastructure assets (Must NEVER be redirected to /login)
  const isPwaOrStatic =
    pathname === '/manifest.webmanifest' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/brand/') ||
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
    '/api/auth/refresh',
    '/auth/sso/callback',
    '/brand',
    '/_next',
    '/api/health/live',
    '/api/health/ready',
    '/api/notifications/worker',
    '/api/integrations/',
  ];

  // Allow unauthenticated GET access to public VAPID key ONLY (RFC 8292 Application Server Key).
  // POST (subscription registration) and DELETE (unsubscription) remain strictly protected by session authentication.
  const isPublicVapidKeyRequest =
    pathname === '/api/notifications/push/subscribe' && request.method === 'GET';

  if (isPwaOrStatic || isPublicVapidKeyRequest || publicPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get('siaga_session')?.value;

  if (!sessionToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const jwtSecret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(sessionToken, jwtSecret);
    if (!payload || !payload.id) {
      throw new Error("Invalid session payload");
    }

    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next.js assets and PWA files:
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|manifest.json|offline.html).*)',
  ],
};
