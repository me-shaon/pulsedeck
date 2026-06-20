import type { MarkdownBlock as MarkdownBlockT } from '@pulsedeck/schema';
import ReactMarkdown from 'react-markdown';
import { BlockFrame } from './block-frame';

/**
 * markdown — agent prose.
 *
 * XSS GUARD: `skipHtml` strips any raw HTML in the content and we deliberately
 * DO NOT add `rehype-raw`. Agent-authored markdown is untrusted; only the
 * markdown grammar is rendered, never embedded `<script>`/`<img onerror>` etc.
 * Links open safely in a new tab.
 */
export function MarkdownBlock({ block }: { block: MarkdownBlockT }) {
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <div className="pd-markdown text-sm leading-relaxed text-foreground">
        <ReactMarkdown
          skipHtml
          components={{
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand underline-offset-2 hover:underline"
              >
                {children}
              </a>
            ),
          }}
        >
          {block.content}
        </ReactMarkdown>
      </div>
    </BlockFrame>
  );
}
