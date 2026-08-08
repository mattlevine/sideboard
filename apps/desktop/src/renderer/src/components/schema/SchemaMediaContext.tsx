import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { FilePickerRequest } from './FileManagerColumn';
import type { SchemaAIDatasource, SchemaFileDatasource } from './SchemaFileDatasource';

export interface SchemaMediaContextValue {
  files: SchemaFileDatasource | null;
  ai: SchemaAIDatasource | null;
  /** Open the files column (picker). */
  openFilePicker: (request: FilePickerRequest) => void;
  closeFilePicker: () => void;
  filePicker: FilePickerRequest | null;
}

const SchemaMediaContext = createContext<SchemaMediaContextValue>({
  files: null,
  ai: null,
  openFilePicker: () => {},
  closeFilePicker: () => {},
  filePicker: null,
});

/** Controlled by SchemaPane so the files column is a real UI column. */
export function SchemaMediaProvider({
  files,
  ai,
  filePicker,
  onFilePickerChange,
  children,
}: {
  files: SchemaFileDatasource | null;
  ai: SchemaAIDatasource | null;
  filePicker: FilePickerRequest | null;
  onFilePickerChange: (request: FilePickerRequest | null) => void;
  children: ReactNode;
}) {
  const openFilePicker = useCallback(
    (request: FilePickerRequest) => {
      onFilePickerChange(request);
    },
    [onFilePickerChange],
  );

  const closeFilePicker = useCallback(() => {
    onFilePickerChange(null);
  }, [onFilePickerChange]);

  const value = useMemo(
    () => ({
      files,
      ai,
      openFilePicker,
      closeFilePicker,
      filePicker,
    }),
    [files, ai, openFilePicker, closeFilePicker, filePicker],
  );

  return (
    <SchemaMediaContext.Provider value={value}>{children}</SchemaMediaContext.Provider>
  );
}

export function useSchemaMedia(): SchemaMediaContextValue {
  return useContext(SchemaMediaContext);
}
