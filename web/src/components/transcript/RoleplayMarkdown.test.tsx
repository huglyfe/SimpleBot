import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoleplayMarkdown } from './RoleplayMarkdown.js';

function render(source: string): string {
  return renderToStaticMarkup(<RoleplayMarkdown source={source} />);
}

describe('RoleplayMarkdown', () => {
  it('renders GFM and displays raw HTML as text without creating HTML elements', () => {
    const markup = render(
      '# Heading\n\n- **bold**\n- ~~gone~~\n\n<div>Keep this text.</div>\n\n<script>alert("no")</script>\n\n<img src="https://example.invalid/private.png" onerror="alert(1)">',
    );

    expect(markup).toContain('<h1>Heading</h1>');
    expect(markup).toContain('<strong>bold</strong>');
    expect(markup).toContain('<del>gone</del>');
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;div&gt;Keep this text.&lt;/div&gt;');
    expect(markup).toContain(
      '&lt;script&gt;alert(&quot;no&quot;)&lt;/script&gt;',
    );
    expect(markup).toContain('&lt;img src=');
    expect(markup).not.toContain('<img');
  });

  it('highlights all six recognized dialogue quote styles', () => {
    const quotes = [
      '"straight"',
      '“curly”',
      '«guillemets»',
      '「corner」',
      '『white corner』',
      '＂fullwidth＂',
    ];
    const markup = render(quotes.join(' '));

    expect(markup.match(/class="msg-dialogue"/gu)).toHaveLength(6);
    expect(markup).toContain('&quot;straight&quot;');
    for (const quote of quotes.slice(1)) expect(markup).toContain(quote);
  });

  it('does not highlight dialogue-like quotes inside inline or fenced code', () => {
    const markup = render(
      '`"inline"` and “dialogue”\n\n```txt\n「fenced」\n```\n',
    );

    expect(markup.match(/class="msg-dialogue"/gu)).toHaveLength(1);
    expect(markup).toContain('<code>&quot;inline&quot;</code>');
    expect(markup).toContain('「fenced」');
  });

  it('keeps inline code outside a surrounding dialogue treatment', () => {
    const markup = render('“before `"code"` after”');

    expect(markup).toContain('<code>&quot;code&quot;</code>');
    expect(markup).not.toMatch(/msg-dialogue[^>]*><code>/u);
  });

  it('preserves Markdown formatting and links inside a dialogue range', () => {
    const markup = render(
      '“hello **there**, *friend* — visit [home](https://example.com)”',
    );

    expect(markup.match(/class="msg-dialogue"/gu)).toHaveLength(1);
    expect(markup).toContain('<strong>there</strong>');
    expect(markup).toContain('<em>friend</em>');
    expect(markup).toContain('<a href="https://example.com"');
  });

  it('highlights multiline dialogue but leaves incomplete quotes ordinary', () => {
    const multiline = render('"first line\nsecond line"');
    const incomplete = render('“unfinished **thought**');

    expect(multiline.match(/class="msg-dialogue"/gu)).toHaveLength(1);
    expect(multiline).toContain('first line\nsecond line');
    expect(incomplete).not.toContain('class="msg-dialogue"');
    expect(incomplete).toContain('<strong>thought</strong>');
  });

  it('keeps escaped Markdown literal while highlighting its dialogue', () => {
    const markup = render('“keep \\*these asterisks\\* visible”');

    expect(markup.match(/class="msg-dialogue"/gu)).toHaveLength(1);
    expect(markup).toContain('*these asterisks*');
    expect(markup).not.toContain('<em>');
  });

  it('does not load Markdown image URLs', () => {
    const markup = render('![portrait](https://example.invalid/private.png)');

    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('https://example.invalid');
    expect(markup).toContain('[Image: portrait]');
  });
});
