/** Helpers for JSON Schema + schemaUi (incl. Brightsy extensions). */

export type JsonSchema = Record<string, unknown>;

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
    const ui = (schemaUi?.[name] as JsonSchema | undefined) ?? {};
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
