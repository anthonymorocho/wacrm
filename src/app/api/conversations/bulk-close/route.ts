import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  BulkCloseRequestError,
  parseBulkCloseRequest,
} from '@/lib/conversations/bulk-close';

/** Close several active conversations owned by the caller. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const body = await request.json().catch(() => null);

    let closeRequest;
    try {
      closeRequest = parseBulkCloseRequest(body);
    } catch (error) {
      if (error instanceof BulkCloseRequestError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // The account and assignment guards make a stale selection harmless:
    // only active conversations still owned by this agent are closed.
    const { data: updated, error: updateError } = await supabase
      .from('conversations')
      .update({ status: 'closed' })
      .eq('account_id', accountId)
      .eq('assigned_agent_id', userId)
      .in('status', ['open', 'pending'])
      .in('id', closeRequest.conversationIds)
      .select('id');

    if (updateError) {
      console.error('[bulk-close] conversation update failed:', updateError);
      return NextResponse.json(
        { error: 'Could not close the conversations' },
        { status: 500 },
      );
    }

    const closedIds = (updated ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');

    return NextResponse.json({
      closed: closedIds.length,
      conversation_ids: closedIds,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
