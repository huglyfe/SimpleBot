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

  it('does not load Markdown image URLs', () => {
    const markup = render('![portrait](https://example.invalid/private.png)');

    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('https://example.invalid');
    expect(markup).toContain('[Image: portrait]');
  });
});
