export type FocusState = {
  isActive: boolean;
  endsAt: number | null;
  startedAt: number | null;
  durationMinutes: number;
  penaltyMinutes: number;
};

export type TrackingState = {
  activeHostname: string | null;
  activeTabId: number | null;
  activeWindowId: number | null;
  lastStart: number | null;
};

export type UsageByDate = Record<string, Record<string, number>>;
export type ViolationsByDate = Record<string, number>;
export type SnoozedUntilByDomain = Record<string, number>;

export type StorageSchema = {
  blockedDomains: string[];
  focus: FocusState;
  usageByDate: UsageByDate;
  violationsByDate: ViolationsByDate;
  snoozedUntilByDomain: SnoozedUntilByDomain;
  tracking: TrackingState;
};

export type StatePayload = Pick<
  StorageSchema,
  | "blockedDomains"
  | "focus"
  | "usageByDate"
  | "violationsByDate"
  | "snoozedUntilByDomain"
>;

export type PopupToBackgroundMessage =
  | { type: "POPUP_GET_STATE" }
  | { type: "POPUP_START_FOCUS"; durationMinutes: number }
  | { type: "POPUP_STOP_FOCUS" }
  | { type: "POPUP_UPDATE_BLOCKED"; blockedDomains: string[] };

export type ContentToBackgroundMessage =
  | { type: "CONTENT_GET_STATE" }
  | { type: "CONTENT_SNOOZE_DOMAIN"; hostname: string; snoozeSeconds: number }
  | { type: "CONTENT_ADD_PENALTY"; minutes: number }
  | { type: "CONTENT_CLOSE_TAB"; tabId: number };

export type BackgroundToPopupMessage =
  | { type: "BACKGROUND_STATE"; payload: StatePayload }
  | { type: "STATE_UPDATE"; payload: StatePayload };

export type BackgroundToContentMessage =
  | { type: "STATE_UPDATE"; payload: StatePayload };
