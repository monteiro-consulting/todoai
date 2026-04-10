import { getCurrentWindow } from "@tauri-apps/api/window";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import DataToolbar from "./DataToolbar";

const isDev = window.location.hostname === "localhost" && window.location.port === "1420";

export default function TitleBar() {
  const appWindow = getCurrentWindow();

  const handleDrag = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("titlebar-title")) {
      e.preventDefault();
      appWindow.startDragging();
    }
  };

  return (
    <div className={`titlebar${isDev ? " titlebar-dev" : ""}`} onMouseDown={handleDrag}>
      {isDev && <span className="dev-dot" />}
      <span className="titlebar-title">TodoAI</span>
      <div className="titlebar-buttons">
        <DataToolbar />
        <ThemeToggle />
        <NotificationBell />
        <button className="titlebar-btn" onClick={() => appWindow.minimize()} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1" style={{ pointerEvents: "none" }}><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="titlebar-btn" onClick={() => appWindow.toggleMaximize()} title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ pointerEvents: "none" }}><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="titlebar-btn titlebar-close" onClick={() => appWindow.close()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ pointerEvents: "none" }}><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
