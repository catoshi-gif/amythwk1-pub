import { NextRequest } from 'next/server';
import { handleWebhookSignal } from '@/lib/server/webhook-handler.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ hookId: string }> }) {
  const { hookId } = await params;
  return handleWebhookSignal(req, hookId, 'open_long');
}
