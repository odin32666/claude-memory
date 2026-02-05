# Claude Memory

A persistent knowledge base and memory system for Claude Code. Remember decisions, learnings, errors, solutions, and patterns across coding sessions.

## What It Does

Claude Code doesn't remember things between conversations. This tool fixes that by:

- **Saving what you learn** - Store decisions, learnings, errors and their fixes
- **Searching your knowledge** - Find past solutions when you hit similar problems
- **Project + Global memory** - Some things are project-specific, others apply everywhere
- **Auto-extracting insights** - Automatically detects decisions and learnings from text

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
