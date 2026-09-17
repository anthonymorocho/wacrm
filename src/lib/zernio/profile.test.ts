import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  createZernioProfile: vi.fn(),
}));

vi.mock('./client', () => client);

import { ensureZernioProfile } from './profile';

describe('ensureZernioProfile', () => {
  const selectBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const writeBuilder = {
    upsert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  const db = { from: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    selectBuilder.select.mockReturnValue(selectBuilder);
    selectBuilder.eq.mockReturnValue(selectBuilder);
    writeBuilder.upsert.mockReturnValue(writeBuilder);
    writeBuilder.select.mockReturnValue(writeBuilder);
    client.createZernioProfile.mockResolvedValue({
      _id: 'zernio-profile-1',
    });
    selectBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    writeBuilder.single.mockResolvedValue({
      data: {
        account_id: 'account-1',
        user_id: 'user-1',
        zernio_profile_id: 'zernio-profile-1',
        profile_name: 'wacrm-account-1',
      },
      error: null,
    });
    db.from
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(writeBuilder);
  });

  it('creates and stores one Zernio profile for the CRM account', async () => {
    await expect(
      ensureZernioProfile(db as never, {
        accountId: 'account-1',
        userId: 'user-1',
        accountName: 'Acme',
        apiKey: 'zernio-key',
      })
    ).resolves.toMatchObject({
      account_id: 'account-1',
      zernio_profile_id: 'zernio-profile-1',
    });

    expect(client.createZernioProfile).toHaveBeenCalledWith({
      apiKey: 'zernio-key',
      name: 'wacrm-account-1',
      description: 'Acme',
      idempotencyKey: 'wacrm-profile-account-1',
    });
    expect(writeBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        zernio_profile_id: 'zernio-profile-1',
      }),
      { onConflict: 'account_id' }
    );
  });
});
