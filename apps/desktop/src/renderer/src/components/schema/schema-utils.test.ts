import { describe, expect, it } from 'vitest';
import {
  defaultValueForSchema,
  describeFields,
  describeItemField,
  getFieldUi,
  getItemsSchema,
  getItemsUi,
  isArraySchema,
  isObjectSchema,
  type JsonSchema,
} from './schema-utils';

const nestedBrightsyLike: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', title: 'Title' },
    sections: {
      type: 'array',
      title: 'Sections',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['text', 'image'] },
                body: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['kind'],
            },
          },
        },
      },
    },
  },
};

const nestedUi: JsonSchema = {
  'ui:listFields': ['title'],
  sections: {
    'ui:title': 'Page sections',
    items: {
      heading: { 'ui:title': 'Section heading' },
      blocks: {
        'ui:title': 'Content blocks',
        items: {
          kind: { 'ui:enumNames': ['Text', 'Image'] },
          body: { 'ui:widget': 'textarea' },
        },
      },
    },
  },
};

describe('schema-utils nested Brightsy-like schemas', () => {
  it('describes top-level array-of-objects fields', () => {
    const fields = describeFields(nestedBrightsyLike, nestedUi);
    expect(fields.map((f) => f.name)).toEqual(['title', 'sections']);
    const sections = fields.find((f) => f.name === 'sections')!;
    expect(sections.type).toBe('array');
    expect(sections.title).toBe('Page sections');
    expect(isArraySchema(sections.schema)).toBe(true);
    expect(isObjectSchema(getItemsSchema(sections.schema))).toBe(true);
  });

  it('walks nested schemaUi.items for array item fields', () => {
    const sectionsUi = getFieldUi(nestedUi, 'sections');
    const itemsUi = getItemsUi(sectionsUi);
    const itemsSchema = getItemsSchema(
      (nestedBrightsyLike.properties as Record<string, JsonSchema>).sections,
    )!;
    const itemFields = describeFields(itemsSchema, itemsUi);
    expect(itemFields.map((f) => f.name)).toEqual(['heading', 'blocks']);
    expect(itemFields[0]!.title).toBe('Section heading');

    const blocks = itemFields.find((f) => f.name === 'blocks')!;
    const blockItemsUi = getItemsUi(getFieldUi(itemsUi, 'blocks'));
    const blockSchema = getItemsSchema(blocks.schema)!;
    const blockFields = describeFields(blockSchema, blockItemsUi);
    expect(blockFields.map((f) => f.name)).toEqual(['kind', 'body', 'tags']);
    expect(blockFields.find((f) => f.name === 'kind')!.enumNames).toEqual([
      'Text',
      'Image',
    ]);
    expect(blockFields.find((f) => f.name === 'body')!.widget).toBe('textarea');
  });

  it('defaults nested array-of-objects for Add item', () => {
    const sectionsSchema = (
      nestedBrightsyLike.properties as Record<string, JsonSchema>
    ).sections;
    const sectionDefault = defaultValueForSchema(getItemsSchema(sectionsSchema));
    expect(sectionDefault).toEqual({
      heading: '',
      blocks: [],
    });

    const blockSchema = getItemsSchema(
      (getItemsSchema(sectionsSchema)!.properties as Record<string, JsonSchema>)
        .blocks,
    );
    expect(defaultValueForSchema(blockSchema)).toEqual({
      kind: '',
      body: '',
      tags: [],
    });
  });

  it('describes scalar array items', () => {
    const item = describeItemField({ type: 'string' }, { 'ui:placeholder': 'tag' });
    expect(item.type).toBe('string');
    expect(item.placeholder).toBe('tag');
  });
});
