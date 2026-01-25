import { useEffect, useMemo, useState } from "react";
import { StatePayload } from "../shared/types";

const formatTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const normalizeDomain = (input: string): string | null => {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
};

const getTodayKey = (): string => new Date().toISOString().slice(0, 10);

const isFocusActive = (payload: StatePayload | null): boolean => {
  if (!payload?.focus.isActive || !payload.focus.endsAt) {
    return false;
  }
  return Date.now() < payload.focus.endsAt;
};

export default function App() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number>(25);
  const [newDomain, setNewDomain] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "POPUP_GET_STATE" }).then((response) => {
      if (response?.payload) {
        setState(response.payload);
      }
    });

    const listener = (message: { type: string; payload: StatePayload }) => {
      if (message.type === "STATE_UPDATE" || message.type === "BACKGROUND_STATE") {
        setState(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const focusActive = isFocusActive(state);
  const remainingMs = focusActive && state?.focus.endsAt ? state.focus.endsAt - now : 0;

  const todayKey = getTodayKey();
  const todayUsage = state?.usageByDate[todayKey] ?? {};
  const topDomains = useMemo(() => {
    return Object.entries(todayUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [todayUsage]);

  const violations = state?.violationsByDate[todayKey] ?? 0;
  const petMood = focusActive ? (violations > 0 ? "gremlin" : "focused") : "idle";

  const handleToggleFocus = async () => {
    if (focusActive) {
      await chrome.runtime.sendMessage({ type: "POPUP_STOP_FOCUS" });
      return;
    }
    await chrome.runtime.sendMessage({
      type: "POPUP_START_FOCUS",
      durationMinutes: durationMinutes || 25
    });
  };

  const updateBlockedDomains = async (blockedDomains: string[]) => {
    await chrome.runtime.sendMessage({
      type: "POPUP_UPDATE_BLOCKED",
      blockedDomains
    });
  };

  const handleAddDomain = async () => {
    const normalized = normalizeDomain(newDomain);
    if (!normalized || !state) {
      return;
    }
    const next = Array.from(new Set([...state.blockedDomains, normalized]));
    await updateBlockedDomains(next);
    setNewDomain("");
  };

  const handleRemoveDomain = async (domain: string) => {
    if (!state) {
      return;
    }
    const next = state.blockedDomains.filter((item) => item !== domain);
    await updateBlockedDomains(next);
  };

  return (
    <div className="popup">
      <header className="popup-header">
        <div>
          <h1>Focoroco</h1>
          <p className="subtitle">Chaotic focus sprints + analytics</p>
        </div>
        <div className={`pet pet-${petMood}`}>
          <div className="pet-face">
            <span />
            <span />
          </div>
          <div className="pet-mouth" />
        </div>
      </header>

      <section className="card timer">
        <div>
          <p className="label">Sprint timer</p>
          <h2>{focusActive ? formatTime(remainingMs) : "Not running"}</h2>
          <p className="hint">
            {focusActive
              ? `Ends at ${new Date(state?.focus.endsAt ?? now).toLocaleTimeString()}`
              : "Start a sprint to activate focus mode."}
          </p>
        </div>
        {!focusActive && (
          <label className="field">
            Minutes
            <input
              type="number"
              min={5}
              max={90}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            />
          </label>
        )}
        <button className="primary" onClick={handleToggleFocus}>
          {focusActive ? "Stop sprint" : "Start sprint"}
        </button>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Blocked domains</h3>
          <span className="count">{state?.blockedDomains.length ?? 0}</span>
        </div>
        <div className="blocked-list">
          {(state?.blockedDomains ?? []).map((domain) => (
            <div key={domain} className="blocked-item">
              <span>{domain}</span>
              <button onClick={() => handleRemoveDomain(domain)}>Remove</button>
            </div>
          ))}
          {(state?.blockedDomains.length ?? 0) === 0 && (
            <p className="hint">No blocked domains yet.</p>
          )}
        </div>
        <div className="blocked-form">
          <input
            type="text"
            placeholder="Add domain (e.g. twitter.com)"
            value={newDomain}
            onChange={(event) => setNewDomain(event.target.value)}
          />
          <button onClick={handleAddDomain}>Add</button>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Today’s top domains</h3>
          <span className="count">{topDomains.length}</span>
        </div>
        <ul className="usage-list">
          {topDomains.map(([domain, ms]) => (
            <li key={domain}>
              <span>{domain}</span>
              <span>{formatTime(ms)}</span>
            </li>
          ))}
          {topDomains.length === 0 && <p className="hint">No usage yet.</p>}
        </ul>
      </section>

      <section className="card violations">
        <div>
          <h3>Focus-mode violations</h3>
          <p className="hint">Today</p>
        </div>
        <span className="violation-count">{violations}</span>
      </section>
    </div>
  );
}
