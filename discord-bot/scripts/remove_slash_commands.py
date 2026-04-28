#!/usr/bin/env python3
"""Remove ALL Discord slash commands for this bot.

Removes both GLOBAL and GUILD-scoped commands. Use when you need a fresh slate.

Usage:
    python scripts/remove_slash_commands.py               # clears global + the configured guild
    python scripts/remove_slash_commands.py <guildId>     # also clears an additional guild

Environment variables required:
    DISCORD_BOT_TOKEN          - Bot token
    DISCORD_APPLICATION_ID     - Application / client ID

Optional environment variables:
    DISCORD_GUILD_ID           - Default guild to clear (in addition to global)
"""

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Optional

DISCORD_API_BASE = "https://discord.com/api/v10"


def _request(method: str, url: str, token: str, body: Optional[list] = None) -> list:
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "remove_slash_commands.py/1.0",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode()
        parsed = json.loads(raw) if raw.strip() else []
        return parsed if isinstance(parsed, list) else []


def clear_scope(label: str, route: str, token: str) -> None:
    try:
        before: list = _request("GET", route, token)
        names = ", ".join(c["name"] for c in before) or "(none)"
        print(f"[REMOVE] {label}: found {len(before)} command(s) — {names}")

        _request("PUT", route, token, body=[])

        after: list = _request("GET", route, token)
        print(f"[REMOVE] {label}: now {len(after)} command(s) ✅")
    except urllib.error.HTTPError as exc:
        print(f"[REMOVE] {label}: HTTP {exc.code} — {exc.reason}", file=sys.stderr)
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
        print(f"[REMOVE] {label}: {exc}", file=sys.stderr)


def main() -> None:
    token = os.environ.get("DISCORD_BOT_TOKEN")
    app_id = os.environ.get("DISCORD_APPLICATION_ID")
    configured_guild = os.environ.get("DISCORD_GUILD_ID")
    extra_guild = sys.argv[1] if len(sys.argv) > 1 else None

    if not token or not app_id:
        print("[REMOVE] Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID", file=sys.stderr)
        sys.exit(1)

    print(f"[REMOVE] CLIENT_ID: {app_id}")
    print(f"[REMOVE] GUILD_ID : {configured_guild or '(not set)'}")
    print()

    global_route = f"{DISCORD_API_BASE}/applications/{app_id}/commands"
    clear_scope("GLOBAL", global_route, token)

    if configured_guild:
        guild_route = f"{DISCORD_API_BASE}/applications/{app_id}/guilds/{configured_guild}/commands"
        clear_scope(f"GUILD {configured_guild}", guild_route, token)

    if extra_guild:
        guild_route = f"{DISCORD_API_BASE}/applications/{app_id}/guilds/{extra_guild}/commands"
        clear_scope(f"GUILD {extra_guild}", guild_route, token)

    print("\n[REMOVE] Done. Restart the bot to redeploy the current command set.")


if __name__ == "__main__":
    main()
