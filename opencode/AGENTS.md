# AGENTS.md

## Overview

This is the configuration directory for [OpenCode](https://opencode.ai/), an AI coding assistant.
It lives at `~/.config/opencode/` and is part of the `wcleeah/dotconfig` dotfiles repo.

Only two files are git-tracked; everything else (node_modules, package.json, bun.lock) is gitignored.

## File Structure

- `opencode.json` — Main configuration. Defines MCP servers (context7, playwriter, grepapp).
- `plugins/env-protection.js` — Security plugin that blocks reading `.env` files.
- `.gitignore` — Excludes node_modules, package.json, bun.lock, and itself.

## Dependencies

Package manager: **Bun**

```
bun install
```

Single dependency: `@opencode-ai/plugin` (which pulls in `@opencode-ai/sdk` and `zod`).

There are no build, test, or lint commands.

## Configuration (opencode.json)

Uses the schema at `https://opencode.ai/config.json`. MCP servers are defined under
the `mcp` key. Each server has a `type` (`local` or `remote`), an `enabled` flag,
and either a `command` array (local) or `url` string (remote).

Environment variable references use the `{env:VAR_NAME}` syntax within command arrays.

## Plugin Development

Plugins are JavaScript ES modules in `plugins/`. Each exports a named async function
that receives `{ project, client, $, directory, worktree }` and returns an object
mapping hook names to handler functions.

### Code Style

- **Module format**: ESM (`export const`)
- **Async**: All plugin functions and hooks are `async`
- **Error handling**: Throw `Error` to block operations in `before` hooks
- **Formatting**: 2-space indentation, no semicolons, double quotes for strings
- **No TypeScript**: Plugins are plain `.js` — types come from the SDK's `.d.ts` files

### Available Hooks

Key hooks for plugin development:
- `tool.execute.before` / `tool.execute.after` — intercept tool calls
- `chat.message` — intercept new messages
- `chat.params` — modify LLM parameters
- `permission.ask` — control permission prompts
- `shell.env` — set shell environment variables

### Security

The env-protection plugin blocks all `.env` file reads via `tool.execute.before`.
Do not weaken or remove this protection without explicit user approval.
