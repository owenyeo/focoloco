import type {
  ContentToBackgroundMessage,
  FocusState,
  PopupToBackgroundMessage,
  StatePayload,
  StorageSchema,
  TrackingState,
  UsageByDate,
  ViolationsByDate
} from "../shared/types";

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

// Alarm names for usage tracking and focus session end.
const TRACKING_ALARM = "tracking-tick";
const FOCUS_END_ALARM = "focus-end";

// Default focus state stored in chrome.storage.
const defaultFocusState: FocusState = {
  isActive: false,
  endsAt: null,
  startedAt: null,
  durationMinutes: 25,
  penaltyMinutes: 0
};

// Default active-tab tracking state.
const defaultTrackingState: TrackingState = {
  activeHostname: null,
  activeTabId: null,
  activeWindowId: null,
  lastStart: null
};

// Base storage payload used for initialization/merging.
const defaultStorage: StorageSchema = {
  blockedDomains: [],
  focus: defaultFocusState,
  usageByDate: {},
  violationsByDate: {},
  snoozedUntilByDomain: {},
  tracking: defaultTrackingState
};

// Date key used in usage/violations maps: "YYYY-MM-DD".
const getTodayKey = (date = new Date()): string =>
  date.toISOString().slice(0, 10);

// Guard for focus activity based on end timestamp.
const isFocusActive = (focus: FocusState): boolean => {
  if (!focus.isActive || !focus.endsAt) {
    return false;
  }
  return Date.now() < focus.endsAt;
};

// Parse and return hostname from a URL string.
const extractHostname = (url?: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
};

// Read full state with defaults applied.
const loadState = async (): Promise<StorageSchema> => {
  return (await chrome.storage.local.get(defaultStorage)) as StorageSchema;
};

// Write only the provided slice of state.
const savePartialState = async (
  partial: Partial<StorageSchema>
): Promise<void> => {
  await chrome.storage.local.set(partial);
};

// Add time to a hostname's daily usage tally.
const addUsageTime = async (
  usageByDate: UsageByDate,
  hostname: string,
  deltaMs: number
): Promise<UsageByDate> => {
  if (deltaMs <= 0) {
    return usageByDate;
  }
  const todayKey = getTodayKey();
  const dayTotals = usageByDate[todayKey] ?? {};
  dayTotals[hostname] = (dayTotals[hostname] ?? 0) + deltaMs;
  return {
    ...usageByDate,
    [todayKey]: { ...dayTotals }
  };
};

// Increment today's focus-mode violation count.
const addViolation = async (
  violationsByDate: ViolationsByDate
): Promise<ViolationsByDate> => {
  const todayKey = getTodayKey();
  const current = violationsByDate[todayKey] ?? 0;
  return {
    ...violationsByDate,
    [todayKey]: current + 1
  };
};

// Build the subset shared with popup/content scripts.
const buildStatePayload = (state: StorageSchema): StatePayload => ({
  blockedDomains: state.blockedDomains,
  focus: state.focus,
  usageByDate: state.usageByDate,
  violationsByDate: state.violationsByDate,
  snoozedUntilByDomain: state.snoozedUntilByDomain
});

// Push fresh state to popup + all http(s) tabs.
const broadcastState = async (): Promise<void> => {
  const state = await loadState();
  const payload = buildStatePayload(state);
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", payload });
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    if (!tab.id || !tab.url) {
      return;
    }
    if (!tab.url.startsWith("http")) {
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "STATE_UPDATE", payload }, () => {
      void chrome.runtime.lastError;
    });
  });
};

// Sync the focus-end alarm with the current focus state.
const updateFocusAlarm = async (focus: FocusState): Promise<void> => {
  if (focus.endsAt && focus.isActive) {
    await chrome.alarms.create(FOCUS_END_ALARM, { when: focus.endsAt });
  } else {
    await chrome.alarms.clear(FOCUS_END_ALARM);
  }
};

// Ensure the usage tracking alarm fires every minute.
const ensureTrackingAlarm = async (): Promise<void> => {
  await chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: 1 });
};

// Persist elapsed time for the currently tracked hostname.
const flushActiveTime = async (overrideHostname?: string | null) => {
  const state = await loadState();
  const tracking = state.tracking;
  const hostname = overrideHostname ?? tracking.activeHostname;
  if (!hostname || !tracking.lastStart) {
    return;
  }
  const now = Date.now();
  const deltaMs = now - tracking.lastStart;
  const usageByDate = await addUsageTime(state.usageByDate, hostname, deltaMs);
  const updatedTracking: TrackingState = {
    ...tracking,
    lastStart: now
  };
  await savePartialState({ usageByDate, tracking: updatedTracking });
};

// Track usage when the active tab or focused window changes.
const handleActiveTabChange = async (tab?: chrome.tabs.Tab) => {
  const [activeTab] = tab
    ? [tab]
    : await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  const state = await loadState();
  const tracking = state.tracking;
  const nextHostname = extractHostname(activeTab?.url);
  const nextTabId = activeTab?.id ?? null;
  const nextWindowId = activeTab?.windowId ?? null;

  const hostnameChanged = tracking.activeHostname !== nextHostname;
  const tabChanged = tracking.activeTabId !== nextTabId;
  const windowChanged = tracking.activeWindowId !== nextWindowId;

  if (
    tracking.activeHostname &&
    tracking.lastStart &&
    (hostnameChanged || tabChanged || windowChanged)
  ) {
    const now = Date.now();
    const deltaMs = now - tracking.lastStart;
    const usageByDate = await addUsageTime(
      state.usageByDate,
      tracking.activeHostname,
      deltaMs
    );
    state.usageByDate = usageByDate;
    tracking.lastStart = now;
  }

  tracking.activeHostname = nextHostname;
  tracking.activeTabId = nextTabId;
  tracking.activeWindowId = nextWindowId;
  tracking.lastStart = nextHostname ? Date.now() : null;

  if (nextHostname && isFocusActive(state.focus)) {
    const isBlocked = isHostnameBlocked(nextHostname, state.blockedDomains);
    const snoozedUntil = state.snoozedUntilByDomain[nextHostname] ?? 0;
    if (isBlocked && Date.now() > snoozedUntil && hostnameChanged) {
      state.violationsByDate = await addViolation(state.violationsByDate);
    }
  }

  await savePartialState({
    tracking,
    usageByDate: state.usageByDate,
    violationsByDate: state.violationsByDate
  });
};

// Start a new focus session and schedule its end alarm.
const startFocusSession = async (durationMinutes: number) => {
  const now = Date.now();
  const endsAt = now + durationMinutes * 60 * 1000;
  const focus: FocusState = {
    isActive: true,
    endsAt,
    startedAt: now,
    durationMinutes,
    penaltyMinutes: 0
  };
  await savePartialState({ focus });
  await updateFocusAlarm(focus);
  await broadcastState();
};

// Stop focus mode and reset focus state.
const stopFocusSession = async () => {
  const focus: FocusState = {
    ...defaultFocusState
  };
  await savePartialState({ focus });
  await updateFocusAlarm(focus);
  await broadcastState();
};

// Extend the focus session and track penalty minutes.
const addPenaltyMinutes = async (minutes: number) => {
  const state = await loadState();
  if (!state.focus.isActive || !state.focus.endsAt) {
    return;
  }
  const updatedFocus: FocusState = {
    ...state.focus,
    endsAt: state.focus.endsAt + minutes * 60 * 1000,
    penaltyMinutes: state.focus.penaltyMinutes + minutes
  };
  await savePartialState({ focus: updatedFocus });
  await updateFocusAlarm(updatedFocus);
  await broadcastState();
};

// Route popup/content messages to background actions.
const handleMessage = async (
  message: PopupToBackgroundMessage | ContentToBackgroundMessage,
  sender: chrome.runtime.MessageSender
) => {
  switch (message.type) {
    case "POPUP_GET_STATE": {
      const state = await loadState();
      return { type: "BACKGROUND_STATE", payload: buildStatePayload(state) };
    }
    case "POPUP_START_FOCUS":
      await startFocusSession(message.durationMinutes);
      return { success: true };
    case "POPUP_STOP_FOCUS":
      await stopFocusSession();
      return { success: true };
    case "POPUP_UPDATE_BLOCKED":
      await savePartialState({ blockedDomains: message.blockedDomains });
      await broadcastState();
      return { success: true };
    case "CONTENT_GET_STATE": {
      const state = await loadState();
      return { type: "BACKGROUND_STATE", payload: buildStatePayload(state) };
    }
    case "CONTENT_SNOOZE_DOMAIN": {
      const state = await loadState();
      const next = {
        ...state.snoozedUntilByDomain,
        [message.hostname]: Date.now() + message.snoozeSeconds * 1000
      };
      await savePartialState({ snoozedUntilByDomain: next });
      await broadcastState();
      return { success: true };
    }
    case "CONTENT_ADD_PENALTY":
      await addPenaltyMinutes(message.minutes);
      return { success: true };
    case "CONTENT_CLOSE_TAB":
      if (sender.tab?.id) {
        await chrome.tabs.remove(sender.tab.id);
      }
      return { success: true };
    default:
      return { success: false };
  }
};

// Listen for popup/content messages.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

// Update tracking when the active tab changes.
chrome.tabs.onActivated.addListener(async () => {
  await handleActiveTabChange();
});

// Update tracking when a tab finishes loading.
chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (info.status === "complete") {
    await handleActiveTabChange(tab);
  }
});

// Flush usage when focus is lost, otherwise track active tab.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushActiveTime();
    await savePartialState({ tracking: defaultTrackingState });
    return;
  }
  await handleActiveTabChange();
});

// Handle periodic tracking ticks and focus-end alarm.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TRACKING_ALARM) {
    await flushActiveTime();
  }
  if (alarm.name === FOCUS_END_ALARM) {
    const state = await loadState();
    if (!state.focus.isActive) {
      return;
    }
    await stopFocusSession();
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "vite.svg",
      title: "Focoroco sprint complete!",
      message: "Time for a break. Your focus sprint is done."
    });
  }
});

// Initialize alarms when the extension is installed.
chrome.runtime.onInstalled.addListener(async () => {
  await ensureTrackingAlarm();
  const state = await loadState();
  await updateFocusAlarm(state.focus);
});

// Recreate alarms on browser startup.
chrome.runtime.onStartup.addListener(async () => {
  await ensureTrackingAlarm();
  const state = await loadState();
  await updateFocusAlarm(state.focus);
});
