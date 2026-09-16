/**
 * electron-vite / Sideboard-launched desktop pipes stdout+stderr. When the
 * reader closes, Node process warnings (`writeOut` → `console.warn`) throw
 * uncaught `EPIPE` and Electron shows a fatal dialog. Attach listeners so
 * the write emits `error` instead of crashing the app.
 */
function ignoreBrokenPipe(stream: NodeJS.WriteStream | undefined): void {
  stream?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);
