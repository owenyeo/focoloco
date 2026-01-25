import {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
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

const createOverlay = (payload: StatePayload) => {
  removeOverlay();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="focoroco-card">
      <div class="focoroco-pet">
        <div class="focoroco-face">
          <span class="focoroco-eye"></span>
          <span class="focoroco-eye"></span>
        </div>
        <div class="focoroco-mouth"></div>
      </div>
      <div class="focoroco-copy">
        <h2>Are you sure?</h2>
        <p>Focoroco is trying to keep you on track.</p>
      </div>
      <div class="focoroco-actions">
        <button data-action="go-back">Go back</button>
        <button data-action="insist">I insist (60s)</button>
        <button data-action="penalty">Add 5 min penalty</button>
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
      background: rgba(10, 10, 20, 0.45);
      z-index: 999999;
      font-family: "Inter", system-ui, sans-serif;
    }
    #${OVERLAY_ID} .focoroco-card {
      width: min(480px, 90vw);
      background: #111827;
      color: #f9fafb;
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      border: 2px solid #34d399;
      display: grid;
      gap: 16px;
    }
    #${OVERLAY_ID} .focoroco-pet {
      width: 120px;
      height: 120px;
      border-radius: 30px;
      background: linear-gradient(135deg, #34d399, #60a5fa);
      display: grid;
      place-items: center;
      margin: 0 auto;
    }
    #${OVERLAY_ID} .focoroco-face {
      display: flex;
      gap: 10px;
    }
    #${OVERLAY_ID} .focoroco-eye {
      width: 14px;
      height: 14px;
      background: #0f172a;
      border-radius: 50%;
    }
    #${OVERLAY_ID} .focoroco-mouth {
      width: 40px;
      height: 12px;
      border-radius: 999px;
      background: #0f172a;
      margin-top: 8px;
    }
    #${OVERLAY_ID} h2 {
      margin: 0;
      font-size: 22px;
    }
    #${OVERLAY_ID} p {
      margin: 4px 0 0;
      color: #d1d5db;
    }
    #${OVERLAY_ID} .focoroco-actions {
      display: grid;
      gap: 8px;
    }
    #${OVERLAY_ID} button {
      appearance: none;
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
      background: #1f2937;
      color: #f9fafb;
      transition: transform 0.1s ease, background 0.2s ease;
    }
    #${OVERLAY_ID} button:hover {
      transform: translateY(-1px);
      background: #374151;
    }
  `;

  overlay.appendChild(style);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.tagName !== "BUTTON") {
      return;
    }
    const action = target.getAttribute("data-action");
    if (!action) {
      return;
    }
    if (action === "go-back") {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        const message: ContentToBackgroundMessage = {
          type: "CONTENT_CLOSE_TAB",
          tabId: 0
        };
        chrome.runtime.sendMessage(message);
      }
      removeOverlay();
    }
    if (action === "insist") {
      const hostname = getHostname();
      if (hostname) {
        const message: ContentToBackgroundMessage = {
          type: "CONTENT_SNOOZE_DOMAIN",
          hostname,
          snoozeSeconds: SNOOZE_SECONDS
        };
        chrome.runtime.sendMessage(message);
      }
      removeOverlay();
    }
    if (action === "penalty") {
      const hostname = getHostname();
      if (hostname) {
        const snoozeMessage: ContentToBackgroundMessage = {
          type: "CONTENT_SNOOZE_DOMAIN",
          hostname,
          snoozeSeconds: SNOOZE_SECONDS
        };
        chrome.runtime.sendMessage(snoozeMessage);
      }
      const penaltyMessage: ContentToBackgroundMessage = {
        type: "CONTENT_ADD_PENALTY",
        minutes: PENALTY_MINUTES
      };
      chrome.runtime.sendMessage(penaltyMessage);
      removeOverlay();
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
