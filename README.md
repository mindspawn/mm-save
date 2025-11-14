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
4. Choose where to save the generated JSON file when prompted

The resulting file includes:

- `meta` with channel name, capture time, total posts, and duration
- `posts`, sorted oldest → newest, each containing:
  - `timestamp` (ISO)
  - `userId` (as exposed in the DOM)
  - `message` (visible text)
  - `threadId` (root ID so replies can be regrouped)
  - `postId` (local identifier for convenience)

> **Tip:** If the extension reports it cannot find the message list, switch to the center channel pane and try again. Some custom themes move the scroll container; in that case scroll a little manually, then re-trigger the extension so it can detect the active feed.
