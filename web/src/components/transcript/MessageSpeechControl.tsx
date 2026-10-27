/**
 * Speech control for one assistant variant.
 *
 * The v0.8 seam is synchronous — `POST /variants/:id/speech` returns a URL —
 * so there is no job to poll or cancel. The control has three states:
 * request, stop (while this variant is playing), and replay of a URL already
 * fetched for this variant. Playback itself lives in `speech-playback.ts`,
 * which keeps at most one audio element alive across the whole transcript.
 */
import { useEffect, useState, type ReactElement } from 'react';

import { requestSpeech } from '../../api.js';
import { SpeakerIcon, StopIcon } from '../../icons.js';
import { IconButton } from '../primitives/IconButton.js';
import {
  playSpeech,
  stopMessageSpeechPlayback,
  stopSpeechPlayback,
  useSpeechPlayback,
} from './speech-playback.js';
import { errorMessage } from '../../lib/errorMessage.js';

export function MessageSpeechControl({
  sessionId,
  variantId,
  disabled = false,
}: {
  sessionId: string;
  variantId: string;
  disabled?: boolean;
}): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const playback = useSpeechPlayback();

  useEffect(
    () => () => {
      stopMessageSpeechPlayback(variantId);
    },
    [variantId],
  );

  const playing =
    playback.messageId === variantId && playback.state === 'playing';
  const diagnostic =
    failure ?? (playback.messageId === variantId ? playback.diagnostic : null);
  const label = playing
    ? 'Stop message audio'
    : pending
      ? 'Generating speech'
      : failure !== null
        ? 'Retry speech generation'
        : 'Play message';

  function activate(): void {
    if (playing) {
      stopSpeechPlayback();
      return;
    }
    if (url !== null) {
      playSpeech(variantId, url);
      return;
    }
    setFailure(null);
    setPending(true);
    void requestSpeech(sessionId, variantId)
      .then((next) => {
        setUrl(next);
        playSpeech(variantId, next);
      })
      .catch((caught: unknown) => {
        setFailure(errorMessage(caught, 'Speech failed'));
      })
      .finally(() => {
        setPending(false);
      });
  }

  return (
    <span>
      <IconButton
        label={label}
        title={diagnostic ?? label}
        disabled={disabled || pending}
        disabledReason={diagnostic ?? undefined}
        onClick={activate}
      >
        {playing ? <StopIcon /> : <SpeakerIcon />}
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {pending ? 'Generating message speech' : (diagnostic ?? '')}
      </span>
    </span>
  );
}
