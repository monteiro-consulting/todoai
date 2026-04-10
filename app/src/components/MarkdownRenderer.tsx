import ReactMarkdown from "react-markdown";

interface Props {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className }: Props) {
  return (
    <div className={`markdown-content ${className || ""}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
