import { Fragment } from 'react';

// 가이드 문서(docs/*.md) 하나를 화면에 그대로 보여주기 위한 최소 마크다운 렌더러.
// 제목/문단/목록/인용/표/코드블록/구분선과 **굵게**, `코드`만 지원한다 — 그 이상이 필요해지면
// 라이브러리(react-markdown)로 교체한다.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="md-code">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function MarkdownView({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;

    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="md-pre">{code.join('\n')}</pre>);
    } else if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = renderInline(line.replace(/^#+\s*/, ''));
      blocks.push(level === 1 ? <h1 key={key} className="md-h1">{text}</h1> : level === 2 ? <h2 key={key} className="md-h2">{text}</h2> : <h3 key={key} className="md-h3">{text}</h3>);
      i++;
    } else if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key} className="md-hr" />);
      i++;
    } else if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      const [head, , ...body] = rows;
      blocks.push(
        <table key={key} className="md-table">
          <thead><tr>{head.map((c, j) => <th key={j}>{renderInline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{renderInline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) quote.push(lines[i++].slice(2));
      blocks.push(<blockquote key={key} className="md-quote">{renderInline(quote.join(' '))}</blockquote>);
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      blocks.push(<ul key={key} className="md-ul">{items.map((t, j) => <li key={j}>{renderInline(t)}</li>)}</ul>);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,3} |---+$|\||> |- )/.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={key} className="md-p">{renderInline(para.join(' '))}</p>);
    }
  }

  return (
    <div className="md-root">
      {blocks}
      <style>{`
        .md-root { font-size: 0.875rem; line-height: 1.6; color: var(--foreground); }
        .md-h1 { font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem; }
        .md-h2 { font-size: 1.05rem; font-weight: 800; margin: 1.25rem 0 0.5rem; color: var(--primary); }
        .md-h3 { font-size: 0.95rem; font-weight: 700; margin: 1rem 0 0.4rem; }
        .md-p { margin: 0.4rem 0; }
        .md-hr { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }
        .md-ul { margin: 0.4rem 0; padding-left: 1.25rem; list-style: disc; }
        .md-quote { margin: 0.6rem 0; padding: 0.6rem 0.85rem; background: #f8fafc; border-left: 3px solid #94a3b8; border-radius: 6px; }
        .md-code { font-family: ui-monospace, monospace; font-size: 0.8125rem; background: #f1f5f9; padding: 0.05rem 0.35rem; border-radius: 4px; }
        .md-pre { margin: 0.5rem 0; padding: 0.75rem 0.9rem; background: #0f172a; color: #e2e8f0; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 0.8125rem; line-height: 1.6; overflow-x: auto; white-space: pre; }
        .md-table { width: 100%; border-collapse: collapse; margin: 0.6rem 0; font-size: 0.8125rem; }
        .md-table th { text-align: left; background: #f1f5f9; font-weight: 700; }
        .md-table th, .md-table td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; vertical-align: top; }
      `}</style>
    </div>
  );
}
