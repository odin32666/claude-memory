#!/usr/bin/env node

const MemoryManager = require('./memory-manager');
const SearchEngine = require('./search');
const SyncManager = require('./sync');
const { ENTRY_TYPES, SCOPES } = require('./utils/schemas');
const readline = require('readline');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function colorize(text, color) {
  return `${colors[color] || ''}${text}${colors.reset}`;
}

function formatEntry(entry, verbose = false) {
  const typeColors = {
    decision: 'yellow',
    learning: 'green',
    error: 'red',
    solution: 'cyan',
    pattern: 'magenta',
    context: 'blue'
  };

  const typeColor = typeColors[entry.type] || 'white';
  const date = new Date(entry.timestamp).toLocaleDateString();
  const scope = entry._scope ? ` [${entry._scope}]` : '';

  let output = `${colorize(`[${entry.type.toUpperCase()}]`, typeColor)} ${colorize(entry.title, 'bright')}${scope}\n`;
  output += `  ${colorize('ID:', 'dim')} ${entry.id.slice(0, 8)}  ${colorize('Date:', 'dim')} ${date}\n`;

  if (entry.tags && entry.tags.length > 0) {
    output += `  ${colorize('Tags:', 'dim')} ${entry.tags.map(t => colorize(`#${t}`, 'cyan')).join(' ')}\n`;
  }

  if (verbose) {
    output += `  ${colorize('Content:', 'dim')}\n`;
    const lines = entry.content.split('\n').map(l => `    ${l}`).join('\n');
    output += `${lines}\n`;

    if (entry.relatedFiles && entry.relatedFiles.length > 0) {
      output += `  ${colorize('Files:', 'dim')} ${entry.relatedFiles.join(', ')}\n`;
    }
  } else {
    // Show truncated content
    const preview = entry.content.slice(0, 100).replace(/\n/g, ' ');
    output += `  ${preview}${entry.content.length > 100 ? '...' : ''}\n`;
  }

  if (entry._score) {
    output += `  ${colorize(`Relevance: ${entry._score.toFixed(1)}`, 'dim')}\n`;
  }

  return output;
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptMultiline(question) {
  console.log(question);
  console.log(colorize('(Enter a blank line to finish)', 'dim'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const lines = [];
  return new Promise(resolve => {
    rl.on('line', line => {
      if (line === '') {
        rl.close();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
}

// ============ Commands ============

async function cmdAdd(args) {
  const manager = new MemoryManager();

  // Parse flags
  const typeArg = args.find(a => a.startsWith('--type='));
  const titleArg = args.find(a => a.startsWith('--title='));
  const contentArg = args.find(a => a.startsWith('--content='));
  const tagsArg = args.find(a => a.startsWith('--tags='));
  const filesArg = args.find(a => a.startsWith('--files='));
  const scopeArg = args.find(a => a.startsWith('--scope='));
  const interactive = args.includes('-i') || args.includes('--interactive');

  let type, title, content, tags, files, scope;

  if (interactive || (!typeArg && !titleArg)) {
    // Interactive mode
    console.log(colorize('\n=== Add Memory Entry ===\n', 'bright'));

    console.log('Entry types: decision, learning, error, solution, pattern, context');
    type = await prompt('Type: ');
    if (!Object.values(ENTRY_TYPES).includes(type)) {
      console.log(colorize(`Invalid type. Must be one of: ${Object.values(ENTRY_TYPES).join(', ')}`, 'red'));
      return;
    }

    title = await prompt('Title: ');
    if (!title) {
      console.log(colorize('Title is required', 'red'));
      return;
    }

    content = await promptMultiline('Content:');
    if (!content) {
      console.log(colorize('Content is required', 'red'));
      return;
    }

    const tagsInput = await prompt('Tags (comma-separated, optional): ');
    tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

    const filesInput = await prompt('Related files (comma-separated, optional): ');
    files = filesInput ? filesInput.split(',').map(f => f.trim()).filter(Boolean) : [];

    const scopeInput = await prompt('Scope (project/global, default: project): ');
    scope = scopeInput === 'global' ? SCOPES.GLOBAL : SCOPES.PROJECT;

  } else {
    // Flag mode
    type = typeArg?.split('=')[1];
    title = titleArg?.split('=')[1];
    content = contentArg?.split('=')[1];
    tags = tagsArg ? tagsArg.split('=')[1].split(',').map(t => t.trim()) : [];
    files = filesArg ? filesArg.split('=')[1].split(',').map(f => f.trim()) : [];
    scope = scopeArg?.split('=')[1] === 'global' ? SCOPES.GLOBAL : SCOPES.PROJECT;

    if (!type || !title || !content) {
      console.log(colorize('Error: --type, --title, and --content are required', 'red'));
      console.log('Usage: claude-memory add --type=decision --title="..." --content="..."');
      return;
    }
  }

  const result = manager.add({
    type,
    title,
    content,
    tags,
    relatedFiles: files,
    scope
  });

  if (result.success) {
    console.log(colorize('\n✓ Memory entry added successfully!', 'green'));
    console.log(formatEntry(result.entry, true));
  } else {
    console.log(colorize('\n✗ Failed to add entry:', 'red'));
    result.errors.forEach(e => console.log(`  - ${e}`));
  }
}

function cmdSearch(args) {
  const query = args.filter(a => !a.startsWith('--')).join(' ');

  if (!query) {
    console.log(colorize('Usage: claude-memory search <query> [--scope=project|global|both] [--type=...] [--limit=N]', 'yellow'));
    return;
  }

  const scopeArg = args.find(a => a.startsWith('--scope='));
  const typeArg = args.find(a => a.startsWith('--type='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const verbose = args.includes('-v') || args.includes('--verbose');

  const scope = scopeArg?.split('=')[1] || 'both';
  const types = typeArg ? typeArg.split('=')[1].split(',') : null;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 20;

  const search = new SearchEngine();
  const results = search.search(query, { scope, types, limit });

  if (results.length === 0) {
    console.log(colorize(`\nNo results found for "${query}"`, 'yellow'));
    return;
  }

  console.log(colorize(`\n=== Search Results for "${query}" (${results.length} found) ===\n`, 'bright'));

  for (const entry of results) {
    console.log(formatEntry(entry, verbose));
  }
}

function cmdRecent(args) {
  const limitArg = args.find(a => a.startsWith('--limit='));
  const scopeArg = args.find(a => a.startsWith('--scope='));
  const verbose = args.includes('-v') || args.includes('--verbose');

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10;
  const scope = scopeArg?.split('=')[1] || 'both';

  const manager = new MemoryManager();
  manager.init();

  let entries;
  if (scope === 'both') {
    entries = manager.getCombinedContext(limit);
  } else {
    entries = manager.getRecent(limit, scope === 'global' ? SCOPES.GLOBAL : SCOPES.PROJECT);
  }

  if (entries.length === 0) {
    console.log(colorize('\nNo entries found.', 'yellow'));
    console.log('Use "claude-memory add" to create your first entry.');
    return;
  }

  console.log(colorize(`\n=== Recent Entries (${entries.length}) ===\n`, 'bright'));

  for (const entry of entries) {
    console.log(formatEntry(entry, verbose));
  }
}

function cmdContext(args) {
  const verbose = args.includes('-v') || args.includes('--verbose');

  const manager = new MemoryManager();
  const stats = manager.stats();

  console.log(colorize('\n=== Memory Context ===\n', 'bright'));
  console.log(`${colorize('Project:', 'cyan')} ${process.cwd()}`);
  console.log(`${colorize('Project entries:', 'dim')} ${stats.project.total}`);
  console.log(`${colorize('Global entries:', 'dim')} ${stats.global.total}`);
  console.log('');

  // Show type breakdown
  if (stats.project.total > 0) {
    console.log(colorize('Project breakdown:', 'bright'));
    for (const [type, count] of Object.entries(stats.project.byType)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log('');
  }

  // Show most recent relevant entries
  const recent = manager.getCombinedContext(5);
  if (recent.length > 0) {
    console.log(colorize('Most recent:', 'bright'));
    for (const entry of recent) {
      console.log(formatEntry(entry, verbose));
    }
  }
}

function cmdExport(args) {
  const formatArg = args.find(a => a.startsWith('--format='));
  const format = formatArg?.split('=')[1] || 'json';
  const scopeArg = args.find(a => a.startsWith('--scope='));
  const scope = scopeArg?.split('=')[1] || null;

  const manager = new MemoryManager();
  const data = manager.export(scope === 'project' ? SCOPES.PROJECT : scope === 'global' ? SCOPES.GLOBAL : null);

  if (format === 'md' || format === 'markdown') {
    // Export as markdown
    let md = '# Claude Memory Export\n\n';
    md += `Exported: ${data.exportedAt}\n\n`;

    const renderEntries = (entries, title) => {
      if (!entries || entries.length === 0) return '';
      let section = `## ${title}\n\n`;
      for (const entry of entries) {
        section += `### ${entry.title}\n`;
        section += `- **Type:** ${entry.type}\n`;
        section += `- **Date:** ${new Date(entry.timestamp).toLocaleString()}\n`;
        if (entry.tags.length > 0) {
          section += `- **Tags:** ${entry.tags.join(', ')}\n`;
        }
        section += `\n${entry.content}\n\n`;
      }
      return section;
    };

    if (data.project) {
      md += renderEntries(data.project.entries, `Project: ${data.project.path}`);
    }
    if (data.global) {
      md += renderEntries(data.global.entries, 'Global');
    }
    if (data.entries) {
      md += renderEntries(data.entries, `${data.scope} entries`);
    }

    console.log(md);
  } else {
    // Export as JSON
    console.log(JSON.stringify(data, null, 2));
  }
}

function cmdStats() {
  const manager = new MemoryManager();
  const stats = manager.stats();

  console.log(colorize('\n=== Memory Statistics ===\n', 'bright'));
  console.log(`${colorize('Total entries:', 'cyan')} ${stats.combined}`);
  console.log('');

  console.log(colorize('Project:', 'bright'));
  console.log(`  Total: ${stats.project.total}`);
  for (const [type, count] of Object.entries(stats.project.byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  console.log(colorize('Global:', 'bright'));
  console.log(`  Total: ${stats.global.total}`);
  for (const [type, count] of Object.entries(stats.global.byType)) {
    console.log(`  ${type}: ${count}`);
  }
}

function cmdDelete(args) {
  const id = args[0];
  if (!id) {
    console.log(colorize('Usage: claude-memory delete <id>', 'yellow'));
    return;
  }

  const manager = new MemoryManager();
  manager.init();

  // Try to find and show the entry first
  const entry = manager.getById(id, SCOPES.PROJECT) || manager.getById(id, SCOPES.GLOBAL);
  if (!entry) {
    console.log(colorize(`Entry not found: ${id}`, 'red'));
    return;
  }

  console.log(colorize('\nDeleting entry:', 'yellow'));
  console.log(formatEntry(entry, true));

  const result = manager.delete(id, SCOPES.PROJECT) || manager.delete(id, SCOPES.GLOBAL);
  if (result.success) {
    console.log(colorize('✓ Entry deleted', 'green'));
  } else {
    console.log(colorize('✗ Failed to delete entry', 'red'));
  }
}

function cmdInit() {
  const manager = new MemoryManager();
  manager.init();
  console.log(colorize('✓ Memory structure initialized', 'green'));
  console.log(`  Global: ~/.claude/memory/global/`);
  console.log(`  Project: ~/.claude/memory/projects/<hash>/`);
}

function cmdBriefing() {
  const sync = new SyncManager();
  const entries = sync._getAllEntries();
  const MAX_ENTRIES = 50;
  const MAX_CONTENT_LEN = 200;

  if (entries.length === 0) {
    console.log(colorize('No memories stored yet. Use "cmem add" to create entries.', 'yellow'));
    return;
  }

  const capped = entries.slice(0, MAX_ENTRIES);

  // Output clean markdown (no ANSI colors) so it can be copy-pasted
  let md = `# Claude Memory Briefing\n\n`;
  md += `> ${entries.length} memories | Paste into any Claude conversation.\n\n---\n\n`;

  const byType = {};
  for (const entry of capped) {
    const type = entry.type || 'other';
    if (!byType[type]) byType[type] = [];
    byType[type].push(entry);
  }

  const typeOrder = [
    ['decision', 'Decisions'], ['learning', 'Learnings'], ['solution', 'Solutions'],
    ['error', 'Errors'], ['pattern', 'Patterns'], ['context', 'Context']
  ];

  for (const [type, label] of typeOrder) {
    const items = byType[type];
    if (!items || items.length === 0) continue;

    md += `## ${label}\n\n`;
    for (const entry of items) {
      const content = (entry.content || '').replace(/\n/g, ' ').slice(0, MAX_CONTENT_LEN);
      const ellipsis = (entry.content || '').length > MAX_CONTENT_LEN ? '...' : '';
      const tags = entry.tags && entry.tags.length > 0 ? ` [${entry.tags.join(',')}]` : '';
      md += `- **${entry.title}**${tags}: ${content}${ellipsis}\n`;
    }
    md += `\n`;
  }

  if (entries.length > MAX_ENTRIES) {
    md += `\n*${entries.length - MAX_ENTRIES} older entries omitted.*\n`;
  }

  console.log(md);
}

function cmdSync(args) {
  const subcommand = args[0];
  const sync = new SyncManager();

  switch (subcommand) {
    case 'init': {
      const repoUrl = args[1];
      if (!repoUrl) {
        console.log(colorize('Usage: cmem sync init <repo-url> [--device=name] [--no-auto]', 'yellow'));
        console.log('');
        console.log(colorize('Setup:', 'cyan'));
        console.log('  1. Create a private repo on GitHub (e.g., "my-claude-memory")');
        console.log('  2. Run: cmem sync init https://github.com/YOU/my-claude-memory.git');
        console.log('  3. Repeat on each device (computer, tablet, phone)');
        console.log('');
        console.log('All devices will share the same memories via git.');
        return;
      }

      const deviceArg = args.find(a => a.startsWith('--device='));
      const deviceName = deviceArg ? deviceArg.split('=')[1] : undefined;
      const noAuto = args.includes('--no-auto');

      console.log(colorize('\nInitializing sync...', 'cyan'));
      const result = sync.init(repoUrl, { deviceName, autoSync: !noAuto });

      if (result.success) {
        console.log(colorize('\n✓ Sync initialized!', 'green'));
        console.log(`  ${colorize('Remote:', 'dim')} ${repoUrl}`);
        console.log(`  ${colorize('Device:', 'dim')} ${result.deviceName}`);
        console.log(`  ${colorize('Branch:', 'dim')} ${result.branch}`);
        console.log(`  ${colorize('Auto-sync:', 'dim')} ${result.autoSync ? 'enabled' : 'disabled'}`);
        console.log('');
        console.log(colorize('Run this same command on your other devices to connect them.', 'dim'));
      } else {
        console.log(colorize(`\n✗ ${result.error}`, 'red'));
      }
      break;
    }

    case 'push': {
      console.log(colorize('Pushing memories to remote...', 'cyan'));
      const result = sync.push();
      if (result.success) {
        console.log(colorize(`✓ ${result.message}`, 'green'));
      } else {
        console.log(colorize(`✗ ${result.error}`, 'red'));
      }
      break;
    }

    case 'pull': {
      console.log(colorize('Pulling memories from remote...', 'cyan'));
      const result = sync.pull();
      if (result.success) {
        console.log(colorize(`✓ ${result.message}`, 'green'));
      } else {
        console.log(colorize(`✗ ${result.error}`, 'red'));
      }
      break;
    }

    case 'status': {
      const status = sync.status();
      console.log(colorize('\n=== Sync Status ===\n', 'bright'));

      if (!status.enabled) {
        console.log(colorize(status.message, 'yellow'));
        return;
      }

      console.log(`  ${colorize('Enabled:', 'dim')} yes`);
      console.log(`  ${colorize('Remote:', 'dim')} ${status.repoUrl}`);
      console.log(`  ${colorize('Device:', 'dim')} ${status.deviceName}`);
      console.log(`  ${colorize('Branch:', 'dim')} ${status.branch}`);
      console.log(`  ${colorize('Auto-sync:', 'dim')} ${status.autoSync ? 'on' : 'off'}`);
      console.log(`  ${colorize('Last sync:', 'dim')} ${status.lastSync || 'never'}`);
      console.log(`  ${colorize('Pending changes:', 'dim')} ${status.pendingChanges}`);
      break;
    }

    case 'auto': {
      const onOff = args[1];
      if (onOff !== 'on' && onOff !== 'off') {
        console.log(colorize('Usage: cmem sync auto on|off', 'yellow'));
        return;
      }
      const result = sync.setAutoSync(onOff === 'on');
      console.log(colorize(`✓ Auto-sync ${result.autoSync ? 'enabled' : 'disabled'}`, 'green'));
      break;
    }

    case 'device': {
      const name = args[1];
      if (!name) {
        console.log(colorize('Usage: cmem sync device <name>', 'yellow'));
        console.log('Examples: cmem sync device "MacBook-Pro", cmem sync device "iPad", cmem sync device "iPhone"');
        return;
      }
      const result = sync.setDeviceName(name);
      console.log(colorize(`✓ Device name set to: ${result.deviceName}`, 'green'));
      break;
    }

    default: {
      // No subcommand = full sync (pull + push)
      if (!subcommand || subcommand.startsWith('--')) {
        const status = sync.status();
        if (!status.enabled) {
          console.log(colorize(status.message, 'yellow'));
          return;
        }

        console.log(colorize('Syncing memories...', 'cyan'));
        const result = sync.sync();
        if (result.success) {
          console.log(colorize(`✓ ${result.message}`, 'green'));
        } else {
          console.log(colorize(`✗ ${result.error}`, 'red'));
        }
      } else {
        console.log(colorize(`Unknown sync subcommand: ${subcommand}`, 'red'));
        console.log('');
        cmdSyncHelp();
      }
    }
  }
}

function cmdSyncHelp() {
  console.log(`${colorize('Sync Commands:', 'cyan')}
  sync                         Full sync (pull + push)
  sync init <repo-url>         Connect to a sync repo
  sync push                    Push local memories to remote
  sync pull                    Pull remote memories to local
  sync status                  Show sync status
  sync auto on|off             Enable/disable auto-sync
  sync device <name>           Set this device's name

${colorize('Setup (run on each device):', 'cyan')}
  cmem sync init https://github.com/YOU/my-claude-memory.git --device=MacBook
  cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPad
  cmem sync init https://github.com/YOU/my-claude-memory.git --device=iPhone
`);
}

function cmdHelp() {
  console.log(`
${colorize('Claude Memory - Persistent Knowledge Base', 'bright')}

${colorize('Usage:', 'cyan')} claude-memory <command> [options]

${colorize('Commands:', 'cyan')}
  add         Add a new memory entry (interactive or with flags)
  search      Search across all entries
  recent      Show recent entries
  context     Show memory context for current project
  export      Export entries to JSON or Markdown
  stats       Show memory statistics
  delete      Delete an entry by ID
  init        Initialize memory structure
  sync        Sync memories across devices via git
  briefing    Print all memories as markdown (for copy-paste to Claude.ai)
  help        Show this help message

${colorize('Add command options:', 'cyan')}
  -i, --interactive          Interactive mode (default if no flags)
  --type=<type>              Entry type (decision, learning, error, solution, pattern, context)
  --title="..."              Entry title
  --content="..."            Entry content
  --tags=tag1,tag2           Comma-separated tags
  --files=path1,path2        Related files
  --scope=project|global     Memory scope (default: project)

${colorize('Search command options:', 'cyan')}
  --scope=project|global|both   Search scope (default: both)
  --type=type1,type2            Filter by types
  --limit=N                     Max results (default: 20)
  -v, --verbose                 Show full content

${colorize('Sync commands:', 'cyan')}
  sync                         Full sync (pull + push)
  sync init <repo-url>         Connect to a sync repo
  sync push                    Push local memories to remote
  sync pull                    Pull remote memories to local
  sync status                  Show sync status
  sync auto on|off             Enable/disable auto-sync
  sync device <name>           Set this device's name

${colorize('Examples:', 'cyan')}
  claude-memory add -i
  claude-memory add --type=decision --title="Use React Query" --content="..."
  claude-memory search "authentication" --scope=global
  claude-memory recent --limit=5
  claude-memory export --format=md > knowledge.md
  claude-memory sync init https://github.com/you/memory.git --device=MacBook
  claude-memory sync
`);
}

// ============ Main ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'add':
      await cmdAdd(commandArgs);
      break;
    case 'search':
      cmdSearch(commandArgs);
      break;
    case 'recent':
      cmdRecent(commandArgs);
      break;
    case 'context':
      cmdContext(commandArgs);
      break;
    case 'export':
      cmdExport(commandArgs);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'delete':
      cmdDelete(commandArgs);
      break;
    case 'init':
      cmdInit();
      break;
    case 'sync':
      cmdSync(commandArgs);
      break;
    case 'briefing':
      cmdBriefing();
      break;
    case 'help':
    case '--help':
    case '-h':
      cmdHelp();
      break;
    default:
      if (command) {
        console.log(colorize(`Unknown command: ${command}`, 'red'));
      }
      cmdHelp();
  }
}

main().catch(err => {
  console.error(colorize(`Error: ${err.message}`, 'red'));
  process.exit(1);
});
