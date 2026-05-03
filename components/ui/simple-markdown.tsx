// Lightweight markdown renderer. Handles ##, ###, **bold**, *italic*,
// `code`, [text](url), and -/* lists. Used for the research insight banner.
//
// Inline content is sanitized: we only emit anchor/strong/em/code wrappers
// from a controlled set of patterns. We escape < & > before applying
// patterns to prevent injection from arbitrary AI output.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseInline(s: string): string {
  const escaped = escapeHtml(s);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(
      /`(.+?)`/g,
      '<code class="px-1 py-0.5 bg-surface-1 rounded text-xs">$1</code>'
    )
    .replace(
      /\[(.+?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener" class="text-accent hover:underline">$1</a>'
    );
}

export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <ul
        key={`list-${elements.length}`}
        className="list-disc pl-5 my-2 space-y-1 text-text-2"
      >
        {listItems.map((item, i) => (
          <li
            key={i}
            dangerouslySetInnerHTML={{ __html: parseInline(item) }}
          />
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3
          key={`h3-${i}`}
          className="font-display text-lg font-medium mt-4 mb-2"
        >
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2
          key={`h2-${i}`}
          className="font-display text-xl font-light mt-4 mb-2"
        >
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2));
    } else if (line.trim()) {
      flushList();
      elements.push(
        <p
          key={`p-${i}`}
          className="my-2 text-text-2 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: parseInline(line) }}
        />
      );
    }
  });
  flushList();

  return <div>{elements}</div>;
}
