import { afterEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => [] as Array<{ emit: (event: string) => void }>);

vi.mock('ws', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  class WebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    constructor() {
      super();
      sockets.push(this);
    }
    send(): void {}
    close(): void {
      this.emit('close');
    }
  }
  return { WebSocket };
});

import { AgentRpcClient } from './client.js';

describe('AgentRpcClient handshake', () => {
  afterEach(() => {
    sockets.length = 0;
  });

  it('rejects when the socket closes before open, then allows another connect', async () => {
    const client = new AgentRpcClient({ url: 'ws://127.0.0.1:9', authToken: 't' });
    const first = client.call('ping');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.emit('close');
    await expect(first).rejects.toThrow(/closed/i);

    const second = client.call('ping');
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.emit('close');
    await expect(second).rejects.toThrow(/closed/i);
    client.close();
  });
});
