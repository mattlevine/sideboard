import type { IpcApi } from '@sideboard/core';

declare global {
  interface Window {
    sideboard: IpcApi;
    sideboardUpdate: {
      onAvailable: (listener: (info: { version: string }) => void) => () => void;
      onReady: (listener: (info: { version: string }) => void) => () => void;
      onError: (listener: (info: { message: string }) => void) => () => void;
      install: () => Promise<void>;
    };
  }
}

export {};
