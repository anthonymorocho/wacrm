import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ZernioConnectionConflictError,
  saveZernioMessengerConnection,
} from './connection';

function makeDb(existingByAccount: unknown, existingByZernioAccount: unknown) {
  const calls: { table: string; filters: Record<string, string> }[] = [];
  const from = vi.fn((table: string) => {
    const filters: Record<string, string> = {};
    calls.push({ table, filters });
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      maybeSingle: vi.fn(() => {
        if (table !== 'zernio_connections') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({
          data:
            filters.zernio_account_id !== undefined
              ? existingByZernioAccount
              : existingByAccount,
          error: null,
        });
      }),
    };
    return builder;
  });

  return { from, calls };
}

describe('saveZernioMessengerConnection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rejects a Zernio account already linked to another CRM account', async () => {
    const db = makeDb(null, {
      account_id: 'other-crm-account',
      zernio_profile_id: 'other-profile',
      zernio_account_id: 'zernio-account-1',
    });

    await expect(
      saveZernioMessengerConnection(db as never, {
        accountId: 'account-1',
        userId: 'user-1',
        profileId: 'profile-1',
        zernioAccountId: 'zernio-account-1',
        facebookPageId: 'page-1',
        facebookPageName: 'Acme Page',
      })
    ).rejects.toBeInstanceOf(ZernioConnectionConflictError);

    expect(db.from).toHaveBeenCalledTimes(2);
    expect(db.calls.every((call) => call.table === 'zernio_connections')).toBe(
      true
    );
  });
});
