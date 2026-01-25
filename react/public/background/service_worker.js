chrome.runtime.onInstalled.addListener(() => {
  console.log("Focoroco installed");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "focoroco_sprint_end") return;
  console.log("Sprint ended");
});
