import { useRef, useState } from "react";

const BASE = "http://127.0.0.1:18427/api";

export default function DataToolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleExport = async (format: "json" | "csv") => {
    try {
      const res = await fetch(`${BASE}/data/export?format=${format}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `todoai_export.${format === "json" ? "json" : "zip"}`;
      a.click();
      URL.revokeObjectURL(url);
      setToast(`Exported as ${format.toUpperCase()}`);
      setTimeout(() => setToast(null), 2000);
    } catch {
      setToast("Export failed");
      setTimeout(() => setToast(null), 2000);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/data/import?mode=merge`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setToast(`Imported ${result.projects_imported} projects, ${result.tasks_imported} tasks`);
      setTimeout(() => { setToast(null); window.location.reload(); }, 2500);
    } catch {
      setToast("Import failed");
      setTimeout(() => setToast(null), 2000);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <div className="data-toolbar">
        <button
          className="titlebar-btn"
          onClick={() => handleExport("json")}
          title="Export JSON"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ pointerEvents: "none" }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={() => fileRef.current?.click()}
          title="Import data"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ pointerEvents: "none" }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.zip"
          hidden
          onChange={handleImport}
        />
      </div>
      {toast && <div className="undo-toast">{toast}</div>}
    </>
  );
}
