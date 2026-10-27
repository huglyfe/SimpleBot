import { useSyncExternalStore } from 'react';

export interface SpeechPlaybackSnapshot {
  messageId: string | null;
  state: 'idle' | 'playing' | 'ready' | 'error';
  diagnostic: string | null;
}

export const SPEECH_PLAYBACK_WATCHDOG_MS = 15_000;

let audio: HTMLAudioElement | null = null;
let blocked = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let snapshot: SpeechPlaybackSnapshot = {
  messageId: null,
  state: 'idle',
  diagnostic: null,
};
const listeners = new Set<() => void>();

function publish(next: SpeechPlaybackSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function clearWatchdog(): void {
  if (watchdog === null) return;
  clearTimeout(watchdog);
  watchdog = null;
}

function disposeAudio(): void {
  const disposed = audio;
  audio = null;
  clearWatchdog();
  if (disposed === null) return;
  disposed.pause();
  disposed.removeAttribute('src');
  disposed.load();
}

function failPlayback(
  target: HTMLAudioElement,
  messageId: string,
  diagnostic: string,
): void {
  if (audio !== target) return;
  disposeAudio();
  publish({ messageId, state: 'error', diagnostic });
}

function armWatchdog(target: HTMLAudioElement, messageId: string): void {
  clearWatchdog();
  watchdog = setTimeout(() => {
    watchdog = null;
    failPlayback(
      target,
      messageId,
      'Message audio stopped responding. Press play to retry.',
    );
  }, SPEECH_PLAYBACK_WATCHDOG_MS);
}

export function stopSpeechPlayback(): void {
  disposeAudio();
  publish({ messageId: null, state: 'idle', diagnostic: null });
}

export function stopMessageSpeechPlayback(messageId: string): void {
  if (snapshot.messageId === messageId) stopSpeechPlayback();
}

/** A locked screen also silences speech that finishes generating later. */
export function setSpeechPlaybackBlocked(value: boolean): void {
  blocked = value;
  if (blocked) stopSpeechPlayback();
}

export function playSpeech(messageId: string, url: string): void {
  if (blocked) return;
  disposeAudio();
  const next = new Audio(url);
  audio = next;
  publish({ messageId, state: 'ready', diagnostic: null });
  next.addEventListener(
    'ended',
    () => {
      if (audio === next) stopSpeechPlayback();
    },
    { once: true },
  );
  next.addEventListener(
    'error',
    () => {
      failPlayback(next, messageId, 'Message audio could not be played.');
    },
    { once: true },
  );
  next.addEventListener(
    'abort',
    () => {
      failPlayback(next, messageId, 'Message audio playback was interrupted.');
    },
    { once: true },
  );
  for (const event of ['playing', 'stalled', 'timeupdate', 'waiting']) {
    next.addEventListener(event, () => {
      if (audio === next) armWatchdog(next, messageId);
    });
  }
  armWatchdog(next, messageId);
  void next.play().then(
    () => {
      if (audio === next) {
        publish({ messageId, state: 'playing', diagnostic: null });
        armWatchdog(next, messageId);
      }
    },
    () => {
      if (audio === next) {
        disposeAudio();
        publish({
          messageId,
          state: 'ready',
          diagnostic: 'Ready — press play.',
        });
      }
    },
  );
}

export function getSpeechPlaybackSnapshot(): SpeechPlaybackSnapshot {
  return snapshot;
}

export function useSpeechPlayback(): SpeechPlaybackSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => snapshot,
  );
}
