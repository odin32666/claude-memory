# CLAUDE.md

## Project Overview

Claude Memory (`cmem`) - a persistent knowledge base and memory system for Claude Code. Stores decisions, learnings, errors, solutions, and patterns as JSON files so context carries across sessions. Supports cross-device sync via git.

## Tech Stack

- Node.js (no external dependencies)
- CLI entry: `src/cli.js`
- Programmatic API: `src/index.js`

## Project Structure

- `src/cli.js` - CLI interface and command routing
- `src/index.js` - Main ClaudeMemory class and public API
- `src/memory-manager.js` - CRUD operations for memory entries
- `src/search.js` - Search/filter logic
- `src/extractor.js` - Auto-extracts insights from text
- `src/conversation.js` - Conversation tracking
- `src/sync.js` - Cross-device sync via git (push/pull/auto-sync)
- `src/utils/storage.js` - File I/O and JSON persistence
- `src/utils/schemas.js` - Entry type schemas and validation

## Key Commands

```bash
node src/cli.js init        # Initialize memory folders
node src/cli.js add -i      # Add entry interactively
node src/cli.js search <q>  # Search memories
node src/cli.js recent      # Show recent entries
node src/cli.js context     # Show project memory context
node src/cli.js stats       # Show statistics
node src/cli.js sync        # Sync memories across devices
```

## Sync System

The sync feature uses git as a transport layer to keep memories in sync across all devices.

```bash
# Setup (run on each device):
cmem sync init https://github.com/YOU/my-claude-memory.git --device=MacBook
cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPad
cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPhone

# Manual sync:
cmem sync              # Full sync (pull + push)
cmem sync push         # Push local changes only
cmem sync pull         # Pull remote changes only
cmem sync status       # Check sync state

# Auto-sync triggers on every `cmem add` when enabled
cmem sync auto on|off
```

Config stored at `~/.claude/sync.json`. Merge conflicts in JSON files are auto-resolved by deduplicating entries by ID.

## Running Tests

```bash
npm test    # runs node test/test.js
```

## Storage Location

Memories are stored in `~/.claude/memory/` with `global/` and `projects/<hash>/` subdirectories.

## Auto-Memory Rules

When working in any session, Claude Code should automatically save important context using `cmem add`. Save:

- **Decisions** - Any architecture, library, or design choice made during the session
- **Learnings** - Anything discovered about the codebase, a bug, or a tool
- **Solutions** - Any error that was debugged and fixed
- **Patterns** - Reusable approaches or conventions established

Use `--scope=global` for knowledge that applies across projects. Use `--scope=project` for project-specific context. Always include relevant `--tags`.

Example: after fixing a bug, run:
```bash
node src/cli.js add --type=solution --title="Fix CORS in Express" --content="Must add cors() middleware before routes" --tags=express,cors --scope=global
```

## Conventions

- No external dependencies - keep it zero-dep Node.js
- Entry types: decision, learning, error, solution, pattern, context
- All entries stored as JSON with timestamps, tags, and metadata
- Sync uses git - all devices point to the same private remote repo
