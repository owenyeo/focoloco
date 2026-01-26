import type {
  BackgroundToContentMessage,
  StatePayload
} from "../shared/types";

const OVERLAY_ID = "focoroco-overlay";
const SNOOZE_SECONDS = 60;
const PENALTY_MINUTES = 5;

const getHostname = (): string | null => {
  try {
    return window.location.hostname;
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
  if (!payload.blockedDomains.includes(hostname)) {
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
  overlay.innerHTML = `...`; // keep your HTML

  const style = document.createElement("style");
  style.textContent = `...`; // keep your CSS

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
