/**
 * First schema renderer plugin.
 * Table/form + media context (files column / AI via source-agnostic datasources).
 */
import {
  UIComponentsProvider,
  defaultUIComponents,
} from '@brightsy/ui-context';
import type { SchemaRecord, SchemaResource } from '../../lib/right-pane';
import type { FilePickerRequest } from './FileManagerColumn';
import type { SchemaAIDatasource, SchemaFileDatasource } from './SchemaFileDatasource';
import type { RelatedNavigation } from './RelationshipFields';
import type { SchemaDatasource } from './SchemaDatasource';
import { SchemaForm } from './SchemaForm';
import { SchemaMediaProvider } from './SchemaMediaContext';
import { SchemaTable } from './SchemaTable';

export interface BrightsyUiRendererProps {
  mode: 'table' | 'form';
  resource: SchemaResource;
  record: SchemaRecord | null;
  datasource: SchemaDatasource;
  fileDatasource?: SchemaFileDatasource | null;
  aiDatasource?: SchemaAIDatasource | null;
  busy?: boolean;
  createDefaults?: Record<string, unknown>;
  onOpenRecord: (record: SchemaRecord) => void;
  onCreate?: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onPublish?: () => Promise<void>;
  onUnpublish?: () => Promise<void>;
  onOpenRelated?: (nav: RelatedNavigation) => void;
  filePicker: FilePickerRequest | null;
  onFilePickerChange: (request: FilePickerRequest | null) => void;
}

export function BrightsyUiRenderer({
  mode,
  resource,
  record,
  datasource,
  fileDatasource = null,
  aiDatasource = null,
  busy,
  createDefaults,
  onOpenRecord,
  onCreate,
  onSave,
  onPublish,
  onUnpublish,
  onOpenRelated,
  filePicker,
  onFilePickerChange,
}: BrightsyUiRendererProps) {
  return (
    <UIComponentsProvider components={defaultUIComponents}>
      <SchemaMediaProvider
        files={fileDatasource}
        ai={aiDatasource}
        filePicker={filePicker}
        onFilePickerChange={onFilePickerChange}
      >
        <div className="brightsy-ui-renderer">
          {mode === 'table' ? (
            <SchemaTable
              resource={resource}
              datasource={datasource}
              onOpenRecord={onOpenRecord}
              onCreate={onCreate}
            />
          ) : (
            <SchemaForm
              resource={resource}
              record={record}
              datasource={datasource}
              busy={busy}
              createDefaults={createDefaults}
              onSave={onSave}
              onPublish={onPublish}
              onUnpublish={onUnpublish}
              onOpenRelated={onOpenRelated}
            />
          )}
        </div>
      </SchemaMediaProvider>
    </UIComponentsProvider>
  );
}
