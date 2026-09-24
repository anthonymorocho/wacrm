import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import { getZernioConnections } from '@/lib/zernio/connection';
import { hasZernioCredentials } from '@/lib/zernio/profile';

/** GET /api/zernio/connection — return the current account's safe status. */
export async function GET() {
  try {
    const context = await requireRole('viewer');
    const admin = supabaseAdmin();
    const connections = await getZernioConnections(admin, context.accountId);
    return NextResponse.json({
      configured: await hasZernioCredentials(admin, context.accountId),
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        display_name: connection.display_name,
        status: connection.status,
        connected_at: connection.connected_at,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
