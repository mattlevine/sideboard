/** Helpers for JSON Schema + schemaUi (incl. Brightsy extensions). */

export type JsonSchema = Record<string, unknown>;

/** Max nesting depth for object/array form editors (guards against cycles). */
export const MAX_SCHEMA_NESTING_DEPTH = 8;

export interface FieldDef {
  name: string;
  title: string;
  description?: string;
  type: string;
  format?: string;
  enumValues?: string[];
  enumNames?: string[];
  widget?: string;
  required: boolean;
  readOnly: boolean;
  hidden: boolean;
  placeholder?: string;
  recordType?: string;
  foreignKey?: string;
  schema: JsonSchema;
}

export function getSchemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const props = schema.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    return props as Record<string, JsonSchema>;
  }
  return {};
}

export function getUiOrder(schemaUi: JsonSchema | undefined, fieldNames: string[]): string[] {
  const order = schemaUi?.['ui:order'];
  if (!Array.isArray(order)) return fieldNames;
  const named = order.filter((x): x is string => typeof x === 'string' && x !== '*');
  const rest = fieldNames.filter((n) => !named.includes(n));
  const hasStar = order.includes('*');
  return hasStar ? [...named, ...rest] : named.length ? named : fieldNames;
}

export function getListFields(
  schema: JsonSchema,
  schemaUi: JsonSchema | undefined,
): string[] {
  const list = schemaUi?.['ui:listFields'];
  if (Array.isArray(list) && list.every((x) => typeof x === 'string')) {
    return list as string[];
  }
  const props = getSchemaProperties(schema);
  return Object.keys(props).slice(0, 6);
}

/** Per-field ui node from a schemaUi map (Brightsy nests `items` under array fields). */
export function getFieldUi(
  schemaUi: JsonSchema | undefined,
  name: string,
): JsonSchema {
  const node = schemaUi?.[name];
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return node as JsonSchema;
  }
  return {};
}

/** Array-item ui schema (`schemaUi.field.items`). */
export function getItemsUi(fieldUi: JsonSchema | undefined): JsonSchema {
  const items = fieldUi?.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    return items as JsonSchema;
  }
  return {};
}

export function getItemsSchema(arraySchema: JsonSchema): JsonSchema | undefined {
  const items = arraySchema.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    return items as JsonSchema;
  }
  return undefined;
}

export function isObjectSchema(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  return String(schema.type ?? '') === 'object' && Object.keys(getSchemaProperties(schema)).length > 0;
}

export function isArraySchema(schema: JsonSchema | undefined): boolean {
  return Boolean(schema && String(schema.type ?? '') === 'array');
}

/** Default value when adding an array item or seeding a nested object. */
export function defaultValueForSchema(schema: JsonSchema | undefined): unknown {
  if (!schema || typeof schema !== 'object') return '';
  if (schema.default !== undefined) {
    try {
      return structuredClone(schema.default);
    } catch {
      return schema.default;
    }
  }
  const type = String(schema.type ?? 'string');
  const format = schema.format != null ? String(schema.format) : undefined;

  if (type === 'array') return [];

  if (type === 'object') {
    if (format === 'richtext' || format === 'rich-text' || format === 'html') {
      return null;
    }
    const props = getSchemaProperties(schema);
    if (Object.keys(props).length === 0) return {};
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      out[key] = defaultValueForSchema(prop);
    }
    return out;
  }

  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return null;
  return '';
}

/** Build a FieldDef for a bare items schema (scalar array entries). */
export function describeItemField(
  itemsSchema: JsonSchema,
  itemsUi?: JsonSchema,
  name = 'item',
): FieldDef {
  const ui = itemsUi ?? {};
  const type = String(itemsSchema.type ?? 'string');
  const format = itemsSchema.format ? String(itemsSchema.format) : undefined;
  const widget = ui['ui:widget'] ? String(ui['ui:widget']) : undefined;
  return {
    name,
    title: String(ui['ui:title'] ?? itemsSchema.title ?? name),
    description:
      ui['ui:description'] != null
        ? String(ui['ui:description'])
        : itemsSchema.description != null
          ? String(itemsSchema.description)
          : undefined,
    type,
    format,
    enumValues: Array.isArray(itemsSchema.enum)
      ? itemsSchema.enum.map(String)
      : undefined,
    enumNames: Array.isArray(ui['ui:enumNames'])
      ? (ui['ui:enumNames'] as unknown[]).map(String)
      : Array.isArray(itemsSchema.enumNames)
        ? (itemsSchema.enumNames as unknown[]).map(String)
        : undefined,
    widget,
    required: false,
    readOnly: Boolean(ui['ui:readonly'] ?? ui['ui:disabled'] ?? itemsSchema.readOnly),
    hidden: false,
    placeholder:
      ui['ui:placeholder'] != null ? String(ui['ui:placeholder']) : undefined,
    recordType:
      itemsSchema.recordType != null ? String(itemsSchema.recordType) : undefined,
    foreignKey:
      itemsSchema.foreignKey != null ? String(itemsSchema.foreignKey) : undefined,
    schema: itemsSchema,
  };
}

export function describeFields(
  schema: JsonSchema,
  schemaUi?: JsonSchema,
): FieldDef[] {
  const props = getSchemaProperties(schema);
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const names = getUiOrder(schemaUi, Object.keys(props));
  const fields: FieldDef[] = [];
  for (const name of names) {
    const field = props[name];
    if (!field || typeof field !== 'object') continue;
    const ui = getFieldUi(schemaUi, name);
    const type = String(field.type ?? 'string');
    const format = field.format ? String(field.format) : undefined;
    const widget = ui['ui:widget'] ? String(ui['ui:widget']) : undefined;
    const hidden = widget === 'hidden' || ui['ui:widget'] === 'hidden';
    if (hidden) continue;
    fields.push({
      name,
      title: String(ui['ui:title'] ?? field.title ?? name),
      description:
        ui['ui:description'] != null
          ? String(ui['ui:description'])
          : field.description != null
            ? String(field.description)
            : undefined,
      type,
      format,
      enumValues: Array.isArray(field.enum) ? field.enum.map(String) : undefined,
      enumNames: Array.isArray(ui['ui:enumNames'])
        ? (ui['ui:enumNames'] as unknown[]).map(String)
        : Array.isArray(field.enumNames)
          ? (field.enumNames as unknown[]).map(String)
          : undefined,
      widget,
      required: required.has(name),
      readOnly: Boolean(ui['ui:readonly'] ?? ui['ui:disabled'] ?? field.readOnly),
      hidden,
      placeholder: ui['ui:placeholder'] != null ? String(ui['ui:placeholder']) : undefined,
      recordType: field.recordType != null ? String(field.recordType) : undefined,
      foreignKey: field.foreignKey != null ? String(field.foreignKey) : undefined,
      schema: field,
    });
  }
  return fields;
}

export function schemaWithUi(schema: JsonSchema, schemaUi?: JsonSchema): JsonSchema {
  if (!schemaUi) return schema;
  return { ...schema, schema_ui: schemaUi, schemaUi };
}
