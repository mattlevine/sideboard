import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

let mermaidIdCounter = 0;

/**
 * Quote flowchart node labels that contain HTML or parentheses so Mermaid's
 * parser doesn't treat them as shape syntax.
 */
function quoteFlowchartSquareBracketLabels(chart: string): string {
  const firstLine = chart.split('\n').find((l) => l.trim()) ?? '';
  if (!/^\s*(flowchart|graph)\s/i.test(firstLine)) {
    return chart;
  }

  const cylinderOnly = /^\([^)]+\)$/;

  return chart.replace(
    /(?<!\()\b([A-Za-z_][\w]*)\[(?!\[)([^\]]+)\]/g,
    (full, id: string, label: string) => {
      const t = label.trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return full;
      }
      const needsForHtml = /<[a-z!?/]/i.test(label);
      const needsForParens = /[()]/.test(label) && !cylinderOnly.test(label.trim());
      if (!needsForHtml && !needsForParens) {
        return full;
      }
      const escaped = label.replace(/"/g, '#quot;');
      return `${id}["${escaped}"]`;
    },
  );
}

function normalizeChart(chart: string): string {
  let cleaned = chart.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (cleaned.toLowerCase().startsWith('gitgraph')) {
    cleaned = cleaned.replace(/^gitgraph/i, 'gitGraph');
    const lines = cleaned.split('\n');
    cleaned = lines
      .map((line, index) => {
        if (index === 0) return line.trim();
        const trimmed = line.trim();
        if (trimmed === '') return '';
        return `    ${trimmed}`;
      })
      .join('\n');
  }

  const diagramTypeNormalizations: [RegExp, string][] = [
    [/^sequencediagram/i, 'sequenceDiagram'],
    [/^classdiagram/i, 'classDiagram'],
    [/^statediagram/i, 'stateDiagram'],
    [/^erdiagram/i, 'erDiagram'],
  ];

  for (const [pattern, replacement] of diagramTypeNormalizations) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, replacement);
      break;
    }
  }

  return quoteFlowchartSquareBracketLabels(cleaned);
}

/**
 * Renders a Mermaid diagram from a fenced ```mermaid block.
 * Dynamically imports mermaid to keep the initial bundle small.
 */
export function MermaidDiagram({ chart, className = '' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const renderAttemptRef = useRef(0);
  const lastSuccessfulChartRef = useRef('');
  const svgContentRef = useRef<string | null>(null);

  const diagramId = useMemo(() => {
    mermaidIdCounter += 1;
    return `mermaid-diagram-${mermaidIdCounter}-${Date.now()}`;
  }, []);

  useEffect(() => {
    let isMounted = true;
    renderAttemptRef.current += 1;
    const currentAttempt = renderAttemptRef.current;

    const renderChart = async () => {
      if (!chart.trim()) {
        setLoading(false);
        return;
      }

      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          fontFamily: 'inherit',
          suppressErrorRendering: true,
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
          },
          sequence: {
            useMaxWidth: true,
          },
          gitGraph: {
            useMaxWidth: true,
          },
        });

        const cleanedChart = normalizeChart(chart);
        const renderElementId = `${diagramId}-attempt-${currentAttempt}-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(renderElementId, cleanedChart);

        if (isMounted && currentAttempt === renderAttemptRef.current) {
          svgContentRef.current = svg;
          setSvgContent(svg);
          setError(null);
          setLoading(false);
          lastSuccessfulChartRef.current = chart;
        }
      } catch (err: unknown) {
        if (isMounted && currentAttempt === renderAttemptRef.current) {
          if (lastSuccessfulChartRef.current && svgContentRef.current) {
            // Keep previous successful render during streaming/partial updates
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to render diagram';
          console.error('[MermaidDiagram] Rendering error:', err);
          setError(message);
          setLoading(false);
        }
      }
    };

    const timeoutId = setTimeout(renderChart, 150);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [chart, diagramId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (loading) {
    return (
      <div className={`md-mermaid md-mermaid-loading ${className}`.trim()}>
        <span>Loading diagram…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`md-mermaid md-mermaid-error ${className}`.trim()}>
        <div className="md-mermaid-error-title">Diagram error</div>
        <pre>{chart}</pre>
        <p>{error}</p>
      </div>
    );
  }

  if (svgContent) {
    const diagramBody = (
      <div className="md-mermaid-svg" dangerouslySetInnerHTML={{ __html: svgContent }} />
    );

    const overlay =
      expanded &&
      typeof document !== 'undefined' &&
      createPortal(
        <div
          className="md-mermaid-overlay"
          role="presentation"
          onClick={() => setExpanded(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Diagram"
            className="md-mermaid-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="md-mermaid-close"
              onClick={() => setExpanded(false)}
            >
              Close
            </button>
            <div className="md-mermaid-dialog-body">{diagramBody}</div>
          </div>
        </div>,
        document.body,
      );

    return (
      <>
        {!expanded ? (
          <div ref={containerRef} className={`md-mermaid ${className}`.trim()}>
            <button
              type="button"
              className="md-mermaid-expand"
              aria-label="Expand diagram"
              title="Expand diagram"
              onClick={() => setExpanded(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
            {diagramBody}
          </div>
        ) : null}
        {overlay}
      </>
    );
  }

  return <div ref={containerRef} className={`md-mermaid ${className}`.trim()} />;
}

export default MermaidDiagram;
