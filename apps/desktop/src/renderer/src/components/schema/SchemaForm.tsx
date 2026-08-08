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
import {
  defaultValueForSchema,
  describeFields,
  describeItemField,
  getFieldUi,
  getItemsSchema,
  getItemsUi,
  isArraySchema,
  isObjectSchema,
  MAX_SCHEMA_NESTING_DEPTH,
  type FieldDef,
  type JsonSchema,
} from './schema-utils';

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

type SharedFieldProps = {
  datasource: SchemaDatasource;
  currentRecordId?: string | null;
  onOpenRelated?: (nav: RelatedNavigation) => void;
  showContentStates?: boolean;
  depth?: number;
};

const FALLBACK_STRING_ITEMS: JsonSchema = { type: 'string' };

function ScalarFieldInput({
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
} & SharedFieldProps) {
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

function ObjectFields({
  schema,
  schemaUi,
  value,
  onChange,
  shared,
  depth,
}: {
  schema: JsonSchema;
  schemaUi?: JsonSchema;
  value: unknown;
  onChange: (v: Record<string, unknown>) => void;
  shared: SharedFieldProps;
  depth: number;
}) {
  const fields = useMemo(() => describeFields(schema, schemaUi), [schema, schemaUi]);
  const obj =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return (
    <div className="schema-object">
      {fields.map((field) => {
        const fieldUi = getFieldUi(schemaUi, field.name);
        const isRel = field.format === 'has-one' || field.format === 'has-many';
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
              fieldUi={fieldUi}
              value={obj[field.name]}
              onChange={(v) => onChange({ ...obj, [field.name]: v })}
              {...shared}
              depth={depth}
            />
          </div>
        );
      })}
    </div>
  );
}

function EnumMultiSelect({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const selected = new Set(
    Array.isArray(value) ? value.map(String) : [],
  );
  const options =
    field.enumValues?.map((v, i) => ({
      id: v,
      label: field.enumNames?.[i] ?? v,
    })) ?? [];

  return (
    <div className="schema-enum-multi">
      {options.map((o) => (
        <label key={o.id} className="schema-check">
          <input
            type="checkbox"
            checked={selected.has(o.id)}
            disabled={field.readOnly}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(o.id);
              else next.delete(o.id);
              onChange([...next]);
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function ArrayFieldEditor({
  field,
  fieldUi,
  value,
  onChange,
  shared,
  depth,
}: {
  field: FieldDef;
  fieldUi: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  shared: SharedFieldProps;
  depth: number;
}) {
  const items = Array.isArray(value) ? value : [];
  const itemsSchema = getItemsSchema(field.schema) ?? FALLBACK_STRING_ITEMS;
  const itemsUi = getItemsUi(fieldUi);
  const itemField = useMemo(
    () => describeItemField(itemsSchema, itemsUi),
    [itemsSchema, itemsUi],
  );
  const isEnumMulti =
    Boolean(itemField.enumValues?.length) && !isObjectSchema(itemsSchema);

  // Brightsy-style multi-select: array of enum scalars
  if (isEnumMulti) {
    return (
      <EnumMultiSelect
        field={{ ...itemField, readOnly: field.readOnly || itemField.readOnly }}
        value={items}
        onChange={onChange}
      />
    );
  }

  function updateAt(index: number, next: unknown) {
    const copy = [...items];
    copy[index] = next;
    onChange(copy);
  }

  function removeAt(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    const tmp = copy[index];
    copy[index] = copy[target];
    copy[target] = tmp;
    onChange(copy);
  }

  function addItem() {
    onChange([...items, defaultValueForSchema(itemsSchema)]);
  }

  return (
    <div className="schema-array">
      {items.length === 0 ? (
        <div className="schema-array-empty">
          No items yet. Add one below.
        </div>
      ) : (
        <div className="schema-array-list">
          {items.map((item, index) => (
            <div key={`${field.name}-${index}`} className="schema-array-item">
              <div className="schema-array-item-head">
                <span className="schema-array-item-title">
                  {field.title} #{index + 1}
                </span>
                <div className="schema-array-item-actions">
                  <button
                    type="button"
                    className="schema-array-btn"
                    disabled={field.readOnly || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="schema-array-btn"
                    disabled={field.readOnly || index >= items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="schema-array-btn danger"
                    disabled={field.readOnly}
                    onClick={() => removeAt(index)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
              {isObjectSchema(itemsSchema) ? (
                <ObjectFields
                  schema={itemsSchema}
                  schemaUi={itemsUi}
                  value={item}
                  onChange={(v) => updateAt(index, v)}
                  shared={shared}
                  depth={depth + 1}
                />
              ) : isArraySchema(itemsSchema) ? (
                <FieldInput
                  field={itemField}
                  fieldUi={itemsUi}
                  value={item}
                  onChange={(v) => updateAt(index, v)}
                  {...shared}
                  depth={depth + 1}
                />
              ) : (
                <FieldInput
                  field={itemField}
                  fieldUi={itemsUi}
                  value={item}
                  onChange={(v) => updateAt(index, v)}
                  {...shared}
                  depth={depth + 1}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="schema-array-add"
        disabled={field.readOnly}
        onClick={addItem}
      >
        Add {field.title}
      </button>
    </div>
  );
}

function JsonFallbackEditor({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() => {
    try {
      return value == null ? '' : JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  });
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setText(value == null ? '' : JSON.stringify(value, null, 2));
      setParseError(null);
    } catch {
      /* keep */
    }
  }, [value]);

  return (
    <div className="schema-json-fallback">
      <textarea
        className="schema-input schema-textarea schema-json-textarea"
        rows={6}
        disabled={readOnly}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setParseError(null);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(next));
            setParseError(null);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : 'Invalid JSON');
          }
        }}
      />
      {parseError ? (
        <div className="schema-help schema-json-error">{parseError}</div>
      ) : (
        <div className="schema-help">JSON object / array</div>
      )}
    </div>
  );
}

function FieldInput({
  field,
  fieldUi,
  value,
  onChange,
  datasource,
  currentRecordId,
  onOpenRelated,
  showContentStates,
  depth = 0,
}: {
  field: FieldDef;
  fieldUi?: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
} & SharedFieldProps) {
  const shared: SharedFieldProps = {
    datasource,
    currentRecordId,
    onOpenRelated,
    showContentStates,
  };
  const ui = fieldUi ?? {};

  if (depth >= MAX_SCHEMA_NESTING_DEPTH) {
    return (
      <JsonFallbackEditor
        value={value}
        onChange={onChange}
        readOnly={field.readOnly}
      />
    );
  }

  // Structured object (skip relationship / richtext object shapes handled as scalars)
  const richObject =
    field.format === 'richtext' ||
    field.format === 'rich-text' ||
    field.format === 'html' ||
    field.widget === 'richtext' ||
    field.widget === 'markdown';
  if (
    field.type === 'object' &&
    !richObject &&
    field.format !== 'has-one' &&
    field.format !== 'has-many' &&
    isObjectSchema(field.schema)
  ) {
    return (
      <ObjectFields
        schema={field.schema}
        schemaUi={ui}
        value={value}
        onChange={onChange}
        shared={shared}
        depth={depth + 1}
      />
    );
  }

  if (field.type === 'object' && !richObject && field.format !== 'has-one') {
    return (
      <JsonFallbackEditor
        value={value}
        onChange={onChange}
        readOnly={field.readOnly}
      />
    );
  }

  if (field.type === 'array' && field.format !== 'has-many') {
    return (
      <ArrayFieldEditor
        field={field}
        fieldUi={ui}
        value={value}
        onChange={onChange}
        shared={shared}
        depth={depth}
      />
    );
  }

  return (
    <ScalarFieldInput
      field={field}
      value={value}
      onChange={onChange}
      {...shared}
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
  const shared: SharedFieldProps = {
    datasource,
    currentRecordId: record?.id,
    onOpenRelated,
    showContentStates: hasContentStates,
  };

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
        const fieldUi = getFieldUi(resource.schemaUi, field.name);
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
              fieldUi={fieldUi}
              value={data[field.name]}
              onChange={(v) => setData((prev) => ({ ...prev, [field.name]: v }))}
              {...shared}
              depth={0}
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
