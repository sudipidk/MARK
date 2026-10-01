# MARK Discord Bot

MARK is a general-purpose Discord bot. Commands are loaded from individual JavaScript files in `commands/`; reusable logic is in `services/`.

## Setup

1. Install dependencies with `npm install`.
2. Configure `TOKEN` and `CLIENT_ID` in the environment (or a local `.env` file). `GUILD_ID` is optional: when present, commands deploy to that server for fast testing; otherwise, commands deploy globally.
3. Enable the **Message Content Intent** and **Server Members Intent** in the Discord Developer Portal. Message content is used by counting; the members intent supports accurate member cache information and active-timeout listings.
4. Invite MARK with only the permissions needed for the features you use. These include View Channels/Send Messages/Embed Links for embeds and logs; Add Reactions/Manage Messages for counting; Kick Members, Ban Members, and Moderate Members for moderation; and Read Message History for timeout listing.
5. Register commands with `npm run deploy`, then run `npm start`. Run `npm test` to execute the automated checks.

## Phase 1 commands

- Profiles and bot information: `/userinfo [user]`, `/serverinfo`, `/avatar [user]`, `/uptime`
- Moderation: `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/bans`, `/timeoutes`
- Moderation logs: `/modlog setchannel`, `/modlog disable`, `/modlog config`
- Suggestions: `/suggest`, `/suggestion setchannel`, `/suggestion disable`, `/suggestion config`, `/suggestion view`, `/suggestion list`, `/suggestion stats`
- Counting remains available through the existing `/counting-*` commands.

Suggestion IDs and votes persist in JSON. Users may change a pending suggestion vote; each user has one upvote or downvote per suggestion. Approval/denial requires Manage Server or Administrator and a reason via modal. After a decision, voting and further decisions are disabled.

Moderation log entries are emitted for moderation actions MARK performs through its commands. Actions taken manually in Discord or by another bot are not monitored through audit-log events.

## Persistent storage

JSON data is written to `data/` by default. Set `BOT_DATA_DIR` to a writable persistent directory in production (for example, a mounted Railway volume) so counting, moderation configuration, and suggestions survive container replacement. `COUNTING_DATA_DIR` is still supported for existing counting deployments and is used as the storage directory when `BOT_DATA_DIR` is not set. An ephemeral deployment filesystem does not preserve data across redeploys; use a persistent volume. Run one MARK process per data directory: JSON storage is designed for a single process, not concurrent multi-instance writes.
