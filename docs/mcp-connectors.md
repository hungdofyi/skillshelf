# MCP connectors

The `skillshelf` MCP server exposes the library read-only: skills (`list_skills`, `load_skill`, `read_skill_file`), books (`list_books`, `get_book_outline`, `read_chapter`), and ChatGPT-shaped `search` / `fetch`. There's also one prompt, `use_skill`. Long reads are paged at 40,000 characters and return `next_offset`.

Use it to test a skill in a client that cannot install skills natively. Ask the model to `load_skill <name>` and follow it, or in Claude Code run `/mcp__skillshelf__use_skill <name>`.

## Endpoints

| Transport | URL / command | Reachable from |
|---|---|---|
| stdio | `apps/server/node_modules/.bin/tsx apps/server/src/mcp/mcp-stdio-entry.ts` | local Claude Code |
| HTTP (local) | `http://localhost:4317/mcp/<token>` | this machine |
| HTTP (public) | `https://<tunnel-host>/<token>/mcp` | Claude.ai, ChatGPT (their servers call it) |

HTTP is stateless Streamable HTTP with JSON responses; cloudflared quick tunnels don't carry SSE. The token can also go in `Authorization: Bearer <token>` against `/mcp`. A wrong token gets **404**, not 401: a 401 would make Claude.ai start OAuth discovery.

The tunnel targets the **MCP-only listener on port 4318** (`MCP_PUBLIC_PORT`), so `/api` is never public.

## Claude Code

- This repo: `.mcp.json` registers `skillshelf`; approve it on first use (`claude mcp reset-project-choices` to re-ask).
- Every project: copy the command from the UI's Connect dialog, which is `claude mcp add --scope user skillshelf -- <tsx> <entry>` with absolute paths.
- Remote variant: `claude mcp add --transport http skillshelf <public URL>`.
- For the native-skill experience, use **Install** in the skill view instead. It symlinks the folder into `~/.claude/skills/`, so edits apply immediately.

## Claude.ai

1. Connect dialog → **Start tunnel** (needs `brew install cloudflared`, no account). Copy the public URL.
2. Claude.ai → Customize → Connectors → **Add custom connector** → name `skillshelf`, paste the URL → authentication **No sign in**.
3. In a chat: **+** → Connectors → enable `skillshelf`.

Team/Enterprise orgs: an owner may have to add the connector under organization settings first.

## ChatGPT

1. Same public URL (it ends in `/mcp`, as the form expects).
2. ChatGPT → Plugins (formerly Apps & Connectors) → **Add custom MCP server** → Public endpoint → paste → Authentication **No auth** → accept the warning.
3. After a server change, open the connection → **Refresh**, then start a new chat.

Deep research and company knowledge only call `search` and `fetch`; developer mode can call every tool. Which plans allow custom MCP servers varies; check your account.

## Stable URL

Quick-tunnel hostnames change on every start, so you'll need to re-paste the URL. For a stable one: `brew install ngrok`, `ngrok config add-authtoken <token>`, then set `TUNNEL_PROVIDER=ngrok` and `NGROK_DOMAIN=<your-free-dev-domain>` in `.env`.

## Threat model

Anyone holding the URL can read your converted books and skills, and nothing else. Rotate the token from the Connect dialog; this breaks existing connectors. Stop the tunnel when you're not testing. OAuth is the only auth both Claude.ai and ChatGPT support besides "none". It is not implemented; add it before sharing beyond personal use.
