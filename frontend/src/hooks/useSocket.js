import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

export function useSocket() {
  const socketRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [events, setEvents] = useState([]);
  const listenersRef = useRef(new Set());

  useEffect(() => {
    const s = io({ transports: ["websocket", "polling"] });
    socketRef.current = s;

    s.on("connect", () => setStatus("connected"));
    s.on("disconnect", () => setStatus("disconnected"));
    s.on("telemetry", (ev) => {
      setEvents((prev) => [...prev.slice(-200), ev]);
      listenersRef.current.forEach((fn) => fn(ev));
    });

    return () => s.disconnect();
  }, []);

  const onTelemetry = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { status, events, onTelemetry, clearEvents, socket: socketRef };
}
