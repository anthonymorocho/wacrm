import { describe, expect, it } from 'vitest'
import { isExistingEmailSignup } from './signup-result'

describe('isExistingEmailSignup', () => {
  it('detects Supabase’s duplicate-email response', () => {
    expect(isExistingEmailSignup({ identities: [] })).toBe(true)
  })

  it('accepts a new email with an identity', () => {
    expect(isExistingEmailSignup({ identities: [{ provider: 'email' }] })).toBe(false)
  })

  it('does not treat a missing user as a duplicate', () => {
    expect(isExistingEmailSignup(null)).toBe(false)
  })
})
