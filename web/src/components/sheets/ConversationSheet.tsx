import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  promptTokenCount,
  type CommittedLeaf,
  type SessionContext,
} from '@simplebot/shared';

import {
  saveTodo,
  deleteTodo,
  compactSession,
  deleteSchedule,
  deleteVariable,
  editLeafSource,
  getContext,
  putSchedule,
  setVariable,
} from '../../api.js';
import { TextRecord } from './RecordEditor.js';
import { Section } from './Section.js';
import { SchedulesPanel } from './SchedulesPanel.js';
import { TodosPanel } from './TodosPanel.js';
import { VariablesPanel } from './VariablesPanel.js';
import { errorMessage } from '../../lib/errorMessage.js';

const SUMMARY_OUTCOME: Record<CommittedLeaf['summaryOutcome'], string> = {
  model: '',
  'fallback-unavailable': 'Fallback summary — model unavailable',
  'fallback-clipped': 'Fallback summary — clipped to length',
};

function formatCost(cost: number): string {
  return cost === 0
    ? '$0.00'
    : cost < 0.01
      ? `$${cost.toFixed(4)}`
      : `$${cost.toFixed(2)}`;
}

function LeafRow({
  leaf,
  onSave,
}: {
  leaf: SessionContext['leaves'][number];
  onSave: (leafId: string, source: string) => Promise<void>;
}): ReactElement {
  const title =
    leaf.startExchange === leaf.endExchange
      ? `Exchange ${String(leaf.startExchange)}`
      : `Exchanges ${String(leaf.startExchange)}–${String(leaf.endExchange)}`;
  return (
    <TextRecord
      title={title}
      editLabel={`Edit summary · ${title}`}
      value={leaf.summary}
      emptySummary="Empty summary"
      textLabel="Summary"
      detail={
        leaf.summaryOutcome === 'model' ? undefined : (
          <span className="ui-hint is-error">
            {SUMMARY_OUTCOME[leaf.summaryOutcome]}
          </span>
        )
      }
      actionLabel="Save summary"
      onSave={(source) => onSave(leaf.id, source)}
    />
  );
}

function ContextPanel({
  sessionId,
  context,
  onRefreshAfter,
}: {
  sessionId: string;
  context: SessionContext;
  onRefreshAfter: (write: Promise<void>) => Promise<void>;
}): ReactElement {
  const cache = useQueryClient();
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function compact(): void {
    if (!context.canCompact) return;
    setCompacting(true);
    setError(null);
    void onRefreshAfter(compactSession(sessionId))
      .then(() => {
        void cache.invalidateQueries({ queryKey: ['session', sessionId] });
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught, 'Could not compact'));
      })
      .finally(() => {
        setCompacting(false);
      });
  }

  const usage = context.lastRequestUsage;

  function saveLeaf(leafId: string, source: string): Promise<void> {
    return onRefreshAfter(editLeafSource(sessionId, leafId, source));
  }

  const orderedLeaves = [...context.leaves].sort(
    (left, right) =>
      right.endOrdinal - left.endOrdinal ||
      right.createdAt.localeCompare(left.createdAt),
  );

  return (
    <>
      <Section title="Context status">
        <dl className="context-facts">
          <div>
            <dt>Last request tokens</dt>
            <dd>
              {usage === null
                ? 'Usage unavailable'
                : `${promptTokenCount(usage).toLocaleString()} input · ${usage.output.toLocaleString()} output`}
            </dd>
          </div>
          {usage === null ? null : (
            <div>
              <dt>Prompt cache</dt>
              <dd>
                {usage.cacheRead.toLocaleString()} hit ·{' '}
                {(usage.input + usage.cacheWrite).toLocaleString()} miss
              </dd>
            </div>
          )}
          <div>
            <dt>Last message cost</dt>
            <dd>
              {context.lastSwipeCost === null
                ? 'Unavailable'
                : formatCost(context.lastSwipeCost)}
            </dd>
          </div>
          <div>
            <dt>Current exchange</dt>
            <dd>
              {context.currentExchange === 0
                ? 'No messages yet'
                : `Exchange ${String(context.currentExchange)}`}
            </dd>
          </div>
          <div>
            <dt>Exact context begins</dt>
            <dd>Exchange {String(context.exactFromExchange)}</dd>
          </div>
        </dl>
        {error === null ? null : (
          <p className="ui-notice" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="ui-button context-compact"
          disabled={compacting || !context.canCompact}
          onClick={compact}
        >
          Compact now
        </button>
      </Section>

      <Section title="Summaries">
        {orderedLeaves.length === 0 ? (
          <p className="ui-empty">No summaries yet.</p>
        ) : (
          <ul className="record-list">
            {orderedLeaves.map((leaf) => (
              <LeafRow key={leaf.id} leaf={leaf} onSave={saveLeaf} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export function ConversationSheet({
  sessionId,
}: {
  sessionId: string;
}): ReactElement {
  const cache = useQueryClient();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const context = useQuery({
    queryKey: ['context', sessionId],
    queryFn: () => getContext(sessionId),
    refetchOnMount: 'always',
  });

  async function refreshAfter(write: Promise<void>): Promise<void> {
    await write;
    setRefreshError(null);
    try {
      cache.setQueryData(['context', sessionId], await getContext(sessionId));
    } catch (caught) {
      setRefreshError(
        `Saved, but Context could not refresh: ${errorMessage(caught, 'Unknown error')}`,
      );
    }
  }

  return (
    <>
      {refreshError === null ? null : (
        <p className="ui-notice" role="alert">
          {refreshError}
        </p>
      )}

      {context.isPending ? (
        <p className="ui-empty">Loading conversation state…</p>
      ) : context.isError ? (
        <p className="ui-notice" role="alert">
          {context.error.message}
        </p>
      ) : (
        <>
          <ContextPanel
            sessionId={sessionId}
            context={context.data}
            onRefreshAfter={refreshAfter}
          />

          <Section title="To-dos">
            <TodosPanel
              todos={context.data.todos}
              timezone={context.data.timezone}
              onSave={(todo) => refreshAfter(saveTodo(sessionId, todo))}
              onDelete={(id) => refreshAfter(deleteTodo(sessionId, id))}
            />
          </Section>

          <Section title="Variables">
            <VariablesPanel
              variables={context.data.variables}
              onSet={(name, value, previousName) =>
                refreshAfter(setVariable(sessionId, name, value, previousName))
              }
              onDelete={(name) => refreshAfter(deleteVariable(sessionId, name))}
            />
          </Section>

          <Section title="Schedules">
            <SchedulesPanel
              timezone={context.data.timezone}
              schedules={context.data.schedules}
              onSave={(schedule) =>
                refreshAfter(putSchedule(sessionId, schedule))
              }
              onDelete={(scheduleId) =>
                refreshAfter(deleteSchedule(sessionId, scheduleId))
              }
            />
          </Section>
        </>
      )}
    </>
  );
}
