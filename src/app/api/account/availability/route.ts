import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import type { AvailabilityStatus } from '@/lib/presence';

const AVAILABILITIES: readonly AvailabilityStatus[] = ['online', 'offline'];

export async function POST(request: Request) {
  try {
    const { supabase } = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as {
      availability?: unknown;
    } | null;
    const availability = body?.availability;

    if (
      typeof availability !== 'string' ||
      !(AVAILABILITIES as readonly string[]).includes(availability)
    ) {
      return NextResponse.json(
        { error: 'availability must be online or offline' },
        { status: 400 }
      );
    }

    const { error } = await supabase.rpc('set_agent_availability', {
      p_availability: availability,
    });

    if (error) {
      const status =
        error.code === '42501' ||
        /team agents|unauthorized/i.test(error.message)
          ? 403
          : error.code === '22023'
            ? 400
            : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ availability });
  } catch (error) {
    return toErrorResponse(error);
  }
}
