# Claude Memory

A persistent knowledge base and memory system for Claude Code. Remember decisions, learnings, errors, solutions, and patterns across coding sessions.

## What It Does

Claude Code doesn't remember things between conversations. This tool fixes that by:

- **Saving what you learn** - Store decisions, learnings, errors and their fixes
- **Searching your knowledge** - Find past solutions when you hit similar problems
- **Project + Global memory** - Some things are project-specific, others apply everywhere
- **Auto-extracting insights** - Automatically detects decisions and learnings from text
- **Cross-device sync** - Keep your memories in sync across computer, tablet, and phone via git

## Quick Start

```bash
# Initialize (creates the memory folders)
cmem init

# Add a decision you made
cmem add --type=decision --title="Use PostgreSQL" --content="Chose PostgreSQL over MongoDB because we need relational data and ACID compliance"

# Add something you learned
cmem add --type=learning --title="React useEffect cleanup" --content="Always return a cleanup function to avoid memory leaks"

# Search your memories
cmem search "database"

# See recent entries
cmem recent

# Interactive mode (walks you through adding)
cmem add -i
```

## Installation

### Option 1: Clone and Use

```bash
git clone https://github.com/YOUR_USERNAME/claude-memory.git
cd claude-memory
node src/cli.js init
```

### Option 2: Add to PATH (recommended)

After cloning, add the directory to your system PATH:

**Windows:**
```cmd
setx PATH "%PATH%;C:\path\to\claude-memory"
```

**Mac/Linux:**
```bash
echo 'alias cmem="node /path/to/claude-memory/src/cli.js"' >> ~/.bashrc
source ~/.bashrc
```

## Commands

| Command | Description |
|---------|-------------|
| `cmem add` | Add a new memory entry (use `-i` for interactive) |
| `cmem search <query>` | Search all memories |
| `cmem recent` | Show recent entries |
| `cmem context` | Show memory context for current project |
| `cmem stats` | Show statistics |
| `cmem export` | Export to JSON or Markdown |
| `cmem delete <id>` | Delete an entry |
| `cmem sync` | Sync memories across all devices |
| `cmem sync init <url>` | Connect device to sync repo |
| `cmem sync status` | Check sync status |
| `cmem help` | Show help |

## Entry Types

- **decision** - Choices you made and why
- **learning** - Things you discovered or figured out
- **error** - Problems you encountered
- **solution** - How you fixed problems
- **pattern** - Reusable approaches or conventions
- **context** - General notes and context

## Storage

Memories are stored as JSON files in `~/.claude/memory/`:

```
~/.claude/memory/
├── global/           # Memories that apply everywhere
│   ├── decisions.json
│   ├── learnings.json
│   └── conversations/
└── projects/         # Project-specific memories
    └── <hash>/
        ├── decisions.json
        ├── context.json
        └── conversations/
```

## Cross-Device Sync

Keep your memories in sync across all your devices (computer, tablet, phone) using a private git repository.

### Setup

1. Create a **private** repository on GitHub (e.g., `my-claude-memory`)
2. Run `cmem sync init` on each device:

```bash
# On your computer
cmem sync init https://github.com/YOU/my-claude-memory.git --device=MacBook

# On your tablet
cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPad

# On your phone
cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPhone
```

### Usage

```bash
# Full sync (pull remote + push local) — the default
cmem sync

# Push only your local changes
cmem sync push

# Pull only remote changes
cmem sync pull

# Check sync status
cmem sync status

# Enable/disable auto-sync (syncs on every cmem add)
cmem sync auto on
cmem sync auto off

# Name your device
cmem sync device "Work-Laptop"
```

### How It Works

- Your `~/.claude/memory/` directory becomes a git repo
- Each device pushes/pulls to the same remote
- Merge conflicts in JSON files are auto-resolved (entries are deduplicated by ID)
- Auto-sync mode pushes after every `cmem add` (with 30-second debounce)
- Network failures retry with exponential backoff (2s, 4s, 8s, 16s)

## Programmatic API

```javascript
const { ClaudeMemory } = require('claude-memory');

const mem = new ClaudeMemory().init();

// Add entries
mem.addDecision("Title", "Why we decided this");
mem.addLearning("Title", "What we learned");
mem.addErrorSolution("Error name", "The error", "How to fix it");

// Search
const results = mem.find("authentication");

// Get recent
const recent = mem.recent(10);

// Generate CLAUDE.md section
const mdSection = mem.generateClaudeMdSection();
```

## Integration with Claude Code

Add this to your project's `CLAUDE.md`:

```markdown
## Memory Context

Run `cmem context` to see relevant memories for this project.
Run `cmem search <topic>` to find specific knowledge.
```

## Examples

### Save a debugging session

```bash
cmem add --type=solution \
  --title="Fix CORS errors in Express" \
  --content="Added cors middleware before routes. Order matters - must be app.use(cors()) before app.use(router)" \
  --tags=express,cors,debugging
```

### Save an architecture decision

```bash
cmem add --type=decision \
  --title="Use React Query for data fetching" \
  --content="Chose React Query over SWR because better devtools and mutation handling. Redux was overkill for our needs." \
  --tags=react,architecture
```

### Export your knowledge

```bash
# As markdown (great for documentation)
cmem export --format=md > my-knowledge.md

# As JSON (for backup)
cmem export > backup.json
```

## License

MIT
