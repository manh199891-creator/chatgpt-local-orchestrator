function configureSidePanel(): void {
  if (typeof chrome.sidePanel?.setPanelBehavior === "function") {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: unknown) => {
      console.warn("Failed to set side panel behavior:", err);
    });
  }
}

// Run on service worker startup
configureSidePanel();

chrome.runtime.onInstalled.addListener(() => {
  console.log("ChatGPT Local Orchestrator Extension installed.");
  configureSidePanel();
});

