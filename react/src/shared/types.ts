// Focus session timing + penalty info.
export type FocusState = {
  isActive: boolean;
  endsAt: number | null;
  startedAt: number | null;
  durationMinutes: number;
  penaltyMinutes: number;
};

// Tracks the currently active tab/hostname for usage timing.
export type TrackingState = {
  activeHostname: string | null;
  activeTabId: number | null;
  activeWindowId: number | null;
  lastStart: number | null;
};

// "YYYY-MM-DD" -> { hostname -> milliseconds }
export type UsageByDate = Record<string, Record<string, number>>;

// "YYYY-MM-DD" -> violation count
export type ViolationsByDate = Record<string, number>;

// hostname -> unix ms timestamp until which it is snoozed
export type SnoozedUntilByDomain = Record<string, number>;

// Canonical persisted shape in chrome.storage.local.
export type StorageSchema = {
  blockedDomains: string[];
  focus: FocusState;
  usageByDate: UsageByDate;
  violationsByDate: ViolationsByDate;
  snoozedUntilByDomain: SnoozedUntilByDomain;
  tracking: TrackingState;
};

// Subset of state shared with popup/content scripts.
export type StatePayload = Pick<
  StorageSchema,
  | "blockedDomains"
  | "focus"
  | "usageByDate"
  | "violationsByDate"
  | "snoozedUntilByDomain"
>;

// Popup -> background message contracts.
export type PopupToBackgroundMessage =
  | { type: "POPUP_GET_STATE" }
  | { type: "POPUP_START_FOCUS"; durationMinutes: number }
  | { type: "POPUP_STOP_FOCUS" }
  | { type: "POPUP_UPDATE_BLOCKED"; blockedDomains: string[] };

// Content script -> background message contracts.
export type ContentToBackgroundMessage =
  | { type: "CONTENT_GET_STATE" }
  | { type: "CONTENT_SNOOZE_DOMAIN"; hostname: string; snoozeSeconds: number }
  | { type: "CONTENT_ADD_PENALTY"; minutes: number }
  | { type: "CONTENT_CLOSE_TAB"; tabId: number };

// Background -> popup message contracts.
export type BackgroundToPopupMessage =
  | { type: "BACKGROUND_STATE"; payload: StatePayload }
  | { type: "STATE_UPDATE"; payload: StatePayload };

// Background -> content script message contracts.
export type BackgroundToContentMessage =
  | { type: "STATE_UPDATE"; payload: StatePayload };
