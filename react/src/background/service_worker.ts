import {
  ContentToBackgroundMessage,
  FocusState,
  PopupToBackgroundMessage,
  StatePayload,
  StorageSchema,
  TrackingState,
  UsageByDate,
  ViolationsByDate
} from "../shared/types";

const TRACKING_ALARM = "tracking-tick";
const FOCUS_END_ALARM = "focus-end";

const defaultFocusState: FocusState = {
  isActive: false,
  endsAt: null,
  startedAt: null,
  durationMinutes: 25,
  penaltyMinutes: 0
};

const defaultTrackingState: TrackingState = {
  activeHostname: null,
  activeTabId: null,
  activeWindowId: null,
  lastStart: null
};

const defaultStorage: StorageSchema = {
  blockedDomains: [],
  focus: defaultFocusState,
  usageByDate: {},
  violationsByDate: {},
  snoozedUntilByDomain: {},
  tracking: defaultTrackingState
};

const getTodayKey = (date = new Date()): string =>
  date.toISOString().slice(0, 10);

const isFocusActive = (focus: FocusState): boolean => {
  if (!focus.isActive || !focus.endsAt) {
    return false;
  }
  return Date.now() < focus.endsAt;
};

const extractHostname = (url?: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const loadState = async (): Promise<StorageSchema> => {
  const data = await chrome.storage.local.get(defaultStorage);
  return {
    blockedDomains: data.blockedDomains ?? [],
    focus: data.focus ?? defaultFocusState,
    usageByDate: data.usageByDate ?? {},
    violationsByDate: data.violationsByDate ?? {},
    snoozedUntilByDomain: data.snoozedUntilByDomain ?? {},
    tracking: data.tracking ?? defaultTrackingState
  };
};

const savePartialState = async (
  partial: Partial<StorageSchema>
): Promise<void> => {
  await chrome.storage.local.set(partial);
};

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

const buildStatePayload = (state: StorageSchema): StatePayload => ({
  blockedDomains: state.blockedDomains,
  focus: state.focus,
  usageByDate: state.usageByDate,
  violationsByDate: state.violationsByDate,
  snoozedUntilByDomain: state.snoozedUntilByDomain
});

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

const updateFocusAlarm = async (focus: FocusState): Promise<void> => {
  if (focus.endsAt && focus.isActive) {
    await chrome.alarms.create(FOCUS_END_ALARM, { when: focus.endsAt });
  } else {
    await chrome.alarms.clear(FOCUS_END_ALARM);
  }
};

const ensureTrackingAlarm = async (): Promise<void> => {
  await chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: 1 });
};

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

  if (tracking.activeHostname && tracking.lastStart && (hostnameChanged || tabChanged || windowChanged)) {
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
    const isBlocked = state.blockedDomains.includes(nextHostname);
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

const stopFocusSession = async () => {
  const focus: FocusState = {
    ...defaultFocusState
  };
  await savePartialState({ focus });
  await updateFocusAlarm(focus);
  await broadcastState();
};

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

chrome.tabs.onActivated.addListener(async () => {
  await handleActiveTabChange();
});

chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (info.status === "complete") {
    await handleActiveTabChange(tab);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushActiveTime();
    await savePartialState({ tracking: defaultTrackingState });
    return;
  }
  await handleActiveTabChange();
});

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

chrome.runtime.onInstalled.addListener(async () => {
  await ensureTrackingAlarm();
  const state = await loadState();
  await updateFocusAlarm(state.focus);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureTrackingAlarm();
  const state = await loadState();
  await updateFocusAlarm(state.focus);
});
