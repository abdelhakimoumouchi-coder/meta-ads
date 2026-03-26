import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { writeSystemLog } from '../../../../lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meta/webhook
 * Facebook webhook verification challenge.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST /api/meta/webhook
 * Receive and store incoming Meta webhook events (leads, conversions, etc.).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as Record<string, unknown>;

    await writeSystemLog({
      level: 'info',
      context: 'webhook',
      message: 'Meta webhook event received',
      meta: { object: body.object, entryCount: Array.isArray(body.entry) ? body.entry.length : 0 },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeSystemLog({
      level: 'error',
      context: 'webhook',
      message: 'Failed to process Meta webhook event',
      meta: { error: message },
    }).catch(() => undefined);

    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
