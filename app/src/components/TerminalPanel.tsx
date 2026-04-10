import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

interface TerminalPanelProps {
  /** Whether the panel is visible (controls fit recalculation). */
  visible?: boolean;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
}

/**
 * Builds the WebSocket URL for the terminal endpoint.
 * In dev (Vite proxy) we use relative ws:// on the same host.
 * In production / Tauri we fall back to the backend directly.
 */
function wsUrl(): string {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/api/terminal/ws`;
}

export default function TerminalPanel({ visible = true, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("disconnected");

  // ---- connect to backend WebSocket ----
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    setConnState("connecting");
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnState("connected");
      // Spawn the claude process on the backend
      ws.send(JSON.stringify({ action: "start" }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === "output" && msg.data) {
          termRef.current?.write(msg.data);
        } else if (msg.event === "started") {
          termRef.current?.write("\r\n\x1b[32m● Process started\x1b[0m\r\n");
        } else if (msg.event === "exited") {
          termRef.current?.write(
            `\r\n\x1b[33m● Process exited (code ${msg.code ?? "?"})\x1b[0m\r\n`
          );
        } else if (msg.event === "error" && msg.message) {
          termRef.current?.write(`\r\n\x1b[31m✗ ${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        // non-JSON – write raw
        termRef.current?.write(ev.data);
      }
    };

    ws.onerror = () => {
      setConnState("error");
    };

    ws.onclose = () => {
      setConnState("disconnected");
      wsRef.current = null;
    };
  }, []);

  // ---- send stdin data ----
  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "input", data }));
    }
  }, []);

  // ---- initialize xterm ----
  useEffect(() => {
    if (!containerRef.current) return;

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--terminal-bg").trim() || "#0f0f0f";
    const fg = styles.getPropertyValue("--terminal-fg").trim() || "#e5e5e5";
    const cursor = styles.getPropertyValue("--terminal-cursor").trim() || "#6366f1";
    const selection = styles.getPropertyValue("--terminal-selection").trim() || "#6366f144";

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 14,
      theme: {
        background: bg,
        foreground: fg,
        cursor,
        selectionBackground: selection,
        black: bg,
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#6366f1",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: fg,
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // Fit after first paint
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Forward user keystrokes to the WebSocket backend
    term.onData((data) => {
      sendInput(data);
    });

    // Auto-connect
    connect();

    return () => {
      // Cleanup
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- handle resize ----
  useEffect(() => {
    const handleResize = () => {
      if (visible && fitRef.current) {
        try {
          fitRef.current.fit();
        } catch {
          // container may not be sized yet
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Also refit when the panel becomes visible
    if (visible) {
      requestAnimationFrame(() => handleResize());
    }

    return () => window.removeEventListener("resize", handleResize);
  }, [visible]);

  // ---- reconnect button ----
  const handleReconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
    termRef.current?.clear();
    connect();
  };

  return (
    <div className="terminal-panel" style={{ display: visible ? "flex" : "none" }}>
      {/* Status bar */}
      <div className="terminal-panel-header">
        <div className="terminal-panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          Terminal
        </div>
        <div className="terminal-panel-actions">
          <div className="terminal-panel-status">
            <span
              className={`terminal-status-dot terminal-status-${connState}`}
            />
            {connState === "disconnected" || connState === "error" ? (
              <button className="terminal-reconnect-btn" onClick={handleReconnect}>
                Reconnect
              </button>
            ) : (
              <span className="terminal-status-label">{connState}</span>
            )}
          </div>
          {onClose && (
            <button className="terminal-close-btn" onClick={onClose} title="Close terminal">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="2" y1="2" x2="10" y2="10" />
                <line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* xterm container */}
      <div className="terminal-panel-body" ref={containerRef} />
    </div>
  );
}
