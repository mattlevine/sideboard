import { useEffect, useMemo, useState } from 'react';
import {
  resourceHasContentStates,
  type SchemaRecord,
  type SchemaResource,
} from '../../lib/right-pane';
import type { SchemaDatasource } from './SchemaDatasource';
import { MarkdownEditor } from './MarkdownEditor';
import { HasManyField, HasOneField, type RelatedNavigation } from './RelationshipFields';
import { RichTextEditor } from './RichTextEditor';
import { describeFields, type FieldDef } from './schema-utils';

interface Props {
  resource: SchemaResource;
  record: SchemaRecord | null;
  datasource: SchemaDatasource;
  busy?: boolean;
  /** Prefill when creating (e.g. has-many foreign key). */
  createDefaults?: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  /** Only used when resource has draft/published content states. */
  onPublish?: () => Promise<void>;
  onUnpublish?: () => Promise<void>;
  onOpenRelated?: (nav: RelatedNavigation) => void;
}

function FieldInput({
  field,
  value,
  onChange,
  datasource,
  currentRecordId,
  onOpenRelated,
  showContentStates,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  datasource: SchemaDatasource;
  currentRecordId?: string | null;
  onOpenRelated?: (nav: RelatedNavigation) => void;
  showContentStates?: boolean;
}) {
  if (field.readOnly) {
    return (
      <input
        className="schema-input"
        value={value == null ? '' : String(value)}
        readOnly
        disabled
      />
    );
  }

  if (field.type === 'boolean' || field.widget === 'checkbox') {
    return (
      <label className="schema-check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{field.title}</span>
      </label>
    );
  }

  if (field.format === 'has-one' && field.recordType) {
    return (
      <HasOneField
        name={field.name}
        label={field.title}
        description={field.description}
        recordType={field.recordType}
        value={value == null ? null : String(value)}
        onChange={onChange}
        required={field.required}
        disabled={field.readOnly}
        datasource={datasource}
        onOpenRelated={onOpenRelated}
      />
    );
  }

  if (field.format === 'has-many' && field.recordType && field.foreignKey) {
    return (
      <HasManyField
        name={field.name}
        label={field.title}
        description={field.description}
        recordType={field.recordType}
        foreignKey={field.foreignKey}
        currentRecordId={currentRecordId}
        datasource={datasource}
        onOpenRelated={onOpenRelated}
        showContentStates={showContentStates}
      />
    );
  }

  if (field.widget === 'select' || field.enumValues) {
    const options =
      field.enumValues?.map((v, i) => ({
        id: v,
        label: field.enumNames?.[i] ?? v,
      })) ?? [];
    return (
      <select
        className="schema-input"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (
    field.widget === 'richtext' ||
    field.format === 'richtext' ||
    field.format === 'html'
  ) {
    return (
      <RichTextEditor
        value={value}
        onChange={onChange}
        disabled={field.readOnly}
        placeholder={field.placeholder}
      />
    );
  }

  if (field.widget === 'markdown' || field.format === 'markdown') {
    return (
      <MarkdownEditor
        value={value == null ? '' : String(value)}
        onChange={onChange}
        disabled={field.readOnly}
        placeholder={field.placeholder}
      />
    );
  }

  if (field.widget === 'textarea' || field.format === 'textarea') {
    return (
      <textarea
        className="schema-input schema-textarea"
        rows={5}
        placeholder={field.placeholder}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.widget === 'date' || field.format === 'date') {
    return (
      <input
        type="date"
        className="schema-input"
        value={value == null ? '' : String(value).slice(0, 10)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.widget === 'datetime' || field.format === 'date-time') {
    return (
      <input
        type="datetime-local"
        className="schema-input"
        value={value == null ? '' : String(value).slice(0, 16)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.type === 'number' || field.type === 'integer') {
    return (
      <input
        type="number"
        className="schema-input"
        placeholder={field.placeholder}
        value={value == null || value === '' ? '' : Number(value)}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
      />
    );
  }

  if (field.format === 'has-many') {
    return (
      <div className="schema-muted">
        Has-many relationship needs recordType + foreignKey in schema
      </div>
    );
  }

  return (
    <input
      type="text"
      className="schema-input"
      placeholder={field.placeholder}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SchemaForm({
  resource,
  record,
  datasource,
  busy,
  createDefaults,
  onSave,
  onPublish,
  onUnpublish,
  onOpenRelated,
}: Props) {
  const fields = useMemo(
    () => describeFields(resource.schema, resource.schemaUi),
    [resource.schema, resource.schemaUi],
  );
  const [data, setData] = useState<Record<string, unknown>>(() => ({
    ...(createDefaults ?? {}),
    ...(record?.data ?? {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setData({
      ...(createDefaults ?? {}),
      ...(record?.data ?? {}),
    });
  }, [record?.id, record?.data, createDefaults]);

  const hasContentStates = resourceHasContentStates(resource);
  const published = Boolean(record?.publishedAt);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="schema-form">
      {fields.map((field) => {
        const isRel =
          field.format === 'has-one' || field.format === 'has-many';
        const hideOuterLabel =
          field.type === 'boolean' ||
          field.widget === 'checkbox' ||
          isRel;
        return (
          <div key={field.name} className="schema-field">
            {hideOuterLabel ? null : (
              <label className="schema-label">
                {field.title}
                {field.required ? <span className="schema-req">*</span> : null}
              </label>
            )}
            {!isRel && field.description ? (
              <div className="schema-help">{field.description}</div>
            ) : null}
            <FieldInput
              field={field}
              value={data[field.name]}
              onChange={(v) => setData((prev) => ({ ...prev, [field.name]: v }))}
              datasource={datasource}
              currentRecordId={record?.id}
              onOpenRelated={onOpenRelated}
              showContentStates={hasContentStates}
            />
          </div>
        );
      })}
      {error ? <div className="schema-error">{error}</div> : null}
      <div className="schema-form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : record ? 'Save' : 'Create'}
        </button>
        {/* Publish is a separate step from Save (Brightsy: update then publish). */}
        {hasContentStates && record && onPublish && !published ? (
          <button
            type="button"
            disabled={busy || saving}
            onClick={() => void onPublish().catch((e) => setError(String(e)))}
          >
            Publish
          </button>
        ) : null}
        {hasContentStates && record && onUnpublish && published ? (
          <button
            type="button"
            disabled={busy || saving}
            onClick={() => void onUnpublish().catch((e) => setError(String(e)))}
          >
            Unpublish
          </button>
        ) : null}
        {hasContentStates && published ? (
          <span className="schema-badge published">Published</span>
        ) : hasContentStates && record ? (
          <span className="schema-badge draft">Draft</span>
        ) : null}
      </div>
    </div>
  );
}
