import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CRON_PATH_PREFIX = '/api/cron/';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(CRON_PATH_PREFIX)) {
    const secret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!secret || !token || token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/cron/:path*'],
};
