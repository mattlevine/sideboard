import { useEffect, useState } from 'react';
import { BrandMark } from './BrandMark';

const STEPS_THREAD = [
  'Creating worktree',
  'Checking out branch',
  'Wiring session',
  'Almost ready',
] as const;

const STEPS_ORCH = [
  'Opening orchestration',
  'Preparing coordinator',
  'Almost ready',
] as const;

const STEPS_MERGE = [
  'Preparing pull request',
  'Squash merging',
  'Updating status',
  'Almost done',
] as const;

const STEPS_REMOVE = [
  'Archiving threads',
  'Removing project',
  'Cleaning up',
  'Almost done',
] as const;

const STEPS_ARCHIVE = [
  'Stopping agents',
  'Removing worktree',
  'Cleaning up',
  'Almost done',
] as const;

type OverlayMode = 'create' | 'orchestration' | 'merge' | 'remove' | 'archive';

function stepsForMode(mode: OverlayMode) {
  switch (mode) {
    case 'orchestration':
      return STEPS_ORCH;
    case 'merge':
      return STEPS_MERGE;
    case 'remove':
      return STEPS_REMOVE;
    case 'archive':
      return STEPS_ARCHIVE;
    default:
      return STEPS_THREAD;
  }
}

/** Full-modal processing surface while create / merge / remove runs. */
export function CreateProcessingOverlay({
  mode,
  repoName,
  selectionHint,
}: {
  mode: OverlayMode;
  repoName: string;
  selectionHint?: string | null;
}) {
  const steps = stepsForMode(mode);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, [steps]);

  return (
    <div className="create-processing" role="status" aria-live="polite">
      <div className="create-processing-orb" aria-hidden>
        <span className="create-processing-ring" />
        <span className="create-processing-ring delay" />
        <BrandMark className="create-processing-mark" size="lg" />
      </div>
      <div className="create-processing-copy">
        <p className="create-processing-title">
          {steps[step]}
          <span className="create-processing-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </p>
        <p className="create-processing-meta">
          {mode === 'orchestration' ? (
            'Global coordinator'
          ) : (
            <>
              <span className="create-processing-repo">{repoName}</span>
              {selectionHint ? (
                <>
                  <span className="create-processing-sep">·</span>
                  <span>{selectionHint}</span>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>
      <div className="create-processing-rail" aria-hidden>
        {steps.map((_, i) => (
          <span
            key={i}
            className={`create-processing-tick${i === step ? ' active' : i < step ? ' done' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
