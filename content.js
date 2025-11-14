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
  const scrollable = await waitForScrollableContainer();

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

  await enrichPostsFromApi(posts);
  await backfillUserIds(posts);

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

  const userId = resolveUserId(node, dataset);
  const username = resolveUsername(node, dataset);

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
    username,
    message
  };
}

function normalizePostId(idValue) {
  if (!idValue) {
    return null;
  }
  return idValue.replace(/^post_/, "");
}

function resolveUserId(node, dataset) {
  const directCandidates = [
    dataset.userid,
    dataset.userId,
    dataset.userID,
    node.getAttribute("data-user-id"),
    node.getAttribute("data-userid")
  ];

  for (const value of directCandidates) {
    if (value) {
      return value;
    }
  }

  const descendant = node.querySelector("[data-user-id], [data-userid]");
  if (descendant?.getAttribute) {
    return descendant.getAttribute("data-user-id") || descendant.getAttribute("data-userid");
  }

  const profilePicture = node.querySelector("[data-testid='postProfilePicture'] img, [data-testid='postProfilePicture']");
  if (profilePicture?.getAttribute) {
    const candidate = profilePicture.getAttribute("data-user-id") || profilePicture.getAttribute("data-userid");
    if (candidate) {
      return candidate;
    }
  }

  const userPopover = node.querySelector(".user-popover, [data-testid='post_username'], [data-testid='post-profile-popover']");
  if (userPopover?.getAttribute) {
    const candidate = userPopover.getAttribute("data-user-id") || userPopover.getAttribute("data-userid");
    if (candidate) {
      return candidate;
    }
  }

  let current = node.parentElement;
  let hops = 0;
  while (current && hops < 4) {
    const candidate = current.getAttribute?.("data-user-id") || current.getAttribute?.("data-userid") || current.dataset?.userId;
    if (candidate) {
      return candidate;
    }
    current = current.parentElement;
    hops += 1;
  }

  return null;
}

function resolveUsername(node, dataset) {
  const direct = dataset.username || dataset.userName || node.getAttribute("data-username");
  if (direct) {
    return direct.trim();
  }

  const profile = node.querySelector("[data-username]");
  if (profile?.getAttribute) {
    const value = profile.getAttribute("data-username");
    if (value) {
      return value.trim();
    }
  }

  const userPopover = node.querySelector(".user-popover, [data-testid='post_username'], [data-testid='post-profile-popover']");
  if (userPopover?.getAttribute) {
    const attrName = userPopover.getAttribute("data-username");
    if (attrName) {
      return attrName.trim();
    }
  }

  const textCandidate =
    node.querySelector("[data-testid='postProfilePicture'] + div .user-popover") ||
    node.querySelector("[data-testid='postProfilePicture'] + div [data-testid='post_username']");
  if (textCandidate?.textContent) {
    return textCandidate.textContent.trim().replace(/^@/, "");
  }

  return null;
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

async function backfillUserIds(posts) {
  const needsLookup = posts.filter((post) => !post.userId && post.username);
  if (!needsLookup.length) {
    return;
  }

  const usernameSet = new Set(needsLookup.map((post) => post.username));
  const usernames = Array.from(usernameSet).filter(Boolean);
  if (!usernames.length) {
    return;
  }

  const batched = [];
  const batchSize = 50;
  for (let i = 0; i < usernames.length; i += batchSize) {
    batched.push(usernames.slice(i, i + batchSize));
  }

  const userMap = new Map();
  await Promise.all(
    batched.map(async (batch) => {
      try {
        const response = await fetch(`${window.location.origin}/api/v4/users/usernames`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(batch)
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        data.forEach((user) => {
          if (user?.username && user?.id) {
            userMap.set(user.username, user.id);
          }
        });
      } catch (error) {
        console.warn("Mattermost saver: failed to look up usernames", error);
      }
    })
  );

  needsLookup.forEach((post) => {
    if (!post.userId && post.username && userMap.has(post.username)) {
      post.userId = userMap.get(post.username);
    }
  });
}

async function enrichPostsFromApi(posts) {
  const targets = posts.filter((post) => post.postId && (!post.userId || !post.timestamp || !post.threadId || !post.message));
  if (!targets.length) {
    return;
  }

  const ids = Array.from(new Set(targets.map((post) => post.postId)));
  const batchSize = 100;
  const batchedIds = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    batchedIds.push(ids.slice(i, i + batchSize));
  }

  const postMap = new Map();

  await Promise.all(
    batchedIds.map(async (batch) => {
      try {
        const response = await fetch(`${window.location.origin}/api/v4/posts/ids`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(batch)
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const fetchedPosts = data?.posts || {};
        Object.entries(fetchedPosts).forEach(([id, value]) => {
          postMap.set(id, value);
        });
      } catch (error) {
        console.warn("Mattermost saver: failed to fetch post metadata", error);
      }
    })
  );

  targets.forEach((post) => {
    const apiPost = postMap.get(post.postId);
    if (!apiPost) {
      return;
    }
    post.userId = post.userId || apiPost.user_id || null;
    post.timestamp = post.timestamp || (apiPost.create_at ? new Date(apiPost.create_at).toISOString() : null);
    post.threadId = post.threadId || apiPost.root_id || post.postId;
    post.message = post.message || apiPost.message || "";
  });
}

function findScrollableContainer() {
  const selectors = [
    "[data-testid='virtualizedPostListContent']",
    "[data-testid='postListContent']",
    "[data-testid='postView']",
    "#post-list",
    ".post-list__dynamic",
    ".post-list__content",
    ".post-list__table",
    ".post-list__body",
    "[class*='PostListContent']",
    "[role='feed']",
    "[role='list']",
    "[aria-label='message list']"
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isScrollable(el)) {
      return el;
    }
  }

  const centerPane = document.querySelector("[data-testid='channelView']") || document.querySelector("[class*='CenterPane']");
  if (centerPane && isScrollable(centerPane)) {
    return centerPane;
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

async function waitForScrollableContainer(timeoutMs = 8000) {
  const start = performance.now();
  const pollInterval = 200;
  while (performance.now() - start < timeoutMs) {
    const scrollable = findScrollableContainer();
    if (scrollable) {
      return scrollable;
    }
    await waitFor(pollInterval);
  }
  throw new Error("Could not find the Mattermost message list. Focus the center channel and try again.");
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
