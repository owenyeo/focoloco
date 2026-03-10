import type {
  BackgroundToContentMessage,
  StatePayload
} from "../shared/types";

const OVERLAY_ID = "focoroco-overlay";
const SNOOZE_SECONDS = 60;
const PENALTY_MINUTES = 5;
const OVERLAY_HTML = `
  <div class="focoroco-card">
    <div class="focoroco-title">Focus mode</div>
    <div class="focoroco-body">
      This site is blocked during your sprint.
    </div>
    <div class="focoroco-actions">
      <button data-action="go-back">Go back</button>
      <button data-action="insist">Snooze 1 min</button>
      <button data-action="penalty">Take penalty</button>
    </div>
  </div>
`;
const OVERLAY_CSS = `
  #${OVERLAY_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(10, 10, 10, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: "Trebuchet MS", Verdana, Arial, sans-serif;
  }
  #${OVERLAY_ID} .focoroco-card {
    width: min(420px, 92vw);
    background: #f9f5ef;
    color: #1c1b1a;
    border: 3px solid #1c1b1a;
    box-shadow: 8px 8px 0 #1c1b1a;
    padding: 20px;
    text-align: center;
  }
  #${OVERLAY_ID} .focoroco-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 8px;
  }
  #${OVERLAY_ID} .focoroco-body {
    font-size: 14px;
    margin-bottom: 16px;
  }
  #${OVERLAY_ID} .focoroco-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
  #${OVERLAY_ID} button {
    appearance: none;
    border: 2px solid #1c1b1a;
    background: #ffffff;
    color: #1c1b1a;
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 600;
  }
  #${OVERLAY_ID} button[data-action="penalty"] {
    background: #ffd3d3;
  }
`;

// Normalize a hostname for matching/storage.
const normalizeHostname = (value: string): string => {
  const trimmed = value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  return trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;
};

// True when `hostname` exactly matches or is a subdomain of `blockedDomain`.
const hostnameMatchesBlockedDomain = (
  hostname: string,
  blockedDomain: string
): boolean => {
  const host = normalizeHostname(hostname);
  const blocked = normalizeHostname(blockedDomain);
  if (!host || !blocked) {
    return false;
  }
  return host === blocked || host.endsWith(`.${blocked}`);
};

const isHostnameBlocked = (hostname: string, blockedDomains: string[]): boolean =>
  blockedDomains.some((blockedDomain) =>
    hostnameMatchesBlockedDomain(hostname, blockedDomain)
  );

const getHostname = (): string | null => {
  try {
    return normalizeHostname(window.location.hostname);
  } catch {
    return null;
  }
};

const isFocusActive = (payload: StatePayload): boolean => {
  const focus = payload.focus;
  if (!focus.isActive || !focus.endsAt) {
    return false;
  }
  return Date.now() < focus.endsAt;
};

const shouldShowOverlay = (payload: StatePayload): boolean => {
  const hostname = getHostname();
  if (!hostname) {
    return false;
  }
  if (!isFocusActive(payload)) {
    return false;
  }
  if (!isHostnameBlocked(hostname, payload.blockedDomains)) {
    return false;
  }
  const snoozedUntil = payload.snoozedUntilByDomain[hostname] ?? 0;
  return Date.now() > snoozedUntil;
};

const removeOverlay = () => {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
};

const createOverlay = (_payload: StatePayload) => {
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = OVERLAY_HTML;

  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;

  overlay.appendChild(style);
  (document.body || document.documentElement).appendChild(overlay);

  overlay.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.tagName !== "BUTTON") return;

    const action = target.getAttribute("data-action");
    if (!action) return;

    if (action === "go-back") {
      if (window.history.length > 1) window.history.back();
      else chrome.runtime.sendMessage({ type: "CONTENT_CLOSE_TAB" });
      removeOverlay();
      return;
    }

    if (action === "insist") {
      const hostname = getHostname();
      if (hostname) {
        chrome.runtime.sendMessage({
          type: "CONTENT_SNOOZE_DOMAIN",
          hostname,
          snoozeSeconds: SNOOZE_SECONDS,
        });
      }
      removeOverlay();
      return;
    }

    if (action === "penalty") {
      const hostname = getHostname();
      if (hostname) {
        chrome.runtime.sendMessage({
          type: "CONTENT_SNOOZE_DOMAIN",
          hostname,
          snoozeSeconds: SNOOZE_SECONDS,
        });
      }
      chrome.runtime.sendMessage({
        type: "CONTENT_ADD_PENALTY",
        minutes: PENALTY_MINUTES,
      });
      removeOverlay();
      return;
    }
  });
};

const applyState = (payload: StatePayload) => {
  if (shouldShowOverlay(payload)) {
    createOverlay(payload);
  } else {
    removeOverlay();
  }
};

const requestState = async () => {
  const response = (await chrome.runtime.sendMessage({
    type: "CONTENT_GET_STATE"
  })) as BackgroundToContentMessage | { type: "BACKGROUND_STATE"; payload: StatePayload };

  if (response && "payload" in response) {
    applyState(response.payload);
  }
};

chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage) => {
  if (message.type === "STATE_UPDATE") {
    applyState(message.payload);
  }
});

void requestState();
