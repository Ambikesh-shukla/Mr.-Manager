# Workspace

## Overview

pnpm workspace monorepo using TypeScript and JavaScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Discord Bot (`artifacts/discord-bot`)

Full-featured Minecraft server provider Discord bot with:

- **Advanced Ticket System** — button/dropdown panels, modals, claim/close/transcript, cooldowns, blacklist, inactivity auto-close
- **Sales System** — hosting plan management, professional sales panels
- **Order Tracking** — customer orders with status updates and DM notifications
- **Review/Vouch System** — approval flow, star ratings
- **Welcome System** — configurable per-server
- **Auto-responses** — trigger-based message replies
- **FAQ, Announcements, Embeds** — content management tools
- **Suggestion System** — with voting buttons
- **Staff Role Management** — per-server staff permissions
- **Stats & Search** — ticket statistics and search

### Tech Stack
- discord.js v14.16+
- dotenv
- File-based JSON storage (no database)
- ESM modules

### Storage Files (`data/`)
- `guilds.json` — guild config (welcome, staff roles, autoresponses)
- `panels.json` — ticket panels with full customization
- `tickets.json` — all ticket records
- `cooldowns.json` — per-user cooldown tracking
- `plans.json` — hosting plans
- `reviews.json` — vouch/review submissions
- `orders.json` — customer orders

### Key Commands
- `pnpm --filter @workspace/discord-bot run start` — start the bot
- `pnpm --filter @workspace/discord-bot run register` — re-register slash commands
- Workflow: "Discord Bot" (console output)

### Secrets Required
- `DISCORD_BOT_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_APPLICATION_ID` — application ID from Discord Developer Portal

### Slash Commands (27 total)
**Tickets:** `/setup-ticket`, `/ticket-panel-create`, `/ticket-panel-edit`, `/ticket-type-add`, `/ticket-settings`, `/ticket-blacklist`, `/ticket-search`, `/ticket-stats`
**Sales:** `/plan-create`, `/plan-list`, `/plan-delete`, `/sales-panel`
**Orders:** `/order-create`, `/order-update`, `/order-list`
**Reviews:** `/review-setup`
**General:** `/help`, `/ping`, `/serverinfo`, `/announce`, `/embed-builder`, `/faq-create`, `/suggest`, `/autoresponse`, `/welcome`, `/setstaffrole`, `/config-view`
