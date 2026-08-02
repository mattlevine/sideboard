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
    role: 'cloud' | 'sideboard';
    content: unknown;
    created_at?: string;
  }> | null;
  task_status: string;
  response: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

type FetchInit = {
  method?: string;
  body?: unknown;
};

/**
 * Minimal Brightsy HTTP client using ~/.brightsy/config.json (same session as CLI).
 */
export class BrightsySideboardApi {
  private cfg: BrightsyLocalConfig;

  constructor(cfg?: BrightsyLocalConfig) {
    this.cfg = cfg ?? loadBrightsyConfig();
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
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.cfg.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(err.error?.message ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  private async refreshIfNeeded(): Promise<void> {
    const expiresAt = this.cfg.expires_at ?? 0;
    if (!this.cfg.refresh_token || Date.now() < expiresAt - 60_000) return;
    const clientId = this.cfg.oauth_client_id || 'brightsy-cli';
    const res = await fetch(`${this.endpoint}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.cfg.refresh_token,
        client_id: clientId,
      }),
    });
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
      `/api/v1beta/sideboard/access?accountId=${encodeURIComponent(this.accountId)}`,
    );
  }

  async setAccess(
    enabled: boolean,
    allow_always = false,
  ): Promise<{ enabled: boolean; allow_always: boolean }> {
    return this.request('/api/v1beta/sideboard/access', {
      method: 'PUT',
      body: {
        accountId: this.accountId,
        enabled,
        allow_always,
      },
    });
  }

  async getTasks(status?: string): Promise<SideboardCloudTask[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await this.request<{ tasks: SideboardCloudTask[] }>(
      `/api/v1beta/sideboard/tasks${q}`,
    );
    return data.tasks ?? [];
  }

  async approveTask(taskId: string): Promise<void> {
    await this.request(`/api/v1beta/sideboard/tasks/${taskId}`, {
      method: 'PATCH',
      body: { action: 'approve' },
    });
  }

  async markRunning(taskId: string): Promise<void> {
    await this.request(`/api/v1beta/sideboard/tasks/${taskId}`, {
      method: 'PATCH',
      body: { task_status: 'running' },
    });
  }

  async submitResponse(taskId: string, response: string): Promise<void> {
    await this.request(`/api/v1beta/sideboard/tasks/${taskId}/response`, {
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
