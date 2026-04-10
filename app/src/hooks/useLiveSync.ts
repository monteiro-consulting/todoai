import { useEffect, useRef } from "react";

type ChangeEvent = {
  type: "project" | "task";
  action: string;
  id: string;
  ts: number;
};

type Listener = (event: ChangeEvent) => void;

const listeners = new Set<Listener>();
let eventSource: EventSource | null = null;

const eventsUrl = "http://127.0.0.1:18427/api/events";

function connect() {
  if (eventSource) return;
  eventSource = new EventSource(eventsUrl);

  eventSource.onmessage = (e) => {
    try {
      const data: ChangeEvent = JSON.parse(e.data);
      listeners.forEach((fn) => fn(data));
    } catch {}
  };

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    setTimeout(connect, 2000);
  };
}

connect();

export function useLiveSync(
  entityType: "project" | "task" | "all",
  callback: () => void
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const listener: Listener = (event) => {
      if (entityType === "all" || event.type === entityType) {
        callbackRef.current();
      }
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [entityType]);
}
