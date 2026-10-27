import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSpeechPlaybackSnapshot,
  playSpeech,
  SPEECH_PLAYBACK_WATCHDOG_MS,
  stopMessageSpeechPlayback,
  stopSpeechPlayback,
  setSpeechPlaybackBlocked,
} from './speech-playback.js';

class FakeAudio {
  static instances: FakeAudio[] = [];

  readonly listeners = new Map<
    string,
    { listener: EventListenerOrEventListenerObject; once: boolean }[]
  >();
  readonly playPromise: Promise<void>;
  src: string;
  pauseCalls = 0;
  loadCalls = 0;
  removedSource = false;
  #resolvePlay: (() => void) | undefined;
  #rejectPlay: ((reason?: unknown) => void) | undefined;

  constructor(src: string) {
    this.src = src;
    this.playPromise = new Promise<void>((resolve, reject) => {
      this.#resolvePlay = resolve;
      this.#rejectPlay = reject;
    });
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    return this.playPromise;
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.removedSource = true;
      this.src = '';
    }
  }

  load(): void {
    this.loadCalls += 1;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push({
      listener,
      once: typeof options === 'object' && options.once === true,
    });
    this.listeners.set(type, entries);
  }

  resolvePlay(): void {
    this.#resolvePlay?.();
  }

  rejectPlay(): void {
    this.#rejectPlay?.(new DOMException('Blocked', 'NotAllowedError'));
  }

  emit(type: string): void {
    const entries = this.listeners.get(type) ?? [];
    for (const entry of entries) {
      if (typeof entry.listener === 'function') {
        entry.listener(new Event(type));
      } else {
        entry.listener.handleEvent(new Event(type));
      }
    }
    this.listeners.set(
      type,
      entries.filter((entry) => !entry.once),
    );
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  stopSpeechPlayback();
});

afterEach(() => {
  stopSpeechPlayback();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('speech playback', () => {
  it('does nothing until explicitly asked to play', async () => {
    expect(FakeAudio.instances).toHaveLength(0);
    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: null,
      state: 'idle',
      diagnostic: null,
    });

    playSpeech('message-1', '/audio/1');
    const first = FakeAudio.instances[0];
    expect(first).toBeDefined();
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: 'message-1',
      state: 'ready',
    });
    first?.resolvePlay();
    await Promise.resolve();
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: 'message-1',
      state: 'playing',
    });
  });

  it('allows only one audio element and ignores stale completion', async () => {
    playSpeech('message-1', '/audio/1');
    const first = FakeAudio.instances[0];
    playSpeech('message-2', '/audio/2');
    const second = FakeAudio.instances[1];

    expect(first).toMatchObject({
      pauseCalls: 1,
      loadCalls: 1,
      removedSource: true,
    });
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: 'message-2',
      state: 'ready',
    });

    first?.resolvePlay();
    await Promise.resolve();
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: 'message-2',
      state: 'ready',
    });
    second?.resolvePlay();
    await Promise.resolve();
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: 'message-2',
      state: 'playing',
    });
  });

  it('turns play rejection into an explicit ready retry and cleans terminal events', async () => {
    playSpeech('message-1', '/audio/1');
    const blocked = FakeAudio.instances[0];
    blocked?.rejectPlay();
    await Promise.resolve();
    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: 'message-1',
      state: 'ready',
      diagnostic: 'Ready — press play.',
    });
    expect(blocked).toMatchObject({
      pauseCalls: 1,
      loadCalls: 1,
      removedSource: true,
    });

    playSpeech('message-1', '/audio/1');
    const retry = FakeAudio.instances[1];
    retry?.resolvePlay();
    await Promise.resolve();
    retry?.emit('ended');
    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: null,
      state: 'idle',
      diagnostic: null,
    });

    playSpeech('message-2', '/audio/2');
    FakeAudio.instances[2]?.emit('error');
    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: 'message-2',
      state: 'error',
      diagnostic: 'Message audio could not be played.',
    });
  });

  it('cleans up only the matching message on unmount or edit', () => {
    playSpeech('message-1', '/audio/1');
    stopMessageSpeechPlayback('message-2');
    expect(getSpeechPlaybackSnapshot().messageId).toBe('message-1');

    stopMessageSpeechPlayback('message-1');
    expect(getSpeechPlaybackSnapshot()).toMatchObject({
      messageId: null,
      state: 'idle',
    });
  });

  it('cleans stalled playback after bounded inactivity and resets on progress', async () => {
    vi.useFakeTimers();
    playSpeech('message-1', '/audio/1');
    const stalled = FakeAudio.instances[0];
    stalled?.resolvePlay();
    await Promise.resolve();

    vi.advanceTimersByTime(SPEECH_PLAYBACK_WATCHDOG_MS - 1);
    stalled?.emit('timeupdate');
    vi.advanceTimersByTime(SPEECH_PLAYBACK_WATCHDOG_MS - 1);
    expect(getSpeechPlaybackSnapshot().state).toBe('playing');

    vi.advanceTimersByTime(1);
    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: 'message-1',
      state: 'error',
      diagnostic: 'Message audio stopped responding. Press play to retry.',
    });
    expect(stalled).toMatchObject({
      pauseCalls: 1,
      loadCalls: 1,
      removedSource: true,
    });
  });

  it('cleans an unexpectedly aborted media request', () => {
    playSpeech('message-1', '/audio/1');
    const aborted = FakeAudio.instances[0];

    aborted?.emit('abort');

    expect(getSpeechPlaybackSnapshot()).toEqual({
      messageId: 'message-1',
      state: 'error',
      diagnostic: 'Message audio playback was interrupted.',
    });
    expect(aborted).toMatchObject({
      pauseCalls: 1,
      loadCalls: 1,
      removedSource: true,
    });
  });

  it('locking stops existing speech and suppresses late synthesis playback until an explicit play after unlock', () => {
    playSpeech('message-1', '/audio/1');
    const first = FakeAudio.instances.at(-1);
    setSpeechPlaybackBlocked(true);
    expect(first?.pauseCalls).toBe(1);
    const count = FakeAudio.instances.length;
    playSpeech('message-2', '/audio/2');
    expect(FakeAudio.instances).toHaveLength(count);
    expect(getSpeechPlaybackSnapshot().state).toBe('idle');
    setSpeechPlaybackBlocked(false);
    expect(FakeAudio.instances).toHaveLength(count);
    playSpeech('message-2', '/audio/2');
    expect(FakeAudio.instances).toHaveLength(count + 1);
    stopSpeechPlayback();
  });
});
