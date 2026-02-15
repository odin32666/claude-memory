# CLAUDE.md

## Project Overview

Claude Memory (`cmem`) — a persistent knowledge base and memory system for Claude Code. Stores decisions, learnings, errors, solutions, and patterns as JSON files so context carries across sessions.

## Tech Stack

- Node.js (no external dependencies)
- CLI entry: `src/cli.js`
- Programmatic API: `src/index.js`

## Project Structure

- `src/cli.js` — CLI interface and command routing
- `src/index.js` — Main ClaudeMemory class and public API
- `src/memory-manager.js` — CRUD operations for memory entries
- `src/search.js` — Search/filter logic
- `src/extractor.js` — Auto-extracts insights from text
- `src/conversation.js` — Conversation tracking
- `src/utils/storage.js` — File I/O and JSON persistence
- `src/utils/schemas.js` — Entry type schemas and validation

## Key Commands

```bash
node src/cli.js init        # Initialize memory folders
node src/cli.js add -i      # Add entry interactively
node src/cli.js search <q>  # Search memories
node src/cli.js recent      # Show recent entries
node src/cli.js context     # Show project memory context
node src/cli.js stats       # Show statistics
```

## Running Tests

```bash
npm test    # runs node test/test.js
```

## Storage Location

Memories are stored in `~/.claude/memory/` with `global/` and `projects/<hash>/` subdirectories.

## Conventions

- No external dependencies — keep it zero-dep Node.js
- Entry types: decision, learning, error, solution, pattern, context
- All entries stored as JSON with timestamps, tags, and metadata
