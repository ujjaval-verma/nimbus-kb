import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkCitations } from "../citations";

// Model output is untrusted. No raw HTML (skipHtml), no images, and no clickable outside links:
// only citation anchors become chips; every other link renders as its plain text.
// Chips only for ids the server validated and returned in done.passages; unknown ids stay plain text (spec §5).
export function AnswerMarkdown({ markdown, citedIds, onCite }: { markdown: string; citedIds: ReadonlySet<string>; onCite: (id: string) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        img: () => null,
        a: ({ href, children }) => {
          const id = href?.startsWith("#src-") ? href.slice(5) : null;
          if (id && citedIds.has(id)) {
            return <button type="button" className="chip" data-cite={id} onClick={() => onCite(id)}>{children}</button>;
          }
          return <span className={id ? "cite-plain" : "plain-link"}>{children}</span>;
        },
      }}
    >
      {linkCitations(markdown)}
    </ReactMarkdown>
  );
}
