import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import { getZernioConnection } from '@/lib/zernio/connection';
import { hasZernioCredentials } from '@/lib/zernio/profile';

/** GET /api/zernio/connection — return the current account's safe status. */
export async function GET() {
  try {
    const context = await requireRole('viewer');
    const admin = supabaseAdmin();
    const connection = await getZernioConnection(admin, context.accountId);
    return NextResponse.json({
      configured: await hasZernioCredentials(admin, context.accountId),
      connection: connection
        ? {
            id: connection.id,
            page_id: connection.facebook_page_id,
            page_name: connection.facebook_page_name,
            status: connection.status,
            connected_at: connection.connected_at,
          }
        : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
