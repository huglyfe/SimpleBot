/** One ordered disclosure for streaming and persisted variant evidence. */
import { useId, useState, type ReactElement } from 'react';
import type { ToolActivity, Trace } from '@simplebot/shared';

import {
  BrainIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  WrenchIcon,
} from '../../icons.js';

export interface ReasoningDisclosureProps {
  trace: Trace;
  /** True while the owning attempt is still streaming. */
  streaming?: boolean;
}

export function ReasoningDisclosure({
  trace,
  streaming = false,
}: ReasoningDisclosureProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  if (trace.length === 0) return null;
  const hasReasoning = trace.some((entry) => entry.type === 'reasoning');
  const toolCount = trace.filter((entry) => entry.type === 'tool').length;
  const toolSuffix =
    toolCount > 0
      ? `, ${String(toolCount)} tool call${toolCount === 1 ? '' : 's'}`
      : '';
  const label = streaming
    ? `Thinking…${toolSuffix}`
    : `${hasReasoning ? 'Thought' : 'Used tools'}${toolSuffix}`;

  return (
    <div className="reasoning">
      <button
        type="button"
        className="reasoning-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <BrainIcon />
        <span>{label}</span>
        {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>
      {open ? (
        <div className="reasoning-body" id={bodyId}>
          <ol className="reasoning-trace" aria-label="Reasoning and tool calls">
            {trace.map((entry, index) =>
              entry.type === 'reasoning' ? (
                <li key={index}>
                  {entry.text
                    .split(/\n{2,}/u)
                    .filter((paragraph) => paragraph.trim().length > 0)
                    .map((paragraph, paragraphIndex) => (
                      <p key={paragraphIndex} className="reasoning-paragraph">
                        {paragraph}
                      </p>
                    ))}
                </li>
              ) : (
                <li key={index} className="reasoning-tool">
                  <details>
                    <summary>
                      <WrenchIcon />
                      <span className="reasoning-tool-name">{entry.name}</span>
                      <span
                        className={`reasoning-tool-status${entry.isError ? ' is-error' : ''}`}
                      >
                        {entry.completedAt === null
                          ? streaming
                            ? 'Running'
                            : 'No result'
                          : entry.isError
                            ? 'Failed'
                            : 'Done'}
                        {formatDuration(entry)}
                      </span>
                    </summary>
                    <div className="reasoning-tool-detail">
                      <ToolValue label="Arguments" value={entry.arguments} />
                      {entry.result === null ? null : (
                        <ToolValue label="Result" value={entry.result} />
                      )}
                    </div>
                  </details>
                </li>
              ),
            )}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function formatDuration(tool: ToolActivity): string {
  if (tool.completedAt === null) return '';
  const duration =
    new Date(tool.completedAt).getTime() - new Date(tool.startedAt).getTime();
  if (!Number.isFinite(duration) || duration < 0) return '';
  if (duration < 1_000) return ` · ${String(duration)}ms`;
  return ` · ${(duration / 1_000).toFixed(1)}s`;
}

function ToolValue({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown> | string;
}): ReactElement {
  const source =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <span>{label}</span>
      <pre>{source}</pre>
    </div>
  );
}
