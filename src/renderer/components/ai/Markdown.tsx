import { Fragment, type ReactNode } from 'react';

/** Inline `code` and **bold**; everything else is plain text, and nothing is ever interpreted as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type Block = { kind: 'code'; text: string } | { kind: 'list'; items: string[] } | { kind: 'paragraph'; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (index += 1; index < lines.length && !(lines[index] ?? '').startsWith('```'); index += 1) {
        code.push(lines[index] ?? '');
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      for (; index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index] ?? ''); index += 1) {
        items.push((lines[index] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, ''));
      }
      index -= 1;
      blocks.push({ kind: 'list', items });
    } else if (line.trim() !== '') {
      const paragraph: string[] = [line];
      while (index + 1 < lines.length && (lines[index + 1] ?? '').trim() !== '' && !(lines[index + 1] ?? '').startsWith('```') && !/^\s*([-*]|\d+\.)\s+/.test(lines[index + 1] ?? '')) {
        index += 1;
        paragraph.push(lines[index] ?? '');
      }
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    }
  }
  return blocks;
}

/** Minimal Markdown for assistant answers: paragraphs, lists, code blocks, inline code and bold. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parse(text).map((block, index) => {
        if (block.kind === 'code') {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
