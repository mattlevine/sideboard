function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'tasks', 'projects', 'items', 'results', 'nodes']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

export function ableTimeProjectFields(nested: Record<string, unknown>): {
  projectId?: string;
  project?: { id?: string; name?: string };
} {
  const projectRecord = asRecord(nested.project);
  const projectId =
    firstString(nested, ['project_id', 'projectId']) || firstString(projectRecord, ['id']) || undefined;
  const projectName =
    firstString(nested, ['project_name', 'projectName']) ||
    firstString(projectRecord, ['name', 'title']) ||
    undefined;
  if (!projectId && !projectName) return {};
  return {
    ...(projectId ? { projectId } : {}),
    project: {
      ...(projectId ? { id: projectId } : {}),
      ...(projectName ? { name: projectName } : {}),
    },
  };
}

export function mapAbleTimeProject(
  raw: unknown,
): { id: string; name: string; categories: Array<{ id: string; name: string }> } | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = firstString(record, ['id', 'project_id', 'projectId']);
  const name = firstString(record, ['name', 'title', 'projectName']);
  if (!id && !name) return null;
  const categories = asList(record.categories ?? record.category)
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const categoryId = firstString(rec, ['id', 'category_id', 'projectCategoryId', 'categoryId']);
      const categoryName = firstString(rec, ['name', 'title', 'categoryName']);
      if (!categoryId && !categoryName) return null;
      return { id: categoryId || categoryName, name: categoryName || categoryId };
    })
    .filter((item): item is { id: string; name: string } => Boolean(item));
  return { id: id || name, name: name || id, categories };
}
