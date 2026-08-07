import type { IpcApi } from '@sideboard-ai/core';

declare global {
  interface Window {
    sideboard: IpcApi;
    sideboardUpdate: {
      onAvailable: (listener: (info: { version: string }) => void) => () => void;
      onReady: (listener: (info: { version: string }) => void) => () => void;
      onError: (listener: (info: { message: string }) => void) => () => void;
      install: () => Promise<void>;
      check: () => Promise<void>;
      getVersion: () => Promise<string>;
      onOpenSettings: (listener: () => void) => () => void;
    };
  }
}

export {};
