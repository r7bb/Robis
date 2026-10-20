import { z } from 'zod';

/**
 * What a person has agreed to, and when.
 *
 * DRAFT FOR LEGAL REVIEW: the terms and privacy pages are drafts, and so is
 * this version string. Bump it whenever either page changes in a way people
 * should be asked about again; everyone whose stored version differs is
 * asked at their next visit, and the server refuses workspace use until
 * they answer (see `assertHasAgreed`). The minimum age (16) is a
 * placeholder pending the same review.
 */
export const TERMS_VERSION = '2026-10-20';

/** The minimum age asked about. A placeholder pending the same review. */
export const MINIMUM_AGE = 16;

const termsVersionField = z.string().trim().min(1).max(32);

/** Agreeing again, after the terms changed or for an account from before. */
export const consentSchema = z.object({
  termsVersion: termsVersionField,
  /** Required as `true`, so the question cannot be skipped by omitting it. */
  ageConfirmed: z.literal(true, { message: 'Please confirm your age to continue' }),
});
export type ConsentInput = z.infer<typeof consentSchema>;

/**
 * At sign-up the form says which version it showed. Optional so an older
 * client still works; when it is sent and is not the current one, the
 * person was shown terms that no longer apply, and is asked to reload.
 */
export const signupTermsVersion = termsVersionField.optional();
