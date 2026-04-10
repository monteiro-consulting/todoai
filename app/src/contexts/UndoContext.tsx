import { createContext, useContext, useCallback, useRef, useEffect, useState } from "react";

interface UndoEntry {
  label: string;
  fn: () => Promise<void>;
}

interface UndoCtx {
  pushUndo: (entry: UndoEntry) => void;
}

const Ctx = createContext<UndoCtx>({ pushUndo: () => {} });

export function useUndo() {
  return useContext(Ctx);
}

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const stackRef = useRef<UndoEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const pushUndo = useCallback((entry: UndoEntry) => {
    stackRef.current.push(entry);
    // Keep max 20
    if (stackRef.current.length > 20) stackRef.current.shift();
  }, []);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        // Don't intercept if focused on input/textarea (native undo)
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        e.preventDefault();
        const entry = stackRef.current.pop();
        if (entry) {
          try {
            await entry.fn();
            setToast(`Undo: ${entry.label}`);
          } catch {
            setToast("Undo failed");
          }
          setTimeout(() => setToast(null), 2000);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Ctx.Provider value={{ pushUndo }}>
      {children}
      {toast && <div className="undo-toast">{toast}</div>}
    </Ctx.Provider>
  );
}
