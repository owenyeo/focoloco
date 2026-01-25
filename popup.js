document.getElementById("start").addEventListener("click", async () => {
  const mins = Number(document.getElementById("minutes").value || 25);
  const endAt = Date.now() + mins * 60 * 1000;

  await chrome.storage.local.set({ endAt });
  document.getElementById("status").textContent = `Sprint started: ${mins} min`;
});

// On open, show existing sprint
chrome.storage.local.get(["endAt"], ({ endAt }) => {
  if (!endAt) return;
  const leftMs = endAt - Date.now();
  if (leftMs > 0) {
    document.getElementById("status").textContent =
      `Running: ${Math.ceil(leftMs / 60000)} min left`;
  }
});
