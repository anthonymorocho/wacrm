import { describe, expect, it, vi } from 'vitest';

import {
  ZernioConnectionConflictError,
  saveZernioChannelConnection,
} from './connection';

const messengerConnection = {
  id: 'connection-fb',
  account_id: 'crm-account-1',
  user_id: 'user-1',
  meta_channel_id: 'channel-fb',
  zernio_profile_id: 'profile-1',
  zernio_account_id: 'zernio-facebook-1',
  provider: 'messenger',
  external_account_id: 'facebook-page-1',
  display_name: 'Acme Page',
  facebook_page_id: 'facebook-page-1',
  facebook_page_name: 'Acme Page',
  status: 'connected',
  connected_at: '2026-09-17T12:00:00.000Z',
  created_at: '2026-09-17T12:00:00.000Z',
  updated_at: '2026-09-17T12:00:00.000Z',
};

function makeDb(options: { zernioAccount?: Record<string, unknown> | null } = {}) {
  const calls: {
    table: string;
    operation: string;
    filters: Record<string, string>;
    payload?: Record<string, unknown>;
    onConflict?: string;
  }[] = [];
  const from = vi.fn((table: string) => {
    const filters: Record<string, string> = {};
    let operation = 'select';
    let payload: Record<string, unknown> | undefined;
    let onConflict: string | undefined;
    const call = { table, operation, filters, payload, onConflict };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    builder.select = vi.fn(chain);
    builder.eq = vi.fn((column: string, value: string) => {
      filters[column] = value;
      return builder;
    });
    builder.update = vi.fn((value: Record<string, unknown>) => {
      operation = 'update';
      call.operation = operation;
      payload = value;
      call.payload = value;
      return builder;
    });
    builder.upsert = vi.fn(
      (value: Record<string, unknown>, args?: { onConflict?: string }) => {
        operation = 'upsert';
        call.operation = operation;
        payload = value;
        onConflict = args?.onConflict;
        call.payload = value;
        call.onConflict = onConflict;
        return builder;
      }
    );
    builder.maybeSingle = vi.fn(async () => {
      if (table !== 'zernio_connections') return { data: null, error: null };
      if (filters.zernio_account_id) {
        return { data: options.zernioAccount ?? null, error: null };
      }
      if (filters.provider === 'messenger') {
        return { data: messengerConnection, error: null };
      }
      return { data: null, error: null };
    });
    builder.single = vi.fn(async () => {
      if (table === 'meta_channels') {
        return { data: { id: 'channel-ig' }, error: null };
      }
      return {
        data: {
          id: 'connection-ig',
          ...payload,
          created_at: '2026-09-24T12:00:00.000Z',
          updated_at: '2026-09-24T12:00:00.000Z',
        },
        error: null,
      };
    });

    return builder;
  });

  return { from, calls };
}

describe('saveZernioChannelConnection', () => {
  it('adds Instagram beside Messenger under the same CRM account', async () => {
    const db = makeDb();

    const result = await saveZernioChannelConnection(db as never, {
      accountId: 'crm-account-1',
      userId: 'user-1',
      profileId: 'profile-1',
      zernioAccountId: 'zernio-instagram-1',
      provider: 'instagram',
      externalAccountId: 'zernio-instagram-1',
      displayName: 'Acme IG',
    });

    expect(result).toMatchObject({
      provider: 'instagram',
      account_id: 'crm-account-1',
      zernio_account_id: 'zernio-instagram-1',
      meta_channel_id: 'channel-ig',
    });
    expect(db.calls.find((call) => call.table === 'meta_channels')).toMatchObject({
      operation: 'upsert',
      onConflict: 'account_id,provider,external_account_id',
      payload: {
        provider: 'instagram',
        integration_source: 'zernio',
        external_account_id: 'zernio-instagram-1',
      },
    });
    expect(db.calls.find((call) => call.table === 'zernio_connections' && call.operation === 'upsert')).toMatchObject({
      operation: 'upsert',
      onConflict: 'account_id,provider',
      payload: { provider: 'instagram' },
    });
    expect(db.calls.some((call) => call.operation === 'update')).toBe(false);
  });

  it('rejects a Zernio account id already mapped to a different provider', async () => {
    const db = makeDb({ zernioAccount: messengerConnection });

    await expect(
      saveZernioChannelConnection(db as never, {
        accountId: 'crm-account-1',
        userId: 'user-1',
        profileId: 'profile-1',
        zernioAccountId: 'zernio-facebook-1',
        provider: 'instagram',
        externalAccountId: 'zernio-facebook-1',
        displayName: 'Acme IG',
      })
    ).rejects.toBeInstanceOf(ZernioConnectionConflictError);

    expect(db.calls.some((call) => call.table === 'meta_channels')).toBe(false);
  });
});
