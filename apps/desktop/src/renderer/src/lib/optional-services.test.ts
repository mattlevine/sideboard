import { describe, expect, it } from 'vitest';
import {
  emptyPublicIntegrations,
  optionalConnected,
  optionalHost,
  optionalViewerName,
  OPTIONAL_SERVICES,
} from './optional-services';

describe('optional service catalog', () => {
  it('lists Vercel, Supabase, PostHog, and Sentry', () => {
    expect(OPTIONAL_SERVICES.map((s) => s.id)).toEqual([
      'vercel',
      'supabase',
      'posthog',
      'sentry',
    ]);
    expect(OPTIONAL_SERVICES.find((s) => s.id === 'vercel')?.cli).toBe('vercel');
    expect(OPTIONAL_SERVICES.find((s) => s.id === 'vercel')?.npmPackage).toBe('vercel');
    expect(OPTIONAL_SERVICES.find((s) => s.id === 'sentry')?.npmPackage).toBe('@sentry/cli');
    expect(OPTIONAL_SERVICES.find((s) => s.id === 'posthog')?.cli).toBeUndefined();
    expect(OPTIONAL_SERVICES.find((s) => s.id === 'posthog')?.npmPackage).toBeUndefined();
  });

  it('reads public connection flags and viewer labels', () => {
    const integrations = {
      ...emptyPublicIntegrations(),
      hasVercelToken: true,
      vercelViewerName: 'matt',
      hasPosthogToken: true,
      posthogHost: 'https://eu.posthog.com',
      posthogViewerName: 'matt@acme',
    };
    expect(optionalConnected('vercel', integrations)).toBe(true);
    expect(optionalConnected('supabase', integrations)).toBe(false);
    expect(optionalViewerName('vercel', integrations)).toBe('matt');
    expect(optionalHost('posthog', integrations)).toBe('https://eu.posthog.com');
    expect(optionalViewerName('posthog', integrations)).toBe('matt@acme');
  });
});
