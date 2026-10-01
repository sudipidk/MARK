# Mark Discord Bot

## Counting setup

1. In the Discord Developer Portal, enable the **Message Content Intent** for the bot.
2. Invite the bot with permission to view the counting channel, read message history, add reactions, delete messages, and (if punishments are configured) moderate members.
3. Run `npm run deploy` to register the slash commands, then start the bot with `npm start`.
4. In your server, use `/counting-channel` to select the channel. Counting is disabled until a channel is configured.

Configuration is available through `/counting-math`, `/counting-cheat`, `/counting-streak`, `/counting-talk`, and `/counting-punish`. `/counting-config` shows the current settings. Successful admin command replies are public. `/counting-stats` and `/counting-lb` show public statistics.

Correct counts receive a ✅ reaction. Duplicate or stale counts are deleted without changing the current count. With cheat protection enabled, an incorrect count is deleted and the expected count is preserved. With cheat protection disabled, a higher-than-expected incorrect count is deleted and resets the sequence. `/counting-reset` resets the count and accumulated statistics.

## Persistent storage

Counting data is stored in `data/counting.json` by default. Set `COUNTING_DATA_DIR` to a persistent directory when deploying (for example, the mount path of a Railway volume) so data survives container replacement or redeployment. The directory must be writable by the bot process. A local JSON file survives normal bot and host process restarts when the same filesystem is retained; ephemeral deployment filesystems require a mounted persistent volume.
