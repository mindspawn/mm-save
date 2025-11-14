(function injectMattermostSaver() {
  if (window.__mmSaveContentLoaded) {
    return;
  }
  window.__mmSaveContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "MM_SAVE_START") {
      runCapture()
        .then((payload) => {
          chrome.runtime.sendMessage({ type: "MM_SAVE_RESULT", payload });
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("Mattermost saver failed:", error);
          sendResponse({ ok: false, error: error?.message || "Unable to capture history." });
        });
      return true;
    }
    return false;
  });
})();

async function runCapture() {
  const scrollable = findScrollableContainer();
  if (!scrollable) {
    throw new Error("Could not find the Mattermost message list. Open a channel before running the extension.");
  }

  const seen = new Set();
  const posts = [];
  const start = performance.now();
  const maxDurationMs = 2 * 60 * 1000; // safety limit: 2 minutes scrolling
  const stableIterationsTarget = 3;
  let stableIterations = 0;
  let lastCount = 0;

  collectPosts(scrollable, seen, posts);

  while (stableIterations < stableIterationsTarget && performance.now() - start < maxDurationMs) {
    const beforeHeight = scrollable.scrollHeight;
    scrollable.scrollTop = 0;
    scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
    await waitFor(1200);
    collectPosts(scrollable, seen, posts);

    const afterHeight = scrollable.scrollHeight;
    if (afterHeight === beforeHeight && posts.length === lastCount && Math.floor(scrollable.scrollTop) === 0) {
      stableIterations += 1;
    } else {
      stableIterations = 0;
      lastCount = posts.length;
    }
  }

  posts.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeA - timeB;
  });

  return {
    meta: {
      channel: getChannelName(),
      capturedAt: new Date().toISOString(),
      totalPosts: posts.length,
      durationMs: Math.round(performance.now() - start)
    },
    posts
  };
}

function collectPosts(container, seen, posts) {
  const nodes = container.querySelectorAll('[id^="post_"], [data-testid="postView"], [data-post-id]');
  nodes.forEach((node) => {
    const data = extractPost(node);
    if (!data) {
      return;
    }

    const key = data.postId || `${data.timestamp || ""}-${data.userId || ""}-${data.message || ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    posts.push(data);
  });
}

function extractPost(node) {
  const dataset = node.dataset || {};
  const rawId = node.getAttribute("id") || dataset.postId || dataset.postid || dataset.messageId || dataset.messageid;
  const postId = normalizePostId(rawId);

  const userId =
    dataset.userid ||
    dataset.userId ||
    node.getAttribute("data-user-id") ||
    node.querySelector("[data-testid='postProfilePicture']")?.getAttribute("data-user-id") ||
    null;

  const timestamp = resolveTimestamp(node, dataset);

  const rootId =
    dataset.rootId ||
    dataset.rootid ||
    dataset.rootPostId ||
    dataset.rootpostid ||
    dataset.threadId ||
    dataset.threadid ||
    node.getAttribute("data-rootid") ||
    node.getAttribute("data-root-id") ||
    null;

  const messageText =
    node.querySelector("[data-testid='postMessageText']")?.innerText ||
    node.querySelector(".post-message__text")?.innerText ||
    node.querySelector(".post-message")?.innerText ||
    node.getAttribute("aria-label") ||
    "";

  const message = messageText.trim();

  if (!postId && !message) {
    return null;
  }

  return {
    postId,
    threadId: rootId || postId || null,
    timestamp,
    userId,
    message
  };
}

function normalizePostId(idValue) {
  if (!idValue) {
    return null;
  }
  return idValue.replace(/^post_/, "");
}

function resolveTimestamp(node, dataset) {
  const candidateFields = [
    dataset.createAt,
    dataset.createat,
    dataset.timestamp,
    dataset.messageTimestamp,
    node.getAttribute("data-createat"),
    node.getAttribute("data-timestamp")
  ];

  for (const value of candidateFields) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && numeric > 1_000_000_000) {
      return new Date(numeric).toISOString();
    }
  }

  const timeEl =
    node.querySelector("time[datetime]") ||
    node.querySelector("time") ||
    node.closest("[data-testid='postView']")?.querySelector("time[datetime]");

  if (timeEl) {
    const dateValue = timeEl.getAttribute("datetime") || timeEl.dateTime || timeEl.textContent;
    const parsed = Date.parse(dateValue);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function findScrollableContainer() {
  const selectors = [
    "[data-testid='virtualizedPostListContent']",
    "[data-testid='postView']",
    "#post-list",
    ".post-list__dynamic",
    ".post-list__content",
    ".post-list__table",
    ".post-list__body",
    "[role='feed']",
    "[aria-label='message list']"
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isScrollable(el)) {
      return el;
    }
  }

  const firstPost = document.querySelector("[id^='post_']");
  if (firstPost) {
    let current = firstPost.parentElement;
    while (current && current !== document.body) {
      if (isScrollable(current)) {
        return current;
      }
      current = current.parentElement;
    }
  }

  if (isScrollable(document.scrollingElement)) {
    return document.scrollingElement;
  }

  return null;
}

function isScrollable(element) {
  if (!element) {
    return false;
  }
  return element.scrollHeight - element.clientHeight > 20;
}

function getChannelName() {
  const candidates = [
    "[data-testid='channelHeaderTitle']",
    "#channelHeaderTitle",
    ".channel-header__title",
    ".channel-header__name",
    "[data-testid='channelHeaderTitleText']",
    "h1"
  ];
  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return document.title || "Mattermost channel";
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
