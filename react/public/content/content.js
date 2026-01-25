console.log("Focoroco content loaded:", location.hostname);

function showOverlay() {
  const overlay = document.createElement("div");
  overlay.textContent = "Are you sure?";
  overlay.style.position = "fixed";
  overlay.style.top = "20px";
  overlay.style.right = "20px";
  overlay.style.zIndex = "999999";
  overlay.style.background = "black";
  overlay.style.color = "white";
  overlay.style.padding = "12px";

  document.body.appendChild(overlay);
}

showOverlay();
