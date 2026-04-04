# CLAUDE.md

## Project Overview

Claude Memory is a persistent knowledge base and memory system for Claude Code. It stores decisions, learnings, errors, solutions, and patterns across coding sessions. Built with pure Node.js — zero external dependencies.

## Repository Structure

```
src/
├── cli.js              # CLI interface, command parsing, ANSI-colored output
├── index.js            # Public API entry point, exports ClaudeMemory class
├── memory-manager.js   # Core CRUD operations, scoped storage management
├── search.js           # Full-text search engine with relevance scoring
├── conversation.js     # Session tracking and auto-summarization
├── extractor.js        # Regex-based insight extraction from text
└── utils/
    ├── schemas.js      # Data structures, validation, entry type definitions
    └── storage.js      # File I/O, atomic writes (temp file → rename)
```

## Commands

```bash
npm start             # Run the CLI (node src/cli.js)
npm test              # Run tests (test/test.js — not yet implemented)
```

There is no build step. No linting or formatting tools are configured.

## Architecture

### Entry Types
Seven semantic types defined in `src/utils/schemas.js`: `decision`, `learning`, `error`, `solution`, `pattern`, `context`, `conversation`.

### Storage Scopes
- **project** — project-specific memories stored in `~/.claude/memory/projects/<hash>/` (MD5 hash of project path, first 12 chars)
- **global** — universal knowledge in `~/.claude/memory/global/`

Each scope contains: `decisions.json`, `learnings.json`, `context.json`, `index.json`, and a `conversations/` directory.

### Key Classes
| Class | File | Role |
|-------|------|------|
| `ClaudeMemory` | `src/index.js` | High-level convenience API (quick add/search methods) |
| `MemoryManager` | `src/memory-manager.js` | Low-level CRUD, index management |
| `SearchEngine` | `src/search.js` | Tokenized search, Jaccard similarity, recency bonus |
| `Extractor` | `src/extractor.js` | Pattern matching to auto-detect insights |
| `ConversationTracker` | `src/conversation.js` | Session-based conversation logging and summarization |

### Data Persistence
All data is JSON. Writes use an atomic temp-file-then-rename pattern to prevent corruption. An index file tracks metadata (byType, byTag, byFile, recent entries).

## Code Conventions

- Pure JavaScript (no TypeScript), Node.js CommonJS modules (`require`/`module.exports`)
- No external dependencies — all functionality is self-contained
- Single responsibility per module
- Input validation via `validateEntry()` in schemas
- Search terms are pre-extracted and stored with entries (stop-word removal, tokenization)
- CLI uses raw ANSI escape codes for colored output (no chalk/colors dependency)

## CLI Entry Points

- Unix: `node src/cli.js` (has shebang `#!/usr/bin/env node`)
- Windows: `cmem.cmd` batch wrapper

## What's Missing

- Automated tests (`test/` directory does not exist yet)
- Linting/formatting configuration
- CI/CD pipeline
- TypeScript types or JSDoc annotations
