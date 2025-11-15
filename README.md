# Mattermost Full History Saver

This Chrome extension scrolls through the currently open Mattermost channel, forces Mattermost to load every available chunk of history, and downloads a JSON file containing each post's timestamp, user ID, message text, and thread ID.

## Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked**
4. Select this project folder

## Use

1. Open the Mattermost channel you want to archive and make sure it is focused
2. Click the extension icon (or pin it first, if needed)
3. Wait while it scrolls upward (the badge shows `⋯` while collecting; a green check indicates the download started)
4. Choose where to save the generated JSON file when prompted (a compressed `.txt` companion file is also saved automatically for LLM tooling)

The resulting file includes:

- `meta` with channel name, capture time, total posts, and duration
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

> **Tips:**
> - The extension waits a few seconds for the channel list to appear; make sure the center pane is focused before clicking the action button.
> - If it still reports it cannot find the message list, scroll a little manually (so the DOM updates) and click the action again—custom themes sometimes rename the scroll container.
> - The capture uses your authenticated Mattermost session to enrich missing metadata via the `/api/v4/posts/ids`, `/api/v4/users/usernames`, and `/api/v4/users/ids` endpoints, so make sure you remain logged in while it runs.
