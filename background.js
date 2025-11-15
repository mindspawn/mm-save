const ACTION_BADGE_TEXT = {
  idle: "",
  running: "⋯",
  done: "✓",
  error: "!"
};

const ALLOWED_HOSTS = ["mchat.foo.com"];

chrome.action.setBadgeBackgroundColor({ color: "#2f3d4a" }).catch(() => {});

chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  if (!isAllowedTab(tab)) {
    chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.error });
    setTimeout(() => chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle }), 4000);
    console.warn("Mattermost saver: blocked on unsupported host", tab.url);
    return;
  }

  try {
    chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.running });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const promptResponse = await chrome.tabs.sendMessage(tab.id, { type: "MM_SAVE_PROMPT" });
    if (!promptResponse?.ok) {
      chrome.action.setBadgeText({ text: ACTION_BADGE_TEXT.idle });
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "MM_SAVE_START",
      options: { days: promptResponse.days }
    });
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
  const jsonString = JSON.stringify(payload, null, 2);
  const jsonUrl = `data:application/json;charset=utf-8,${encodeURIComponent(jsonString)}`;

  await chrome.downloads.download({
    url: jsonUrl,
    filename: suggestedName,
    saveAs: true
  });

  const textContent = buildThreadText(payload.posts || []);
  if (textContent) {
    const textUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(textContent)}`;
    const textName = suggestedName.replace(/\.json$/i, "") + "-llm.txt";
    await chrome.downloads.download({
      url: textUrl,
      filename: textName,
      saveAs: false
    });
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

function isAllowedTab(tab) {
  try {
    const url = tab?.url ? new URL(tab.url) : null;
    if (!url?.hostname) {
      return false;
    }
    return ALLOWED_HOSTS.some((host) => host.toLowerCase() === url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildThreadText(posts) {
  if (!Array.isArray(posts) || !posts.length) {
    return "";
  }

  const threadMap = new Map();
  let counter = 0;

  const lines = posts.map((post) => {
    const timestamp = formatTimestamp(post.timestamp);
    const username = (post.username || post.userId || "unknown").trim();
    const canonicalThreadId = post.threadId || post.postId || `solo-${post.userId || ""}-${post.timestamp || ""}`;
    let threadNumber = threadMap.get(canonicalThreadId);
    if (!threadNumber) {
      counter += 1;
      threadNumber = counter;
      threadMap.set(canonicalThreadId, threadNumber);
    }
    const simplifiedMessage = simplifyMessage(post.message);
    return `${timestamp} ${username} T${threadNumber}: ${simplifiedMessage}`;
  });

  return lines.join("\n");
}

function formatTimestamp(value) {
  if (!value) {
    return "unknown_time";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}`;
}

function simplifyMessage(message) {
  if (!message) {
    return "";
  }
  return message.replace(/\s+/g, " ").trim();
}
