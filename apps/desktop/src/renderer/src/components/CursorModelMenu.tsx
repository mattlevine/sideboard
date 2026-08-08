import { useEffect, useState } from 'react';
import type { AgentModelInfo } from '@sideboard-ai/core';

export type AgentModelListKind = 'cursor' | 'codex' | 'opencode';

/** Process-wide cache so menus don't jump when lists resolve after open. */
const modelCache = new Map<AgentModelListKind, AgentModelInfo[]>();
const modelInflight = new Map<AgentModelListKind, Promise<AgentModelInfo[]>>();

/** Treat null / default / auto as Cursor Auto. */
export function isCursorAutoModel(model: string | null | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase();
  return !id || id === 'default' || id === 'auto';
}

export function agentModelLabel(
  model: string | null | undefined,
  models: AgentModelInfo[] | null,
  opts?: { autoId?: string | null; fallback?: string },
): string {
  const autoId = opts?.autoId ?? null;
  const isAuto =
    autoId != null
      ? !model || model === autoId || model.toLowerCase() === 'auto'
      : !model;
  if (isAuto) {
    if (autoId) {
      const auto = models?.find((m) => m.id === autoId);
      return auto?.displayName || 'Auto';
    }
    return 'Auto';
  }
  const hit = models?.find((m) => m.id === model);
  return hit?.displayName || model || opts?.fallback || 'Model';
}

export function cursorModelLabel(
  model: string | null | undefined,
  models: AgentModelInfo[] | null,
): string {
  return agentModelLabel(model, models, { autoId: 'default', fallback: 'Cursor' });
}

function listModelsFn(
  kind: AgentModelListKind,
): (() => Promise<AgentModelInfo[]>) | undefined {
  if (kind === 'cursor') return window.sideboard.listCursorModels;
  if (kind === 'codex') return window.sideboard.listCodexModels;
  if (kind === 'opencode') return window.sideboard.listOpencodeModels;
  return undefined;
}

async function fetchAgentModels(kind: AgentModelListKind): Promise<AgentModelInfo[]> {
  const cached = modelCache.get(kind);
  if (cached) return cached;
  const pending = modelInflight.get(kind);
  if (pending) return pending;

  const listFn = listModelsFn(kind);
  if (typeof listFn !== 'function') {
    throw new Error(`Restart Sideboard to load ${kind} models (preload outdated).`);
  }

  const req = listFn()
    .then((list) => {
      modelCache.set(kind, list);
      modelInflight.delete(kind);
      return list;
    })
    .catch((err) => {
      modelInflight.delete(kind);
      throw err;
    });
  modelInflight.set(kind, req);
  return req;
}

/** Warm the model cache so opening the menu does not layout-shift. */
export function prefetchAgentModels(kind?: AgentModelListKind): void {
  const kinds: AgentModelListKind[] = kind ? [kind] : ['cursor', 'codex', 'opencode'];
  for (const k of kinds) {
    if (modelCache.has(k) || modelInflight.has(k)) continue;
    void fetchAgentModels(k).catch(() => undefined);
  }
}

/** Load agent models when `enabled` (menu open or that agent is active). */
export function useAgentModels(
  kind: AgentModelListKind,
  enabled: boolean,
): {
  models: AgentModelInfo[] | null;
  loading: boolean;
  error: string | null;
} {
  const [models, setModels] = useState<AgentModelInfo[] | null>(
    () => modelCache.get(kind) ?? null,
  );
  const [loading, setLoading] = useState(() => enabled && !modelCache.has(kind));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = modelCache.get(kind);
    if (cached) {
      setModels(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    void fetchAgentModels(kind)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, enabled]);

  return { models, loading, error };
}

/** @deprecated Prefer {@link useAgentModels}('cursor', enabled). */
export function useCursorModels(enabled: boolean) {
  return useAgentModels('cursor', enabled);
}

interface AgentModelMenuItemsProps {
  /** False when another agent is selected — no row should show a check. */
  active: boolean;
  currentModel: string | null;
  models: AgentModelInfo[] | null;
  loading: boolean;
  error: string | null;
  onPick: (modelId: string | null) => void;
  /**
   * Id that means Auto in the list (Cursor uses `default`).
   * When null, Auto is a synthetic row that picks `null` model.
   */
  autoModelId?: string | null;
  /**
   * Reserve a fixed-height scroll area so async model rows cannot push
   * Brightsy / Permissions down after the menu opens.
   */
  scrollable?: boolean;
}

/** Menu rows for an agent's models (under a section header provided by caller). */
export function AgentModelMenuItems({
  active,
  currentModel,
  models,
  loading,
  error,
  onPick,
  autoModelId = null,
  scrollable = true,
}: AgentModelMenuItemsProps) {
  if (loading && !models) {
    const loadingRow = (
      <button type="button" disabled>
        <span>Loading models…</span>
      </button>
    );
    return scrollable ? (
      <div className="agent-model-list agent-model-list--async">{loadingRow}</div>
    ) : (
      loadingRow
    );
  }
  if (error && !models?.length) {
    const errRow = (
      <button type="button" disabled title={error}>
        <span>Couldn’t load models</span>
      </button>
    );
    return scrollable ? (
      <div className="agent-model-list agent-model-list--async">{errRow}</div>
    ) : (
      errRow
    );
  }

  const base = models?.length ? models : [];
  const list =
    currentModel && !base.some((m) => m.id === currentModel)
      ? [
          {
            id: currentModel,
            displayName: currentModel,
            description: 'Currently selected',
          },
          ...base,
        ]
      : base;
  const hasAutoInList =
    autoModelId != null && list.some((m) => m.id === autoModelId);
  const showSyntheticAuto = autoModelId == null || !hasAutoInList;

  const autoSelected =
    active &&
    (autoModelId != null
      ? isCursorAutoModel(currentModel) || currentModel === autoModelId
      : !currentModel);

  const body = (
    <>
      {showSyntheticAuto && (
        <button
          type="button"
          className={autoSelected ? 'selected' : ''}
          onClick={() => onPick(autoModelId)}
        >
          <span>{autoSelected ? '✓ ' : ''}Auto</span>
        </button>
      )}
      {list.map((m) => {
        if (autoModelId != null && m.id === autoModelId && showSyntheticAuto) {
          return null;
        }
        const selected =
          active &&
          (autoModelId != null && m.id === autoModelId
            ? autoSelected
            : currentModel === m.id);
        return (
          <button
            key={m.id}
            type="button"
            className={selected ? 'selected' : ''}
            title={m.description || m.id}
            onClick={() => onPick(m.id)}
          >
            <span>
              {selected ? '✓ ' : ''}
              {m.displayName}
            </span>
          </button>
        );
      })}
    </>
  );

  return scrollable ? (
    <div className="agent-model-list agent-model-list--async">{body}</div>
  ) : (
    body
  );
}

/** @deprecated Prefer {@link AgentModelMenuItems}. */
export function CursorModelMenuItems(
  props: Omit<AgentModelMenuItemsProps, 'autoModelId' | 'onPick'> & {
    onPick: (modelId: string) => void;
  },
) {
  return (
    <AgentModelMenuItems
      {...props}
      autoModelId="default"
      onPick={(id) => props.onPick(id || 'default')}
    />
  );
}
