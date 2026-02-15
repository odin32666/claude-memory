const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR, CLAUDE_HOME, GLOBAL_DIR, PROJECTS_DIR, readJson, writeJsonAtomic, ensureDir } = require('./utils/storage');

const SYNC_CONFIG_PATH = path.join(CLAUDE_HOME, 'sync.json');

class SyncManager {
  constructor() {
    this.config = this._loadConfig();
  }

  /**
   * Load sync configuration
   */
  _loadConfig() {
    return readJson(SYNC_CONFIG_PATH) || {
      enabled: false,
      repoUrl: null,
      autoSync: false,
      lastSync: null,
      deviceName: null,
      branch: 'main'
    };
  }

  /**
   * Save sync configuration
   */
  _saveConfig() {
    ensureDir(CLAUDE_HOME);
    writeJsonAtomic(SYNC_CONFIG_PATH, this.config);
  }

  /**
   * Run a git command in the memory directory
   */
  _git(command, options = {}) {
    const opts = {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    };

    try {
      const result = execSync(`git ${command}`, opts);
      return { success: true, output: (result || '').trim() };
    } catch (error) {
      return {
        success: false,
        output: (error.stdout || '').trim(),
        error: (error.stderr || error.message || '').trim()
      };
    }
  }

  /**
   * Initialize sync with a remote git repository
   */
  init(repoUrl, options = {}) {
    const deviceName = options.deviceName || this._detectDeviceName();
    const branch = options.branch || 'main';

    ensureDir(MEMORY_DIR);

    // Check if already a git repo
    const isRepo = this._git('rev-parse --is-inside-work-tree', { silent: true });

    if (isRepo.success) {
      // Already a repo — update remote
      this._git('remote remove origin', { silent: true });
      const addRemote = this._git(`remote add origin ${repoUrl}`);
      if (!addRemote.success) {
        return { success: false, error: `Failed to set remote: ${addRemote.error}` };
      }

      // Try to pull existing content
      this._git(`fetch origin ${branch}`, { silent: true });
      const remoteBranch = this._git(`rev-parse --verify origin/${branch}`, { silent: true });
      if (remoteBranch.success) {
        // Remote has content — merge it in
        this._git(`merge origin/${branch} --allow-unrelated-histories -m "Sync: merge remote memories"`, { silent: true });
      }
    } else {
      // Fresh init
      this._git('init');
      this._git(`remote add origin ${repoUrl}`);

      // Create .gitignore for temp files
      const gitignorePath = path.join(MEMORY_DIR, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, '*.tmp\n*.lock\n', 'utf-8');
      }

      // Try to pull existing content from remote
      const fetch = this._git(`fetch origin ${branch}`, { silent: true });
      if (fetch.success) {
        const remoteBranch = this._git(`rev-parse --verify origin/${branch}`, { silent: true });
        if (remoteBranch.success) {
          this._git(`checkout -b ${branch} origin/${branch}`, { silent: true });
        } else {
          this._git(`checkout -b ${branch}`);
        }
      } else {
        this._git(`checkout -b ${branch}`);
      }
    }

    // Save config
    this.config = {
      enabled: true,
      repoUrl,
      autoSync: options.autoSync !== undefined ? options.autoSync : true,
      lastSync: null,
      deviceName,
      branch
    };
    this._saveConfig();

    return {
      success: true,
      message: `Sync initialized with ${repoUrl}`,
      deviceName,
      branch,
      autoSync: this.config.autoSync
    };
  }

  /**
   * Push local memories to remote
   */
  push() {
    if (!this.config.enabled) {
      return { success: false, error: 'Sync not initialized. Run: cmem sync init <repo-url>' };
    }

    const branch = this.config.branch;

    // Regenerate CONTEXT.md before pushing so phone/web users see fresh data
    this._generateContextFile();

    // Stage all changes
    this._git('add -A');

    // Check if there are changes to commit
    const status = this._git('status --porcelain', { silent: true });
    if (!status.output) {
      return { success: true, message: 'Already up to date — no local changes to push' };
    }

    // Commit with device name and timestamp
    const timestamp = new Date().toISOString();
    const commitMsg = `sync: ${this.config.deviceName} @ ${timestamp}`;
    const commit = this._git(`commit -m "${commitMsg}"`);
    if (!commit.success) {
      return { success: false, error: `Failed to commit: ${commit.error}` };
    }

    // Push with retry
    const pushResult = this._pushWithRetry(branch);
    if (pushResult.success) {
      this.config.lastSync = timestamp;
      this._saveConfig();
    }

    return pushResult;
  }

  /**
   * Pull remote memories to local
   */
  pull() {
    if (!this.config.enabled) {
      return { success: false, error: 'Sync not initialized. Run: cmem sync init <repo-url>' };
    }

    const branch = this.config.branch;

    // Stash any local changes first
    this._git('add -A', { silent: true });
    const hasChanges = this._git('status --porcelain', { silent: true }).output;
    if (hasChanges) {
      this._git('stash', { silent: true });
    }

    // Fetch and merge with retry
    const fetchResult = this._fetchWithRetry(branch);
    if (!fetchResult.success) {
      // Restore stashed changes
      if (hasChanges) this._git('stash pop', { silent: true });
      return fetchResult;
    }

    // Merge remote changes
    const merge = this._git(`merge origin/${branch} --no-edit`, { silent: true });

    // If merge conflict, try to resolve by keeping both (ours + theirs for JSON arrays)
    if (!merge.success && merge.error && merge.error.includes('CONFLICT')) {
      // For JSON files, resolve conflicts by merging the content
      const conflictResult = this._resolveJsonConflicts();
      if (!conflictResult.success) {
        // If auto-resolve fails, abort and restore
        this._git('merge --abort', { silent: true });
        if (hasChanges) this._git('stash pop', { silent: true });
        return { success: false, error: 'Merge conflict could not be auto-resolved. Pull manually.' };
      }
    }

    // Restore stashed changes
    if (hasChanges) {
      this._git('stash pop', { silent: true });
    }

    this.config.lastSync = new Date().toISOString();
    this._saveConfig();

    return { success: true, message: 'Pulled latest memories from remote' };
  }

  /**
   * Full sync: pull then push
   */
  sync() {
    if (!this.config.enabled) {
      return { success: false, error: 'Sync not initialized. Run: cmem sync init <repo-url>' };
    }

    const pullResult = this.pull();
    if (!pullResult.success) {
      return { success: false, error: `Pull failed: ${pullResult.error}` };
    }

    const pushResult = this.push();
    if (!pushResult.success) {
      return { success: false, error: `Push failed: ${pushResult.error}` };
    }

    return {
      success: true,
      message: 'Sync complete — pulled remote changes and pushed local updates',
      lastSync: this.config.lastSync
    };
  }

  /**
   * Get sync status
   */
  status() {
    if (!this.config.enabled) {
      return {
        enabled: false,
        message: 'Sync not configured. Run: cmem sync init <repo-url>'
      };
    }

    const localChanges = this._git('status --porcelain', { silent: true });

    return {
      enabled: true,
      repoUrl: this.config.repoUrl,
      deviceName: this.config.deviceName,
      branch: this.config.branch,
      autoSync: this.config.autoSync,
      lastSync: this.config.lastSync,
      pendingChanges: (localChanges.output || '').split('\n').filter(Boolean).length
    };
  }

  /**
   * Enable or disable auto-sync
   */
  setAutoSync(enabled) {
    this.config.autoSync = enabled;
    this._saveConfig();
    return { success: true, autoSync: enabled };
  }

  /**
   * Update device name
   */
  setDeviceName(name) {
    this.config.deviceName = name;
    this._saveConfig();
    return { success: true, deviceName: name };
  }

  /**
   * Auto-sync if enabled (called after memory operations)
   */
  autoSyncIfEnabled() {
    if (!this.config.enabled || !this.config.autoSync) {
      return { skipped: true };
    }

    // Debounce: don't sync more than once per 30 seconds
    if (this.config.lastSync) {
      const elapsed = Date.now() - new Date(this.config.lastSync).getTime();
      if (elapsed < 30000) {
        return { skipped: true, reason: 'debounced' };
      }
    }

    return this.sync();
  }

  /**
   * Generate CONTEXT.md — a portable, human-readable file containing all memories.
   * This lives in the sync repo so phone/web users can open it on GitHub
   * and paste it into a Claude.ai conversation.
   */
  _generateContextFile() {
    const entries = this._getAllEntries();
    const now = new Date().toISOString();

    let md = `# Claude Memory — Full Context\n\n`;
    md += `> Auto-generated on ${new Date(now).toLocaleString()}. `;
    md += `Paste this into any Claude conversation to give it your full knowledge base.\n\n`;

    if (entries.length === 0) {
      md += `*No memories stored yet.*\n`;
      fs.writeFileSync(path.join(MEMORY_DIR, 'CONTEXT.md'), md, 'utf-8');
      return;
    }

    md += `**${entries.length} memories** across all devices and projects.\n\n`;
    md += `---\n\n`;

    // Group by type
    const byType = {};
    for (const entry of entries) {
      const type = entry.type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push(entry);
    }

    // Type display order and labels
    const typeOrder = [
      ['decision', 'Decisions'],
      ['learning', 'Learnings'],
      ['solution', 'Solutions'],
      ['error', 'Errors'],
      ['pattern', 'Patterns'],
      ['context', 'Context'],
      ['conversation', 'Conversations']
    ];

    for (const [type, label] of typeOrder) {
      const items = byType[type];
      if (!items || items.length === 0) continue;

      md += `## ${label} (${items.length})\n\n`;

      // Sort newest first
      items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      for (const entry of items) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const tags = entry.tags && entry.tags.length > 0
          ? ` — ${entry.tags.map(t => `\`${t}\``).join(', ')}`
          : '';

        md += `### ${entry.title}\n`;
        md += `*${date}${tags}*\n\n`;
        md += `${entry.content}\n\n`;
      }
    }

    // Handle any types not in the display order
    for (const [type, items] of Object.entries(byType)) {
      if (typeOrder.some(([t]) => t === type)) continue;
      if (items.length === 0) continue;

      md += `## ${type.charAt(0).toUpperCase() + type.slice(1)} (${items.length})\n\n`;
      items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      for (const entry of items) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        md += `### ${entry.title}\n`;
        md += `*${date}*\n\n`;
        md += `${entry.content}\n\n`;
      }
    }

    fs.writeFileSync(path.join(MEMORY_DIR, 'CONTEXT.md'), md, 'utf-8');
  }

  /**
   * Collect all entries from all scopes (global + all projects)
   */
  _getAllEntries() {
    const entries = [];

    // Collect from global
    const globalDecisions = readJson(path.join(GLOBAL_DIR, 'decisions.json'));
    const globalLearnings = readJson(path.join(GLOBAL_DIR, 'learnings.json'));
    const globalContext = readJson(path.join(GLOBAL_DIR, 'context.json'));

    if (Array.isArray(globalDecisions)) entries.push(...globalDecisions);
    if (Array.isArray(globalLearnings)) entries.push(...globalLearnings);
    if (globalContext && Array.isArray(globalContext.entries)) entries.push(...globalContext.entries);

    // Collect from all projects
    if (fs.existsSync(PROJECTS_DIR)) {
      const projectDirs = fs.readdirSync(PROJECTS_DIR).filter(d => {
        return fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory();
      });

      for (const dir of projectDirs) {
        const projectDir = path.join(PROJECTS_DIR, dir);

        const decisions = readJson(path.join(projectDir, 'decisions.json'));
        const learnings = readJson(path.join(projectDir, 'learnings.json'));
        const context = readJson(path.join(projectDir, 'context.json'));

        if (Array.isArray(decisions)) entries.push(...decisions);
        if (Array.isArray(learnings)) entries.push(...learnings);
        if (context && Array.isArray(context.entries)) entries.push(...context.entries);
      }
    }

    // Deduplicate by ID (in case of overlap)
    const seen = new Map();
    for (const entry of entries) {
      if (!entry || !entry.id) continue;
      const existing = seen.get(entry.id);
      if (!existing || new Date(entry.timestamp) > new Date(existing.timestamp)) {
        seen.set(entry.id, entry);
      }
    }

    return [...seen.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Push with exponential backoff retry
   */
  _pushWithRetry(branch, maxRetries = 4) {
    const delays = [2000, 4000, 8000, 16000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = this._git(`push -u origin ${branch}`, { silent: true });
      if (result.success) {
        return { success: true, message: `Pushed memories to remote (attempt ${attempt + 1})` };
      }

      if (attempt < maxRetries) {
        // Check if this is a network error (worth retrying)
        const isNetworkError = result.error && (
          result.error.includes('Could not resolve') ||
          result.error.includes('Connection refused') ||
          result.error.includes('Network is unreachable') ||
          result.error.includes('timed out') ||
          result.error.includes('SSL') ||
          result.error.includes('fatal: unable to access')
        );

        if (!isNetworkError) {
          return { success: false, error: `Push failed: ${result.error}` };
        }

        // Wait before retrying
        this._sleep(delays[attempt]);
      }
    }

    return { success: false, error: 'Push failed after all retry attempts' };
  }

  /**
   * Fetch with exponential backoff retry
   */
  _fetchWithRetry(branch, maxRetries = 4) {
    const delays = [2000, 4000, 8000, 16000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = this._git(`fetch origin ${branch}`, { silent: true });
      if (result.success) {
        return { success: true };
      }

      if (attempt < maxRetries) {
        const isNetworkError = result.error && (
          result.error.includes('Could not resolve') ||
          result.error.includes('Connection refused') ||
          result.error.includes('Network is unreachable') ||
          result.error.includes('timed out') ||
          result.error.includes('SSL') ||
          result.error.includes('fatal: unable to access')
        );

        if (!isNetworkError) {
          return { success: false, error: `Fetch failed: ${result.error}` };
        }

        this._sleep(delays[attempt]);
      }
    }

    return { success: false, error: 'Fetch failed after all retry attempts' };
  }

  /**
   * Attempt to resolve JSON merge conflicts by combining entries
   */
  _resolveJsonConflicts() {
    const status = this._git('diff --name-only --diff-filter=U', { silent: true });
    if (!status.success || !status.output) {
      return { success: false };
    }

    const conflictedFiles = status.output.split('\n').filter(Boolean);

    for (const file of conflictedFiles) {
      const filePath = path.join(MEMORY_DIR, file);

      if (!file.endsWith('.json')) {
        // Non-JSON conflicts: accept theirs
        this._git(`checkout --theirs "${file}"`, { silent: true });
        this._git(`add "${file}"`, { silent: true });
        continue;
      }

      // For JSON files: try to get both versions and merge
      const oursResult = this._git(`show :2:"${file}"`, { silent: true });
      const theirsResult = this._git(`show :3:"${file}"`, { silent: true });

      if (!oursResult.success || !theirsResult.success) {
        this._git(`checkout --theirs "${file}"`, { silent: true });
        this._git(`add "${file}"`, { silent: true });
        continue;
      }

      try {
        const ours = JSON.parse(oursResult.output);
        const theirs = JSON.parse(theirsResult.output);
        const merged = this._mergeJsonData(ours, theirs);

        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
        this._git(`add "${file}"`, { silent: true });
      } catch (e) {
        // JSON parse failed, accept theirs
        this._git(`checkout --theirs "${file}"`, { silent: true });
        this._git(`add "${file}"`, { silent: true });
      }
    }

    // Complete the merge
    const commit = this._git('commit --no-edit', { silent: true });
    return { success: commit.success };
  }

  /**
   * Merge two JSON data structures (combine entries, deduplicate by ID)
   */
  _mergeJsonData(ours, theirs) {
    // Both are arrays (decisions.json, learnings.json)
    if (Array.isArray(ours) && Array.isArray(theirs)) {
      return this._deduplicateById([...ours, ...theirs]);
    }

    // Both are objects with entries arrays (context.json, index.json)
    if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object') {
      const merged = { ...theirs, ...ours };

      // Merge entries arrays
      if (Array.isArray(ours.entries) && Array.isArray(theirs.entries)) {
        merged.entries = this._deduplicateById([...ours.entries, ...theirs.entries]);
      }

      // Merge index-style nested entries
      if (ours.entries && theirs.entries && !Array.isArray(ours.entries)) {
        merged.entries = { ...theirs.entries };
        for (const key of ['byType', 'byTag', 'byFile']) {
          if (ours.entries[key] && theirs.entries[key]) {
            merged.entries[key] = { ...theirs.entries[key] };
            for (const subKey in ours.entries[key]) {
              if (merged.entries[key][subKey]) {
                merged.entries[key][subKey] = [...new Set([
                  ...merged.entries[key][subKey],
                  ...ours.entries[key][subKey]
                ])];
              } else {
                merged.entries[key][subKey] = ours.entries[key][subKey];
              }
            }
          }
        }
        if (ours.entries.recent && theirs.entries.recent) {
          merged.entries.recent = [...new Set([
            ...ours.entries.recent,
            ...theirs.entries.recent
          ])].slice(0, 100);
        }
      }

      merged.lastUpdated = new Date().toISOString();
      return merged;
    }

    // Fallback: prefer ours
    return ours;
  }

  /**
   * Deduplicate array of objects by ID, keeping the most recent version
   */
  _deduplicateById(arr) {
    const seen = new Map();
    for (const item of arr) {
      if (!item || !item.id) continue;
      const existing = seen.get(item.id);
      if (!existing || new Date(item.timestamp) > new Date(existing.timestamp)) {
        seen.set(item.id, item);
      }
    }
    return [...seen.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Detect device name from OS hostname
   */
  _detectDeviceName() {
    const os = require('os');
    return os.hostname().split('.')[0] || 'unknown-device';
  }

  /**
   * Synchronous sleep (for retry backoff)
   */
  _sleep(ms) {
    execSync(`sleep ${ms / 1000}`, { stdio: 'ignore' });
  }
}

module.exports = SyncManager;
