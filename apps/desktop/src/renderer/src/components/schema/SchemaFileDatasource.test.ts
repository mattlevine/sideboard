import { describe, expect, it } from 'vitest';
import { MemoryFileDatasource } from './SchemaFileDatasource';

describe('MemoryFileDatasource', () => {
  it('uploads, lists, and deletes files', async () => {
    const ds = new MemoryFileDatasource();
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const uploaded = await ds.upload({
      path: 'public',
      filename: 'note.txt',
      file: blob,
    });
    expect(uploaded.path).toBe('public/note.txt');
    expect(uploaded.fileUrl).toBeTruthy();

    const listed = await ds.list({ path: 'public' });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe('note.txt');

    await ds.createFolder({ path: 'public', folderName: 'docs' });
    const withFolder = await ds.list({ path: 'public' });
    expect(withFolder.some((e) => e.type === 'folder' && e.name === 'docs')).toBe(true);

    await ds.delete('public/note.txt');
    expect(await ds.list({ path: 'public' })).toHaveLength(1);
  });
});
