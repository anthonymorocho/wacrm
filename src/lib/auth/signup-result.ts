type SignupUser = {
  identities?: unknown[] | null
}

/**
 * Supabase intentionally does not return an error when signUp receives an
 * existing email. With email enumeration protection enabled it returns a
 * user whose identities array is empty instead.
 */
export function isExistingEmailSignup(user: SignupUser | null | undefined): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0
}
