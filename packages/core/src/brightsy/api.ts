import { formatFetchError } from '../http/fetch.js';
import {
  loadBrightsyConfig,
  saveBrightsyConfig,
  type BrightsyLocalConfig,
} from './config.js';

export interface SideboardCloudTask {
  id: string;
  user_id: string;
  account_id: string;
  device_id: string | null;
  source_agent_id: string;
  source_chat_id: string | null;
  message: { parts?: Array<{ kind?: string; text?: string }> };
  messages?: Array<{
    role: 'cloud' | 'desktop';
    content: unknown;
    created_at?: string;
  }> | null;
  task_status: string;
  response: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

type FetchLike = typeof fetch;

type FetchInit = {
  method?: string;
  body?: unknown;
};

export type BrightsySideboardApiOptions = {
  cfg?: BrightsyLocalConfig;
  /**
   * Electron main should pass `net.fetch` (Chromium stack). Node's undici
   * `fetch` often surfaces as opaque "fetch failed" behind system proxies/VPN.
   */
  fetchImpl?: FetchLike;
};

/** Expand undici/Electron `TypeError: fetch failed` with the underlying cause. */
export const formatBrightsyFetchError = formatFetchError;

/**
 * Minimal Brightsy HTTP client using ~/.brightsy/config.json (same session as CLI).
 */
export class BrightsySideboardApi {
  private cfg: BrightsyLocalConfig;
  private readonly fetchImpl: FetchLike;

  constructor(cfgOrOpts?: BrightsyLocalConfig | BrightsySideboardApiOptions) {
    const isOpts =
      !!cfgOrOpts &&
      typeof cfgOrOpts === 'object' &&
      ('fetchImpl' in cfgOrOpts || 'cfg' in cfgOrOpts) &&
      !('access_token' in cfgOrOpts);
    if (isOpts) {
      const opts = cfgOrOpts as BrightsySideboardApiOptions;
      this.cfg = opts.cfg ?? loadBrightsyConfig();
      this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    } else {
      this.cfg = (cfgOrOpts as BrightsyLocalConfig | undefined) ?? loadBrightsyConfig();
      this.fetchImpl = globalThis.fetch.bind(globalThis);
    }
  }

  get accountId(): string {
    return this.cfg.account_id;
  }

  get endpoint(): string {
    return (this.cfg.endpoint || 'https://brightsy.ai').replace(/\/$/, '');
  }

  private async request<T>(path: string, init: FetchInit = {}): Promise<T> {
    await this.refreshIfNeeded();
    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.access_token}`,
      Accept: 'application/json',
    };
    if (init.body != null) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body != null ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      throw new Error(formatBrightsyFetchError(err, url));
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(err.error?.message ?? `${res.status} ${res.statusText} (${url})`);
    }
    return (await res.json()) as T;
  }

  private async refreshIfNeeded(): Promise<void> {
    const expiresAt = this.cfg.expires_at ?? 0;
    if (!this.cfg.refresh_token || Date.now() < expiresAt - 60_000) return;
    const clientId = this.cfg.oauth_client_id || 'brightsy-cli';
    const url = `${this.endpoint}/oauth/token`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.cfg.refresh_token,
          client_id: clientId,
        }),
      });
    } catch (err) {
      throw new Error(formatBrightsyFetchError(err, url));
    }
    if (!res.ok) return;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return;
    this.cfg.access_token = data.access_token;
    if (data.refresh_token) this.cfg.refresh_token = data.refresh_token;
    if (data.expires_in) {
      this.cfg.expires_at = Date.now() + data.expires_in * 1000;
    }
    saveBrightsyConfig(this.cfg);
  }

  async getAccess(): Promise<{ enabled: boolean; allow_always: boolean }> {
    return this.request(
      `/api/v1beta/desktop/access?accountId=${encodeURIComponent(this.accountId)}`,
    );
  }

  async setAccess(
    enabled: boolean,
    allow_always = false,
  ): Promise<{ enabled: boolean; allow_always: boolean }> {
    return this.request('/api/v1beta/desktop/access', {
      method: 'PUT',
      body: {
        accountId: this.accountId,
        enabled,
        allow_always,
      },
    });
  }

  async getTasks(status?: string): Promise<SideboardCloudTask[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('accountId', this.accountId);
    const q = `?${params.toString()}`;
    const data = await this.request<{ tasks: SideboardCloudTask[] }>(
      `/api/v1beta/desktop/tasks${q}`,
    );
    return data.tasks ?? [];
  }

  async approveTask(taskId: string): Promise<void> {
    await this.request(`/api/v1beta/desktop/tasks/${taskId}`, {
      method: 'PATCH',
      body: { action: 'approve' },
    });
  }

  async markRunning(taskId: string): Promise<void> {
    await this.request(`/api/v1beta/desktop/tasks/${taskId}`, {
      method: 'PATCH',
      body: { task_status: 'running' },
    });
  }

  async submitResponse(taskId: string, response: string): Promise<void> {
    await this.request(`/api/v1beta/desktop/tasks/${taskId}/response`, {
      method: 'POST',
      body: { response },
    });
  }
}

export function taskMessageText(task: SideboardCloudTask): string {
  const parts = task.message?.parts ?? [];
  const text = parts.find((p) => p.kind === 'text')?.text ?? '';
  return text.trim();
}
