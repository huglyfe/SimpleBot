import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Composer, type ComposerProps } from './Composer.js';

let sessionCounter = 0;

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  sessionCounter += 1;
  const props: ComposerProps = {
    sessionId: `session-${String(sessionCounter)}`,
    botName: 'Seraphina',
    generating: false,
    error: null,
    onDismissError: () => undefined,
    onSend: () => Promise.resolve(),
    onStop: () => undefined,
    ...overrides,
  };
  const view = render(<Composer {...props} />);
  return {
    ...view,
    rerenderWith: (next: Partial<ComposerProps>) =>
      view.rerender(<Composer {...props} {...next} />),
  };
}

function pngFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: 'image/png',
    lastModified: 1_700_000_000_000,
  });
}

describe('Composer', () => {
  it('keeps the exact draft and files while the send is queued', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => new Promise<void>(() => undefined));
    const { rerenderWith } = renderComposer({ onSend });

    await user.type(screen.getByLabelText('Message'), '  waiting here  ');
    await user.upload(screen.getByLabelText('Choose images'), pngFile('a.png'));
    await user.click(screen.getByLabelText('Send message'));
    rerenderWith({ generating: true });

    expect(onSend).toHaveBeenCalledWith(
      'waiting here',
      [expect.objectContaining({ name: 'a.png' })],
      expect.any(Function),
    );
    expect(screen.getByLabelText('Message')).toHaveValue('  waiting here  ');
    expect(screen.getByLabelText('Remove a.png')).toBeDisabled();
    expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
  });

  it('clears the composer only when the server admits the turn', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn((_text: string, _files: File[], admit: () => void) => {
      admit();
      return Promise.resolve();
    });
    renderComposer({ onSend });

    await user.type(screen.getByLabelText('Message'), 'admit this');
    await user.upload(screen.getByLabelText('Choose images'), pngFile('a.png'));
    await user.click(screen.getByLabelText('Send message'));

    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.queryByLabelText('Remove a.png')).not.toBeInTheDocument();
  });

  it('replaces Stop with a fresh Send control after generation', () => {
    const { rerenderWith } = renderComposer({ generating: true });
    const stop = screen.getByLabelText('Stop response');

    rerenderWith({ generating: false });

    const send = screen.getByLabelText('Send message');
    expect(send).not.toBe(stop);
    expect(stop).not.toBeInTheDocument();
  });

  it('leaves Enter as a newline', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => Promise.resolve());
    renderComposer({ onSend });

    const message = screen.getByLabelText('Message');
    await user.type(message, 'one{Enter}two');
    expect(onSend).not.toHaveBeenCalled();
    expect(message).toHaveValue('one\ntwo');

    await user.click(screen.getByLabelText('Send message'));
    expect(onSend).toHaveBeenCalledWith('one\ntwo', [], expect.any(Function));
  });

  it.each(['Meta', 'Control'])(
    'sends with %s Enter through admission',
    async (modifier) => {
      const user = userEvent.setup();
      const onSend = vi.fn(
        (_text: string, _files: File[], admit: () => void) => {
          admit();
          return Promise.resolve();
        },
      );
      renderComposer({ onSend });
      await user.type(screen.getByLabelText('Message'), '  keyboard send  ');
      await user.upload(
        screen.getByLabelText('Choose images'),
        pngFile('a.png'),
      );
      await user.click(screen.getByLabelText('Message'));
      await user.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
      expect(onSend).toHaveBeenCalledExactlyOnceWith(
        'keyboard send',
        [expect.objectContaining({ name: 'a.png' })],
        expect.any(Function),
      );
      expect(screen.getByLabelText('Message')).toHaveValue('');
      expect(screen.queryByLabelText('Remove a.png')).not.toBeInTheDocument();
    },
  );

  it('ignores shortcut composition, key repeat, blank drafts, and generation', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => Promise.resolve());
    const { rerenderWith } = renderComposer({ onSend });
    const message = screen.getByLabelText('Message');
    fireEvent.keyDown(message, { key: 'Enter', metaKey: true });
    await user.type(message, 'keep this');
    fireEvent.keyDown(message, {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(message, { key: 'Enter', ctrlKey: true, repeat: true });
    rerenderWith({ generating: true });
    fireEvent.keyDown(message, { key: 'Enter', metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(message).toHaveValue('keep this');
  });

  it('keeps session drafts separate across remounts', async () => {
    const user = userEvent.setup();
    const first = 'session-draft-one';
    const { unmount } = renderComposer({ sessionId: first });
    await user.type(screen.getByLabelText('Message'), 'first draft');
    unmount();

    const second = renderComposer({ sessionId: 'session-draft-two' });
    expect(screen.getByLabelText('Message')).toHaveValue('');
    second.unmount();
    renderComposer({ sessionId: first });
    expect(screen.getByLabelText('Message')).toHaveValue('first draft');
  });

  it('stages only supported unique images up to the cap', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByLabelText('Choose images');

    await user.upload(input, pngFile('a.png'));
    await user.upload(input, pngFile('a.png'));
    await user.upload(
      input,
      Array.from({ length: 9 }, (_, index) => pngFile(`f${String(index)}.png`)),
    );

    expect(screen.getAllByLabelText(/^Remove /u)).toHaveLength(8);
    expect(screen.getByLabelText(/^Add images/u)).toBeDisabled();
  });
});
