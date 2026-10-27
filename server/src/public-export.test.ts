import assert from 'node:assert/strict';
import test from 'node:test';
import { publicContent } from '../scripts/public-content.js';

test('release text excludes marked private sections and remains stable when exported again', () => {
  for (const [start, end] of [
    ['<!-- private:start -->', '<!-- private:end -->'],
    ['// private:start', '// private:end'],
    ['# private:start', '# private:end'],
  ] as const) {
    const source = `Public introduction\n${start}\nPRIVATE SENTINEL\n${end}\nRequired attribution\n`;
    const released = publicContent(source);
    assert.equal(released, 'Public introduction\nRequired attribution\n');
    assert.equal(publicContent(released), released);
  }
});

test('release text refuses malformed private sections instead of silently publishing them', () => {
  for (const source of [
    '<!-- private:start -->\nPRIVATE SENTINEL',
    '<!-- private:end -->',
    '# private:start\n# private:start\n# private:end',
  ])
    assert.throws(() => publicContent(source), /private release section/u);
});
