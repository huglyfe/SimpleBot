import { memo, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The one message-text renderer. The source string is read-only input:
 * mutations and clipboard actions continue to use the untouched message part.
 */
export const RoleplayMarkdown = memo(function RoleplayMarkdown({
  source,
}: {
  source: string;
}): ReactElement {
  return (
    <div className="msg-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ children, ...props }) {
            return (
              <a {...props} rel="noreferrer">
                {children}
              </a>
            );
          },
          img({ alt }) {
            return (
              <span className="msg-markdown-image-alt">
                {alt ? `[Image: ${alt}]` : '[Image]'}
              </span>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
