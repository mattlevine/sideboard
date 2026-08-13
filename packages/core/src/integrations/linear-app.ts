/**
 * Official Sideboard Linear OAuth app (linear.app/settings/api/applications).
 * Used when env / Account overrides are empty so **Connect via browser** works
 * without each user creating a Linear OAuth application.
 *
 * Client ID is public. Client Secret is optional when using PKCE (Linear allows
 * omitting it on `/token`). Same native-app tradeoff as Slack if a secret is
 * baked — do not put personal API keys here.
 *
 * Callback registered on the Linear app: http://127.0.0.1:19848/callback
 * (see LINEAR_OAUTH_REDIRECT). Enable “Public” so any Linear workspace can
 * authorize.
 */
export const BAKED_LINEAR_CLIENT_ID = '39a15abc7ea5bea17c47f47f85ff5fd0';
export const BAKED_LINEAR_CLIENT_SECRET = '';

export function hasBakedLinearOAuth(): boolean {
  return Boolean(BAKED_LINEAR_CLIENT_ID.trim());
}
