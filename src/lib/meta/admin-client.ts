import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Meta channel credentials and inbound identity mappings are server-only.
// The API routes authenticate the caller first, then use this client with an
// explicit account_id filter for the small set of account-scoped operations.
let adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return adminClient;
}
