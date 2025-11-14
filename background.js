const ACTION_BADGE_TEXT = {
  idle: "",
  running: "⋯",
  done: "✓",
  error: "!"
};

chrome.action.setBadgeBackgroundColor({ color: "#2f3d4a" }).catch(() => {});

chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.running });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, { type: "MM_SAVE_START" });
    if (!response?.ok) {
      throw new Error(response?.error || "Mattermost saver was unable to start.");
    }
  } catch (error) {
    console.error("Mattermost saver error:", error);
    chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.error });
    setTimeout(() => chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }), 4000);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MM_SAVE_RESULT") {
    handleHistoryResult(message.payload)
      .then(() => {
        chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.done });
        setTimeout(() => chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }), 2500);
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to save Mattermost history", error);
        chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.error });
        setTimeout(() => chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }), 4000);
        sendResponse({ ok: false, error: error?.message });
      });
    return true;
  }
  return false;
});

async function handleHistoryResult(payload) {
  if (!payload) {
    throw new Error("No payload received from the content script.");
  }

  const suggestedName = buildFilename(payload.meta);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: suggestedName,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function buildFilename(meta = {}) {
  const channelSafe = (meta.channel || "mattermost-channel")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
  const when = meta.capturedAt ? meta.capturedAt.replace(/[:.]/g, "-") : new Date().toISOString().replace(/[:.]/g, "-");
  return `mattermost-history-${channelSafe}-${when}.json`;
}
