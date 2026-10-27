import { memo, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

const DIALOGUE_DELIMITERS = new Map([
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
  ['「', '」'],
  ['『', '』'],
  ['＂', '＂'],
]);

function dialogueNode(children: MarkdownNode[]): MarkdownNode {
  return {
    type: 'dialogue',
    data: {
      hName: 'span',
      hProperties: { className: ['msg-dialogue'] },
    },
    children,
  };
}

function nextOpeningDelimiter(
  value: string,
  from: number,
): { index: number; closer: string } | null {
  let next: { index: number; closer: string } | null = null;
  for (const [opener, closer] of DIALOGUE_DELIMITERS) {
    const index = value.indexOf(opener, from);
    if (index >= 0 && (next === null || index < next.index)) {
      next = { index, closer };
    }
  }
  return next;
}

function appendDialogue(
  output: MarkdownNode[],
  dialogue: MarkdownNode[],
): void {
  let phrasing: MarkdownNode[] = [];
  const flush = (): void => {
    if (phrasing.length > 0) output.push(dialogueNode(phrasing));
    phrasing = [];
  };
  for (const child of dialogue) {
    if (child.type === 'inlineCode' || child.type === 'code') {
      flush();
      output.push(child);
    } else {
      phrasing.push(child);
    }
  }
  flush();
}

const PHRASING_CONTAINERS = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
]);

/**
 * Wraps complete quote ranges at a phrasing-container boundary. A range may
 * include emphasis, strong text, links, and soft line breaks; code nodes are
 * emitted outside the dialogue span.
 */
function splitDialogueAcrossChildren(node: MarkdownNode): void {
  if (!node.children || !PHRASING_CONTAINERS.has(node.type)) return;

  const output: MarkdownNode[] = [];
  let dialogue: MarkdownNode[] = [];
  let closer: string | null = null;

  for (const child of node.children) {
    if (child.type !== 'text' || child.value === undefined) {
      if (closer === null) output.push(child);
      else dialogue.push(child);
      continue;
    }

    let cursor = 0;
    while (cursor < child.value.length) {
      if (closer === null) {
        const opening = nextOpeningDelimiter(child.value, cursor);
        if (opening === null) {
          output.push({ type: 'text', value: child.value.slice(cursor) });
          cursor = child.value.length;
          continue;
        }
        if (opening.index > cursor) {
          output.push({
            type: 'text',
            value: child.value.slice(cursor, opening.index),
          });
        }
        closer = opening.closer;
        dialogue = [
          {
            type: 'text',
            value: child.value.slice(opening.index, opening.index + 1),
          },
        ];
        cursor = opening.index + 1;
        continue;
      }

      const closingIndex = child.value.indexOf(closer, cursor);
      if (closingIndex < 0) {
        dialogue.push({ type: 'text', value: child.value.slice(cursor) });
        cursor = child.value.length;
        continue;
      }
      dialogue.push({
        type: 'text',
        value: child.value.slice(cursor, closingIndex + 1),
      });
      appendDialogue(output, dialogue);
      dialogue = [];
      closer = null;
      cursor = closingIndex + 1;
    }
  }

  // An incomplete quote is ordinary source, not a partially highlighted run.
  if (dialogue.length > 0) output.push(...dialogue);
  node.children = output;
}

/**
 * Highlight dialogue after Markdown parsing. Code nodes are structurally
 * separate from text nodes, so inline and fenced code remain untouched.
 */
function remarkDialogue() {
  return function transform(tree: MarkdownNode): void {
    function visit(node: MarkdownNode): void {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type !== 'code' && child.type !== 'inlineCode') visit(child);
      }
      splitDialogueAcrossChildren(node);
    }
    visit(tree);
  };
}

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
        remarkPlugins={[remarkGfm, remarkDialogue]}
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
