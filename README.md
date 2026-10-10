# MARK Discord Bot

MARK is a general-purpose Discord bot. Commands are loaded from individual JavaScript files in `commands/`; reusable logic is in `services/`.

## Setup

1. Install dependencies with `npm install`.
2. Configure `TOKEN`, `CLIENT_ID`, and `MONGODB_URI` in the environment (or a local `.env` file). On Railway, set these under the bot service's **Variables**; a Railway MongoDB service's `MONGO_URL` variable is also accepted as a connection-string fallback. The URI must point to a MongoDB deployment accessible to the bot. Slash commands deploy globally; optionally set `GUILD_ID` to also register the same commands in a test server for immediate testing. Discord may take time to propagate global command updates.
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

## Economy

The economy is global across every Discord server where MARK is installed. A player's Discord user ID is the account identity, so balances, inventory, titles and Variant codes, cooldowns, active effects, statistics, transaction history, and limited-stock purchase limits are shared across guilds. `/richest` and `/economy` report global data. Lottery rounds and entries remain guild-specific games, but their payouts update the same global accounts. Transaction records retain the originating guild for provenance.

Economy data uses the existing MongoDB connection and initializes indexes at startup. Accounts, append-only transaction records, operation idempotency results, inventory, title ownership, active effects, weekly stock, and daily lottery rounds are persisted in the `economy*` collections. On first startup after the global-account upgrade, legacy per-guild player records are archived in `economyLegacyArchive` and migrated once. Wallet balances and inventory quantities are summed across guild records to preserve recorded value; this may retain duplicated historical starting grants. Cooldowns keep the latest timestamp, titles are unioned, unique Variant codes are preserved, and active Luck durations are combined by tier. If equipped titles conflict, the title from the lexicographically smallest source guild is kept (an existing global account's equipped title takes precedence). Current-period limited stock carries over into one global allocation; older stock history is archived. The migration is transactional per user and is not marked complete until player and stock migration finishes.

Balance-changing multi-document actions require MongoDB transactions; deploy against a replica set (MongoDB Atlas supports this). If transactions are unavailable, economy writes fail rather than partially applying a debit or credit.

Economy commands include `/bal`, `/daily`, `/weekly`, `/give`, `/steal`, `/cf`, `/lottery`, `/richest`, `/work`, `/beg`, `/profile`, `/economy`, `/transactions`, `/cooldown`, `/shop`, `/inventory`, `/item`, `/use`, `/boosts`, and `/titles`. Normal player-facing economy replies are public embeds; transaction history remains private. Coinflip wagers use `/cf choice:<Heads|Tails> amount:<coins>` with any positive whole-number wager affordable from the wallet. Discord requires commands with subcommands, so shop browsing is `/shop all`, title browsing is `/shop titles`, and title listing is `/titles list`; buying/selling use `/shop buy item:<ID>` and `/shop sell item:<ID>` (with optional quantity for stackable items).

Tuning values and reward ranges are centralized in `services/economy-config.js`; title and consumable details live in `services/economy-catalog.js`. Daily lottery rounds close at midnight Nepal Time, and weekly limited stock restocks Monday at midnight Nepal Time. Register the slash commands with `npm run deploy` after deployment.
