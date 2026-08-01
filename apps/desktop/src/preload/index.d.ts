import type { IpcApi } from '@sideboard/core';

declare global {
  interface Window {
    sideboard: IpcApi;
    sideboardUpdate: {
      onReady: (listener: () => void) => () => void;
      install: () => Promise<void>;
    };
  }
}

export {};
