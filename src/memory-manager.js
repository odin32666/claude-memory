const path = require('path');
const {
  GLOBAL_DIR,
  getProjectMemoryDir,
  initializeMemoryStructure,
  readJson,
  writeJsonAtomic,
  appendToJsonArray,
  updateInJsonArray,
  deleteFromJsonArray,
  getCurrentProjectPath
} = require('./utils/storage');
const { ENTRY_TYPES, SCOPES, createEntry, validateEntry } = require('./utils/schemas');
const SyncManager = require('./sync');
const LangfuseClient = require('./langfuse');

class MemoryManager {
  constructor(projectPath = null) {
    this.projectPath = projectPath || getCurrentProjectPath();
    this.initialized = false;
  }

  /**
   * Initialize memory structure
   */
  init() {
    if (this.initialized) return this;

    const { globalDir, projectDir } = initializeMemoryStructure(this.projectPath);
    this.globalDir = globalDir;
    this.projectDir = projectDir;
    this.initialized = true;

    return this;
  }

  /**
   * Get the appropriate directory based on scope
   */
  _getDir(scope) {
    return scope === SCOPES.GLOBAL ? this.globalDir : this.projectDir;
  }

  /**
   * Get the entries file path for a given scope
   */
  _getEntriesPath(scope, type = null) {
    const dir = this._getDir(scope);
    if (type === ENTRY_TYPES.DECISION) {
      return path.join(dir, 'decisions.json');
    } else if (type === ENTRY_TYPES.LEARNING) {
      return path.join(dir, 'learnings.json');
    }
    return path.join(dir, 'context.json');
  }

  /**
   * Get the index file path for a given scope
   */
  _getIndexPath(scope) {
    return path.join(this._getDir(scope), 'index.json');
  }

  /**
   * Add a new memory entry
   */
  add({ type, title, content, tags = [], relatedFiles = [], source = 'manual', scope = SCOPES.PROJECT, metadata = {} }) {
    this.init();

    const entry = createEntry({ type, title, content, tags, relatedFiles, source, scope, metadata });

    const validation = validateEntry(entry);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Determine where to store based on type
    let entriesPath;
    if (type === ENTRY_TYPES.DECISION) {
      entriesPath = path.join(this._getDir(scope), 'decisions.json');
    } else if (type === ENTRY_TYPES.LEARNING) {
      entriesPath = path.join(this._getDir(scope), 'learnings.json');
    } else {
      // For other types, store in context.json
      entriesPath = path.join(this._getDir(scope), 'context.json');
    }

    // For context.json, it's an object with entries array
    if (entriesPath.endsWith('context.json')) {
      const context = readJson(entriesPath) || { projectPath: this.projectPath, entries: [] };
      context.entries.push(entry);
      context.lastUpdated = new Date().toISOString();
      writeJsonAtomic(entriesPath, context);
    } else {
      appendToJsonArray(entriesPath, entry);
    }

    // Update index
    this._updateIndex(scope, entry);

    // Auto-sync if enabled
    try {
      const sync = new SyncManager();
      sync.autoSyncIfEnabled();
    } catch (e) {
      // Sync failure should not block adding entries
    }

    // Track in Langfuse if enabled
    try {
      const lf = new LangfuseClient();
      lf.trackOperation('add', { type, title, scope, tags });
    } catch (e) {
      // Langfuse failure should not block adding entries
    }

    return { success: true, entry };
  }

  /**
   * Update the index with a new entry
   */
  _updateIndex(scope, entry) {
    const indexPath = this._getIndexPath(scope);
    const index = readJson(indexPath) || {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      entries: { byType: {}, byTag: {}, byFile: {}, recent: [] }
    };

    // Add to byType
    if (!index.entries.byType[entry.type]) {
      index.entries.byType[entry.type] = [];
    }
    index.entries.byType[entry.type].push(entry.id);

    // Add to byTag
    for (const tag of entry.tags) {
      if (!index.entries.byTag[tag]) {
        index.entries.byTag[tag] = [];
      }
      index.entries.byTag[tag].push(entry.id);
    }

    // Add to byFile
    for (const file of entry.relatedFiles) {
      if (!index.entries.byFile[file]) {
        index.entries.byFile[file] = [];
      }
      index.entries.byFile[file].push(entry.id);
    }

    // Add to recent (keep last 100)
    index.entries.recent.unshift(entry.id);
    index.entries.recent = index.entries.recent.slice(0, 100);

    index.lastUpdated = new Date().toISOString();
    writeJsonAtomic(indexPath, index);
  }

  /**
   * Get all entries of a specific type
   */
  getByType(type, scope = SCOPES.PROJECT) {
    this.init();

    if (type === ENTRY_TYPES.DECISION) {
      return readJson(path.join(this._getDir(scope), 'decisions.json')) || [];
    } else if (type === ENTRY_TYPES.LEARNING) {
      return readJson(path.join(this._getDir(scope), 'learnings.json')) || [];
    } else {
      const context = readJson(path.join(this._getDir(scope), 'context.json')) || { entries: [] };
      return context.entries.filter(e => e.type === type);
    }
  }

  /**
   * Get all entries (across all types)
   */
  getAll(scope = SCOPES.PROJECT) {
    this.init();

    const dir = this._getDir(scope);
    const decisions = readJson(path.join(dir, 'decisions.json')) || [];
    const learnings = readJson(path.join(dir, 'learnings.json')) || [];
    const context = readJson(path.join(dir, 'context.json')) || { entries: [] };

    return [...decisions, ...learnings, ...context.entries];
  }

  /**
   * Get recent entries
   */
  getRecent(limit = 10, scope = SCOPES.PROJECT) {
    this.init();

    const all = this.getAll(scope);
    return all
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Get entries by tags
   */
  getByTags(tags, scope = SCOPES.PROJECT) {
    this.init();

    const all = this.getAll(scope);
    return all.filter(entry =>
      tags.some(tag => entry.tags.includes(tag))
    );
  }

  /**
   * Get entries related to a file
   */
  getForFile(filePath, scope = SCOPES.PROJECT) {
    this.init();

    const all = this.getAll(scope);
    return all.filter(entry =>
      entry.relatedFiles.some(f => f.includes(filePath) || filePath.includes(f))
    );
  }

  /**
   * Get an entry by ID
   */
  getById(id, scope = SCOPES.PROJECT) {
    this.init();

    const all = this.getAll(scope);
    return all.find(entry => entry.id === id);
  }

  /**
   * Delete an entry by ID
   */
  delete(id, scope = SCOPES.PROJECT) {
    this.init();

    const entry = this.getById(id, scope);
    if (!entry) {
      return { success: false, error: 'Entry not found' };
    }

    const dir = this._getDir(scope);
    let deleted = false;

    // Try to delete from each file
    if (deleteFromJsonArray(path.join(dir, 'decisions.json'), id)) {
      deleted = true;
    }
    if (deleteFromJsonArray(path.join(dir, 'learnings.json'), id)) {
      deleted = true;
    }

    // For context.json
    const contextPath = path.join(dir, 'context.json');
    const context = readJson(contextPath);
    if (context && context.entries) {
      const before = context.entries.length;
      context.entries = context.entries.filter(e => e.id !== id);
      if (context.entries.length < before) {
        writeJsonAtomic(contextPath, context);
        deleted = true;
      }
    }

    // Update index (remove from all index arrays)
    this._removeFromIndex(scope, id);

    return { success: deleted };
  }

  /**
   * Remove an entry ID from the index
   */
  _removeFromIndex(scope, id) {
    const indexPath = this._getIndexPath(scope);
    const index = readJson(indexPath);
    if (!index) return;

    // Remove from byType
    for (const type in index.entries.byType) {
      index.entries.byType[type] = index.entries.byType[type].filter(i => i !== id);
    }

    // Remove from byTag
    for (const tag in index.entries.byTag) {
      index.entries.byTag[tag] = index.entries.byTag[tag].filter(i => i !== id);
    }

    // Remove from byFile
    for (const file in index.entries.byFile) {
      index.entries.byFile[file] = index.entries.byFile[file].filter(i => i !== id);
    }

    // Remove from recent
    index.entries.recent = index.entries.recent.filter(i => i !== id);

    index.lastUpdated = new Date().toISOString();
    writeJsonAtomic(indexPath, index);
  }

  /**
   * Get combined context (project + global)
   */
  getCombinedContext(limit = 20) {
    this.init();

    const projectEntries = this.getAll(SCOPES.PROJECT);
    const globalEntries = this.getAll(SCOPES.GLOBAL);

    // Combine and sort by timestamp
    return [...projectEntries, ...globalEntries]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Export all entries to a structured object
   */
  export(scope = null) {
    this.init();

    if (scope) {
      return {
        scope,
        entries: this.getAll(scope),
        exportedAt: new Date().toISOString()
      };
    }

    return {
      project: {
        path: this.projectPath,
        entries: this.getAll(SCOPES.PROJECT)
      },
      global: {
        entries: this.getAll(SCOPES.GLOBAL)
      },
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import entries from an export
   */
  import(data) {
    this.init();

    let imported = 0;

    if (data.project && data.project.entries) {
      for (const entry of data.project.entries) {
        this.add({ ...entry, scope: SCOPES.PROJECT });
        imported++;
      }
    }

    if (data.global && data.global.entries) {
      for (const entry of data.global.entries) {
        this.add({ ...entry, scope: SCOPES.GLOBAL });
        imported++;
      }
    }

    if (data.entries) {
      for (const entry of data.entries) {
        this.add({ ...entry, scope: data.scope || SCOPES.PROJECT });
        imported++;
      }
    }

    return { success: true, imported };
  }

  /**
   * Get statistics about the memory
   */
  stats() {
    this.init();

    const projectEntries = this.getAll(SCOPES.PROJECT);
    const globalEntries = this.getAll(SCOPES.GLOBAL);

    const countByType = (entries) => {
      const counts = {};
      for (const entry of entries) {
        counts[entry.type] = (counts[entry.type] || 0) + 1;
      }
      return counts;
    };

    return {
      project: {
        total: projectEntries.length,
        byType: countByType(projectEntries)
      },
      global: {
        total: globalEntries.length,
        byType: countByType(globalEntries)
      },
      combined: projectEntries.length + globalEntries.length
    };
  }
}

module.exports = MemoryManager;
