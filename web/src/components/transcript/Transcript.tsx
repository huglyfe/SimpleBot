/**
 * The scrolling transcript region: canonical positions and the in-flight
 * attempt. Compaction leaves stay in Conversation controls.
 *
 * Three behaviors here are named defect fixes rather than incidental layout:
 *
 * - The column fills from the top and only pins to the bottom once content
 *   exceeds the viewport. A short conversation sits under the header instead
 *   of floating at the bottom of a void.
 * - A regenerating attempt renders in the slot of the variant it replaces, so
 *   the new swipe never paints below the old one before replacing it.
 * - This component is the only thing that moves the viewport, and it does so
 *   for exactly four reasons, each written once below: a session opened, the
 *   loaded transcript changed while the operator was at the live edge, an
 *   older page was prepended above what they were reading, or they asked to be
 *   taken back to the end. Rendering does not move it, and the browser's own
 *   scroll anchoring is off (`overflow-anchor: none`) so it cannot compete.
 *
 *   Every one of those writes asks for `scrollHeight` and lets the browser
 *   clamp it. A sentinel past the end is the same request in Chromium and no
 *   request at all in WebKit, which drops `Number.MAX_SAFE_INTEGER` on the
 *   floor and leaves the offset where it was: a Safari transcript opened at
 *   its oldest loaded message and never followed a reply.
 *
 *   Anchoring is not an option for the prepend, which is the one correction
 *   worth wanting from it: Chromium suppresses anchoring at scroll offset
 *   zero, and offset zero is exactly where `Load earlier messages` is read and
 *   pressed. It would stand down at the only moment it was needed, and apply
 *   on top of this component's correction at every other moment.
 *
 * Where the operator is comes from an IntersectionObserver over a marker at
 * the end of the transcript, not from scroll arithmetic. iOS Safari defers
 * `scroll` events through momentum, so a reading taken there is stale for the
 * back half of every flick; intersection is reported off that path. For the
 * same reason a touch suspends the writer until scrolling actually ends, so
 * an arriving token can never cut a flick short.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { MessagePosition } from '@simplebot/shared';

import { ArrowDownIcon } from '../../icons.js';
import {
  conversationDateKey,
  formatDayDivider,
  useTimePreferences,
} from '../../lib/format.js';
import {
  AssistantMessageRow,
  UserMessageRow,
  type LiveAttempt,
  type TranscriptUpdate,
  type TranscriptAction,
} from './MessageRow.js';
import { stopSpeechPlayback } from './speech-playback.js';

/**
 * Distance from the end that still counts as the live edge. Exported so a
 * test addresses the same observer this creates rather than a copy of it.
 */
export const LIVE_EDGE_MARGIN = '0px 0px 80px 0px';

export function Transcript({
  sessionId,
  positions,
  hasMore = false,
  loadingEarlier = false,
  onLoadEarlier,
  onReachLiveEdge,
  ttsConfigured = true,
  botName,
  live,
  update,
  onAction,
  regenerate,
}: {
  sessionId: string;
  positions: MessagePosition[];
  /** Older positions exist before the first one held. */
  hasMore?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  /**
   * The transcript reached its end. Stable identity required: it is read by a
   * mount-long observer. Where the loaded range is trimmed back to size.
   */
  onReachLiveEdge?: () => void;
  ttsConfigured?: boolean;
  botName: string;
  live: LiveAttempt | null;
  update: TranscriptUpdate;
  onAction: TranscriptAction;
  regenerate: (positionId: string) => void;
}): ReactElement {
  const { timezone } = useTimePreferences();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveEdgeRef = useRef<HTMLDivElement | null>(null);
  /**
   * Read when output arrives rather than depended on: as state it would make
   * every crossing into the live-edge zone re-run the effect and pin the
   * viewport, which on a phone means a downward flick cut short by its own
   * momentum carrying it into range.
   */
  const atLiveEdge = useRef(true);
  /** Far enough back that `Return to latest` is worth offering. */
  const [awayFromLive, setAwayFromLive] = useState(false);
  /**
   * True from the first touch until scrolling actually stops. Nothing writes
   * the offset while it is held: `touchend` fires when the finger leaves,
   * which is the middle of a flick rather than the end of it, so a token
   * arriving in between would otherwise kill the momentum mid-gesture.
   */
  const gesture = useRef(false);
  const followFrame = useRef<number | null>(null);
  const busy = live !== null;

  // 1. A session opened. Stop any audio and place the viewport once.
  useLayoutEffect(() => {
    stopSpeechPlayback();
    setAwayFromLive(false);
    atLiveEdge.current = true;
    gesture.current = false;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  /**
   * 2. The loaded transcript changed while the operator was at the live edge:
   * output arrived, or reaching the end trimmed history off the front.
   *
   * Keyed on the end and the front rather than the count, so a page prepended
   * above what they are reading is not mistaken for something new — when that
   * happens they are not at the live edge, so this stands down and the anchor
   * below does the work instead. Live updates schedule at most one scroll
   * write per animation frame, so token commits cannot fight over the offset.
   * The live attempt is followed by how much has
   * arrived, not by what: joining its text to use as a dependency was
   * quadratic over a long reply, and the length changes on the same ticks.
   */
  const liveLength = live?.text.length ?? 0;
  const lastPositionId = positions.at(-1)?.id ?? null;
  const firstPositionId = positions[0]?.id ?? null;
  useLayoutEffect(() => {
    if (followFrame.current !== null || !atLiveEdge.current || gesture.current)
      return;
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = null;
      const el = scrollRef.current;
      if (!el || !atLiveEdge.current || gesture.current) return;
      // The browser clamps this write to the maximum offset. Scheduling it at
      // the frame boundary coalesces token commits into one viewport move.
      el.scrollTop = el.scrollHeight;
    });
  }, [liveLength, lastPositionId, firstPositionId]);

  useEffect(
    () => () => {
      if (followFrame.current !== null)
        cancelAnimationFrame(followFrame.current);
    },
    [],
  );

  // Snapshot the anchor before the older page lands, not after.
  const anchor = useRef<{ scrollTop: number; scrollHeight: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !loadingEarlier) return;
    anchor.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
  }, [loadingEarlier]);

  /**
   * 3. An older page was prepended. Everything it added sits above the
   * operator, so holding `scrollTop` would slide the message they were reading
   * down the screen by the height of the page they asked for. Adding the delta
   * back leaves it exactly where it was.
   *
   * Only one of this and the follow above ever acts on a given change: a
   * prepend is requested from the top, where the live edge is far away, and
   * nothing else in the transcript sets an anchor to restore.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const held = anchor.current;
    if (!el || held === null) return;
    anchor.current = null;
    el.scrollTop = held.scrollTop + (el.scrollHeight - held.scrollHeight);
  }, [firstPositionId]);

  /**
   * Where the operator is. Two observers over one marker: the near one decides
   * whether output is followed, the far one whether returning is offered.
   */
  useEffect(() => {
    const root = scrollRef.current;
    const marker = liveEdgeRef.current;
    if (root === null || marker === null) return;
    const live = new IntersectionObserver(
      ([entry]) => {
        const reached = entry?.isIntersecting ?? false;
        atLiveEdge.current = reached;
        if (reached) onReachLiveEdge?.();
      },
      { root, rootMargin: LIVE_EDGE_MARGIN },
    );
    let near: IntersectionObserver | undefined;
    const measureReturnRange = () => {
      near?.disconnect();
      near = new IntersectionObserver(
        ([entry]) => setAwayFromLive(!(entry?.isIntersecting ?? true)),
        // Percentage root margins use width, not height.
        { root, rootMargin: `0px 0px ${String(root.clientHeight * 2)}px 0px` },
      );
      near.observe(marker);
    };
    measureReturnRange();
    const resize = new ResizeObserver(measureReturnRange);
    resize.observe(root);
    live.observe(marker);
    return () => {
      live.disconnect();
      near?.disconnect();
      resize.disconnect();
    };
  }, [onReachLiveEdge]);

  /**
   * A touch holds the writer off until scrolling ends. `scrollend` is the only
   * honest end of a flick; where it is missing the gesture ends with the touch,
   * which is the behaviour this replaces rather than a regression.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const settles = 'onscrollend' in window;
    let from = 0;
    const begin = () => {
      gesture.current = true;
      from = el.scrollTop;
    };
    const end = () => {
      gesture.current = false;
    };
    // A touch that moved nothing produces no `scrollend`, so it ends here; a
    // flick is left to `scrollend` so its momentum runs out first.
    const release = () => {
      if (!settles || el.scrollTop === from) end();
    };
    el.addEventListener('touchstart', begin, { passive: true });
    el.addEventListener('touchend', release, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    el.addEventListener('scrollend', end);
    return () => {
      el.removeEventListener('touchstart', begin);
      el.removeEventListener('touchend', release);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('scrollend', end);
    };
  }, []);

  // 4. The operator asked to be taken back to the end.
  function returnToLatest(): void {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }

  function assistantRow(
    position: Extract<MessagePosition, { role: 'assistant' }> | null,
    attempt: LiveAttempt | null,
  ): ReactElement {
    return (
      <AssistantMessageRow
        key={position?.id ?? attempt?.positionId}
        position={position}
        live={attempt}
        sessionId={sessionId}
        ttsConfigured={ttsConfigured}
        botName={botName}
        update={update}
        onAction={onAction}
        regenerate={regenerate}
        busy={busy}
      />
    );
  }

  const items: ReactNode[] = [];
  let previousDay: string | null = null;
  for (const position of positions) {
    const day = conversationDateKey(position.createdAt, timezone);
    if (day !== previousDay) {
      previousDay = day;
      items.push(
        <p key={`day-${day}-${position.id}`} className="msg-day-divider">
          <span>{formatDayDivider(position.createdAt, timezone)}</span>
        </p>,
      );
    }

    items.push(
      position.role === 'user' ? (
        <UserMessageRow
          key={position.id}
          position={position}
          sessionId={sessionId}
          update={update}
          busy={busy}
        />
      ) : (
        assistantRow(position, live?.positionId === position.id ? live : null)
      ),
    );
  }
  if (
    live !== null &&
    !positions.some((position) => position.id === live.positionId)
  ) {
    items.push(assistantRow(null, live));
  }

  return (
    <div className="msg-region">
      <div className="msg-scroll ui-scrollbar" ref={scrollRef}>
        <div className="msg-column">
          {hasMore ? (
            <button
              type="button"
              className="ui-button is-quiet"
              disabled={loadingEarlier}
              onClick={onLoadEarlier}
            >
              {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
            </button>
          ) : null}
          {items}
        </div>
        {/*
          The end of the transcript, as a thing that can be observed. It sits
          outside the column because the column is a flex layout with a gap,
          and a marker inside it would open one last gap under the final
          message.
        */}
        <div className="msg-live-edge" ref={liveEdgeRef} aria-hidden="true" />
      </div>
      {awayFromLive ? (
        <button
          type="button"
          className="msg-return-pill"
          onClick={returnToLatest}
        >
          <ArrowDownIcon /> Return to latest
        </button>
      ) : null}
    </div>
  );
}
