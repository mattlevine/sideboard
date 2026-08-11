import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  title?: string;
  path?: string;
  content: string;
  onOpenFile?: (path: string) => void;
}

/**
 * In-chat plan document (presentation only).
 * Approve / Hand off / Copy live in the composer so users can add notes.
 */
export function PlanApprovalCard({
  title = 'Plan',
  path = '.context/attachments/plan.md',
  content,
  onOpenFile,
}: Props) {
  return (
    <div className="plan-approval-card" data-plan-path={path}>
      <div className="plan-approval-header">
        <div className="plan-approval-title-block">
          <span className="plan-approval-kind">Plan</span>
          <h3 className="plan-approval-title">{title}</h3>
        </div>
        {onOpenFile && (
          <button
            type="button"
            className="plan-approval-file"
            title={`Open ${path}`}
            onClick={() => onOpenFile(path)}
          >
            {path.split('/').pop() || path}
          </button>
        )}
      </div>
      <div className="plan-approval-body">
        <MarkdownMessage text={content} />
      </div>
    </div>
  );
}
