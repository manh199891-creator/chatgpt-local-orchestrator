document.addEventListener("DOMContentLoaded", () => {
  const btnCheckBridge = document.getElementById("btn-check-bridge") as HTMLButtonElement | null;
  const messageBox = document.getElementById("message-box") as HTMLDivElement | null;
  const messageText = document.getElementById("message-text") as HTMLParagraphElement | null;

  if (btnCheckBridge) {
    btnCheckBridge.addEventListener("click", () => {
      if (messageBox && messageText) {
        messageText.textContent = "Bridge connection will be implemented in a later phase.";
        messageBox.hidden = false;
      }
    });
  }
});
