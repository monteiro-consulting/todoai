import { useState } from "react";
import { api } from "../api/client";

interface Props {
  projectId?: string;
  onCreated: () => void;
}

export default function DumpBox({ projectId, onCreated }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDump = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await api.dumpCreate(text, projectId);
      setText("");
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <textarea
        className="dump-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Dump tasks here (one per line)...&#10;- Buy groceries&#10;- Fix login bug&#10;- Write docs"
      />
      <button onClick={handleDump} disabled={loading}>
        {loading ? "Creating..." : "Create Tasks from Dump"}
      </button>
    </div>
  );
}
