import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  BulkTransferRequestError,
  parseBulkTransferRequest,
} from '@/lib/conversations/bulk-transfer';

/** Transfer several active conversations from the caller to one teammate. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const body = await request.json().catch(() => null);

    let transfer;
    try {
      transfer = parseBulkTransferRequest(body);
    } catch (error) {
      if (error instanceof BulkTransferRequestError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (transfer.targetAgentId === userId) {
      return NextResponse.json(
        { error: 'Choose another agent as the transfer destination' },
        { status: 400 },
      );
    }

    // Validate the destination server-side. The client list is only a
    // convenience and must not be trusted for account or role membership.
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('user_id', transfer.targetAgentId)
      .in('account_role', ['owner', 'admin', 'agent'])
      .maybeSingle();

    if (targetError) {
      console.error('[bulk-transfer] destination lookup failed:', targetError);
      return NextResponse.json(
        { error: 'Could not validate the destination agent' },
        { status: 500 },
      );
    }

    if (!target) {
      return NextResponse.json(
        { error: 'Destination agent was not found in this account' },
        { status: 404 },
      );
    }

    // One account-scoped UPDATE keeps the batch consistent and the source
    // assignment guard prevents a stale selection from moving somebody
    // else's conversation after a concurrent reassignment.
    const { data: updated, error: updateError } = await supabase
      .from('conversations')
      .update({ assigned_agent_id: transfer.targetAgentId })
      .eq('account_id', accountId)
      .eq('assigned_agent_id', userId)
      .in('status', ['open', 'pending'])
      .in('id', transfer.conversationIds)
      .select('id');

    if (updateError) {
      console.error('[bulk-transfer] conversation update failed:', updateError);
      return NextResponse.json(
        { error: 'Could not transfer the conversations' },
        { status: 500 },
      );
    }

    const transferredIds = (updated ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');

    return NextResponse.json({
      transferred: transferredIds.length,
      conversation_ids: transferredIds,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
