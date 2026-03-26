import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meta/connect
 * Handles the OAuth redirect from Meta after the user grants permissions.
 * Exchanges the `code` parameter for a long-lived user access token.
 *
 * This is an internal-tool flow — after exchange, the token should be stored
 * in environment variables (Vercel dashboard or .env.local) rather than in DB.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorReason = searchParams.get('error_reason');

  if (error ?? errorReason) {
    return NextResponse.json(
      { ok: false, error: error ?? 'oauth_error', reason: errorReason ?? '' },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { ok: false, error: 'Missing code parameter' },
      { status: 400 },
    );
  }

  const appId = process.env.META_APP_ID ?? '';
  const appSecret = process.env.META_APP_SECRET ?? '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/meta/connect`;

  if (!appId || !appSecret) {
    return NextResponse.json(
      { ok: false, error: 'META_APP_ID or META_APP_SECRET is not configured' },
      { status: 500 },
    );
  }

  const tokenUrl = new URL('https://graph.facebook.com/v23.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const response = await fetch(tokenUrl.toString());
  const data = await response.json() as Record<string, unknown>;

  if (!response.ok || data.error) {
    return NextResponse.json(
      { ok: false, error: 'Token exchange failed', detail: data },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'Token exchange successful. Copy the access_token to your environment variables.',
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
  });
}
