# Mattermost Full History Saver

Author: Sumanth J.V.

This Chrome extension scrolls through the currently open Mattermost channel, forces Mattermost to load every available chunk of history, and downloads a JSON file containing each post's timestamp, user ID, message text, and thread ID.

## Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked**
4. Select this project folder

## Use

1. Open the Mattermost channel you want to archive and make sure it is focused
2. Click the extension icon (or pin it first, if needed)
3. Enter how many days of history to keep (leave blank for all available history) when the prompt appears
4. Wait while it scrolls upward (the badge shows `⋯` while collecting; a green check indicates the download started)
5. Choose where to save the generated JSON file when prompted (a compressed `.txt` companion file is also saved automatically for LLM tooling)

The resulting file includes:

- `meta` with channel name, capture time, requested day window (if any), cutoff timestamp, total collected posts vs. exported posts, and duration
- `posts`, sorted oldest → newest, each containing:
  - `timestamp` (ISO)
  - `userId` (as exposed in the DOM)
  - `username` (scraped from the UI or resolved via the authenticated API no matter how teammate names are displayed)
  - `message` (visible text)
- `threadId` (root ID so replies can be regrouped)
- `postId` (local identifier for convenience)

The companion text file (same basename + `-llm.txt`) lists each message on a single line:

```
2024-06-19_15:26:05 jon.doe T5: Message contents
```

`T#` is a simplified thread counter derived from the canonical thread IDs so LLMs can reconstruct conversations without parsing JSON.

## How It Works

1. When you click the action button, the background service worker verifies the tab host is allowed and injects the content script.
2. The content script prompts for a day-range filter, finds the main post list, then repeatedly scrolls upward until it either reaches the requested cutoff timestamp or Mattermost reports no more history.
3. Each DOM post is parsed for IDs, timestamps, usernames, messages, and thread metadata.
4. Any missing data is resolved through authenticated Mattermost API calls using your existing browser session:
   - `POST /api/v4/posts/ids` to backfill post metadata (`user_id`, `create_at`, `root_id`, `message`).
   - `POST /api/v4/users/usernames` to map usernames → user IDs.
   - `POST /api/v4/users/ids` to map user IDs → usernames (covers all teammate display settings).
5. The background worker receives the structured payload, saves the canonical JSON file, and also generates a compact text file with simplified thread numbering.

> **Tips:**
> - The extension waits a few seconds for the channel list to appear; make sure the center pane is focused before clicking the action button.
> - If it still reports it cannot find the message list, scroll a little manually (so the DOM updates) and click the action again—custom themes sometimes rename the scroll container.
> - The capture uses your authenticated Mattermost session to enrich missing metadata via the `/api/v4/posts/ids`, `/api/v4/users/usernames`, and `/api/v4/users/ids` endpoints, so make sure you remain logged in while it runs.
> - By default the extension only runs on `https://mchat.foo.com/`; edit `ALLOWED_HOSTS` in `allowed-hosts.js` (and update `host_permissions` in `manifest.json` accordingly) if you need to support additional Mattermost domains.
> - When you limit the capture to a number of days, the scroller stops as soon as it has loaded posts at or before that cutoff timestamp, keeping the run time down.
