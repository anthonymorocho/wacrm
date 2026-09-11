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

    // The RPC performs the source-assignment guard and returns updated ids
    // under SECURITY DEFINER. A normal UPDATE ... RETURNING would hide the
    // newly transferred rows from the source agent's SELECT policy.
    const { data: updated, error: updateError } = await supabase.rpc(
      'transfer_conversations',
      {
        p_target_agent_id: transfer.targetAgentId,
        p_conversation_ids: transfer.conversationIds,
      },
    );

    if (updateError) {
      console.error('[bulk-transfer] conversation update failed:', updateError);
      return NextResponse.json(
        { error: 'Could not transfer the conversations' },
        { status: 500 },
      );
    }

    const transferredIds = (updated ?? [])
      .map((row: { id?: unknown }) => row.id)
      .filter((id: unknown): id is string => typeof id === 'string');

    return NextResponse.json({
      transferred: transferredIds.length,
      conversation_ids: transferredIds,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
