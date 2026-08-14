/**
 * Official Sideboard Linear OAuth app (linear.app/settings/api/applications).
 * Used when env / Account overrides are empty so **Connect via browser** works
 * without each user creating a Linear OAuth application.
 *
 * Client ID is public. There is no baked Client Secret — Linear PKCE does not
 * need one (unlike Slack, whose token exchange is a confidential client).
 *
 * Callback registered on the Linear app: http://127.0.0.1:19848/callback
 * (see LINEAR_OAUTH_REDIRECT). Enable “Public” so any Linear workspace can
 * authorize.
 */
export const BAKED_LINEAR_CLIENT_ID = '39a15abc7ea5bea17c47f47f85ff5fd0';

export function hasBakedLinearOAuth(): boolean {
  return Boolean(BAKED_LINEAR_CLIENT_ID.trim());
}
