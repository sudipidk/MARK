# MARK Discord Bot

MARK is a general-purpose Discord bot. Commands are loaded from individual JavaScript files in `commands/`; reusable logic is in `services/`.

## Setup

1. Install dependencies with `npm install`.
2. Configure `TOKEN`, `CLIENT_ID`, and `MONGODB_URI` in the environment (or a local `.env` file). On Railway, set these under the bot service's **Variables**; a Railway MongoDB service's `MONGO_URL` variable is also accepted as a connection-string fallback. The URI must point to a MongoDB deployment accessible to the bot. `GUILD_ID` is optional: when present, commands deploy to that server for fast testing; otherwise, commands deploy globally.
3. Enable the **Message Content Intent** and **Server Members Intent** in the Discord Developer Portal. Message content is used by counting; the members intent supports accurate member cache information and active-timeout listings.
4. Invite MARK with only the permissions needed for the features you use. These include View Channels/Send Messages/Embed Links for embeds and logs; Add Reactions/Manage Messages for counting; Kick Members, Ban Members, and Moderate Members for moderation; and Read Message History for timeout listing.
5. If you have existing counting data in `data/counting.json`, run `npm run migrate:counting` once before starting the bot. The migration is safe to rerun and preserves any counting records already in MongoDB. Then register commands with `npm run deploy` and run `npm start`. Run `npm test` to execute the automated checks.

## Phase 1 commands

- Profiles and bot information: `/userinfo [user]`, `/serverinfo`, `/avatar [user]`, `/uptime`
- Moderation: `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/bans`, `/timeoutes`
- Moderation logs: `/modlog setchannel`, `/modlog disable`, `/modlog config`
- Suggestions: `/suggest`, `/suggestion setchannel`, `/suggestion disable`, `/suggestion config`, `/suggestion view`, `/suggestion list`, `/suggestion stats`
- Counting remains available through the existing `/counting-*` commands.

## Phase 2 commands

- AFK: `/afk [reason]` and `m!afk [reason]`. AFK state is server-specific, persisted in MongoDB, and clears when the member sends a non-command message.
- Reminders: `/remind <duration> <message>` and `m!remind <duration> <message>`, `/reminders`, and `/reminder cancel <id>` (also `m!reminders` and `m!reminder cancel <id>`). Durations accept seconds, minutes, hours, days, and weeks (including combinations) up to 365 days. Reminder DMs require the member to allow DMs from the server.

Suggestion IDs and votes persist in JSON. Users may change a pending suggestion vote; each user has one upvote or downvote per suggestion. Approval/denial requires Manage Server or Administrator and a reason via modal. After a decision, voting and further decisions are disabled.

Moderation log entries are emitted for moderation actions MARK performs through its commands. Actions taken manually in Discord or by another bot are not monitored through audit-log events.

## Persistent storage

Counting configuration and statistics are stored in the MongoDB `MARK.counting` collection, with one document per Discord server. AFK state and reminders persist in the `MARK.afk` and `MARK.reminders` collections. Reminder deliveries are atomically claimed to prevent duplicate delivery; if the process restarts during a DM attempt, the reminder is marked failed because Discord does not provide a transaction with MongoDB to safely retry that uncertain delivery. Legacy counting JSON is imported with `npm run migrate:counting`. Moderation configuration, suggestions, and other JSON data are written to `data/` by default; set `BOT_DATA_DIR` to a writable persistent directory in production for those features. `COUNTING_DATA_DIR` remains supported as the legacy JSON import directory when `BOT_DATA_DIR` is not set.
