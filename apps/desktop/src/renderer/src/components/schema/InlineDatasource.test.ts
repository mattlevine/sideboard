import { describe, expect, it } from 'vitest';
import { InlineDatasource } from './SchemaDatasource';

describe('InlineDatasource', () => {
  const resource = {
    id: 'posts',
    title: 'Posts',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    schemaUi: { 'ui:listFields': ['title'] },
  };

  it('lists, filters, updates, and publishes records', async () => {
    const ds = new InlineDatasource({
      resource,
      records: [
        { id: '1', data: { title: 'Alpha', body: 'a' } },
        { id: '2', data: { title: 'Beta', body: 'b' } },
      ],
    });

    const listed = await ds.listRecords('posts', { search: 'alp' });
    expect(listed.total).toBe(1);
    expect(listed.records[0]!.id).toBe('1');

    const updated = await ds.updateRecord('posts', '1', { title: 'Alpha 2' });
    expect(updated.data.title).toBe('Alpha 2');

    const published = await ds.publishRecord!('posts', '1');
    expect(published.publishedAt).toBeTruthy();

    const created = await ds.createRecord('posts', { title: 'Gamma' });
    expect(created.id).toMatch(/^inline_/);
    const after = await ds.listRecords('posts');
    expect(after.total).toBe(3);
  });
});
