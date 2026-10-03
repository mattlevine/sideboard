import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_STORE_MAX_CHARS } from '../agents/error-detail.js';
import { wrapMcpToolResults } from './wrap-mcp-tools.js';

describe('wrapMcpToolResults', () => {
  it('clips text returned by server.tool callbacks', async () => {
    const captured: { cb?: (args: unknown) => Promise<unknown> } = {};
    const live = {
      tool: (
        name: string,
        desc: string,
        schema: unknown,
        cb: (args: unknown) => Promise<unknown>,
      ) => {
        void name;
        void desc;
        void schema;
        captured.cb = cb;
      },
    };
    wrapMcpToolResults(live as never, () => undefined);
    live.tool('echo', 'echo', {}, async () => ({
      content: [{ type: 'text', text: 'z'.repeat(TOOL_RESULT_STORE_MAX_CHARS + 40) }],
    }));
    const result = (await captured.cb?.({})) as { content: { text: string }[] };
    expect(result.content[0]?.text.length).toBeLessThan(TOOL_RESULT_STORE_MAX_CHARS + 40);
    expect(result.content[0]?.text).toMatch(/truncated/);
  });
});
