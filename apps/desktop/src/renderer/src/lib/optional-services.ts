import type { OptionalServiceId, OptionalServiceSpec, PublicAppSettings } from '@sideboard-ai/core';

/** Renderer copy of the Connectors optional-service catalog (no Node imports). */
export const OPTIONAL_SERVICES: readonly OptionalServiceSpec[] = [
  {
    id: 'vercel',
    label: 'Vercel',
    hint: 'Deploys and project settings. Agents use the `vercel` CLI (`VERCEL_TOKEN`).',
    tokenPlaceholder: 'token from vercel.com/account/tokens',
    tokenDocs: 'https://vercel.com/account/tokens',
    envKey: 'VERCEL_TOKEN',
    cli: 'vercel',
    npmPackage: 'vercel',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    hint: 'Database and project management. Agents use the `supabase` CLI (`SUPABASE_ACCESS_TOKEN`).',
    tokenPlaceholder: 'sbp_…',
    tokenDocs: 'https://supabase.com/dashboard/account/tokens',
    envKey: 'SUPABASE_ACCESS_TOKEN',
    cli: 'supabase',
    npmPackage: 'supabase',
  },
  {
    id: 'posthog',
    label: 'PostHog',
    hint: 'Product analytics. No first-class CLI — agents use the HTTP API (`POSTHOG_PERSONAL_API_KEY`).',
    tokenPlaceholder: 'phx_…',
    tokenDocs: 'https://app.posthog.com/settings/user-api-keys',
    envKey: 'POSTHOG_PERSONAL_API_KEY',
    hostEnvKey: 'POSTHOG_HOST',
    defaultHost: 'https://us.posthog.com',
    hostPlaceholder: 'https://us.posthog.com',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    hint: 'Error tracking. Agents use `sentry-cli` (`SENTRY_AUTH_TOKEN`).',
    tokenPlaceholder: 'sntrys_… or auth token',
    tokenDocs: 'https://sentry.io/settings/account/api/auth-tokens/',
    envKey: 'SENTRY_AUTH_TOKEN',
    cli: 'sentry-cli',
    npmPackage: '@sentry/cli',
    hostEnvKey: 'SENTRY_URL',
    defaultHost: 'https://sentry.io',
    hostPlaceholder: 'https://sentry.io',
  },
];

export function emptyPublicIntegrations(): PublicAppSettings['integrations'] {
  return {
    hasLinearApiKey: false,
    hasLinearOAuth: false,
    hasSlackClientSecret: false,
    hasSlackAppToken: false,
    hasGithubPat: false,
    hasAbleTimeToken: false,
    hasVercelToken: false,
    hasSupabaseToken: false,
    hasPosthogToken: false,
    hasSentryToken: false,
  };
}

export function optionalConnected(
  id: OptionalServiceId,
  integrations: PublicAppSettings['integrations'],
): boolean {
  if (id === 'vercel') return Boolean(integrations.hasVercelToken);
  if (id === 'supabase') return Boolean(integrations.hasSupabaseToken);
  if (id === 'posthog') return Boolean(integrations.hasPosthogToken);
  return Boolean(integrations.hasSentryToken);
}

export function optionalViewerName(
  id: OptionalServiceId,
  integrations: PublicAppSettings['integrations'],
): string {
  if (id === 'vercel') return integrations.vercelViewerName?.trim() || '';
  if (id === 'supabase') return integrations.supabaseViewerName?.trim() || '';
  if (id === 'posthog') return integrations.posthogViewerName?.trim() || '';
  return integrations.sentryViewerName?.trim() || '';
}

export function optionalHost(
  id: OptionalServiceId,
  integrations: PublicAppSettings['integrations'],
): string {
  if (id === 'posthog') return integrations.posthogHost?.trim() || '';
  if (id === 'sentry') return integrations.sentryHost?.trim() || '';
  return '';
}
