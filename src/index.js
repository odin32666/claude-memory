/**
 * Claude Memory - Persistent Knowledge Base System
 *
 * A memory and knowledge management system for Claude Code that provides:
 * - Project-specific and global memory storage
 * - Full-text search across all entries
 * - Auto-extraction of decisions, learnings, and patterns
 * - Conversation tracking and summarization
 */

const MemoryManager = require('./memory-manager');
const SearchEngine = require('./search');
const ConversationTracker = require('./conversation');
const Extractor = require('./extractor');
const SyncManager = require('./sync');
const LangfuseClient = require('./langfuse');
const { ENTRY_TYPES, SCOPES } = require('./utils/schemas');

/**
 * Quick access API for common operations
 */
class ClaudeMemory {
  constructor(projectPath = null) {
    this.projectPath = projectPath;
    this.manager = new MemoryManager(projectPath);
    this.search = new SearchEngine(projectPath);
    this.tracker = new ConversationTracker(projectPath);
    this.extractor = new Extractor();
  }

  /**
   * Initialize memory structure
   */
  init() {
    this.manager.init();
    return this;
  }

  // ========== Quick Add Methods ==========

  /**
   * Add a decision
   */
  addDecision(title, content, options = {}) {
    return this.manager.add({
      type: ENTRY_TYPES.DECISION,
      title,
      content,
      ...options
    });
  }

  /**
   * Add a learning
   */
  addLearning(title, content, options = {}) {
    return this.manager.add({
      type: ENTRY_TYPES.LEARNING,
      title,
      content,
      ...options
    });
  }

  /**
   * Add an error with solution
   */
  addErrorSolution(errorTitle, errorContent, solutionContent, options = {}) {
    return this.manager.add({
      type: ENTRY_TYPES.SOLUTION,
      title: `Fix: ${errorTitle}`,
      content: `## Error\n${errorContent}\n\n## Solution\n${solutionContent}`,
      tags: [...(options.tags || []), 'bugfix'],
      ...options
    });
  }

  /**
   * Add a code pattern
   */
  addPattern(title, content, options = {}) {
    return this.manager.add({
      type: ENTRY_TYPES.PATTERN,
      title,
      content,
      ...options
    });
  }

  /**
   * Add context/note
   */
  addContext(title, content, options = {}) {
    return this.manager.add({
      type: ENTRY_TYPES.CONTEXT,
      title,
      content,
      ...options
    });
  }

  // ========== Search Methods ==========

  /**
   * Search all memories
   */
  find(query, options = {}) {
    return this.search.search(query, options);
  }

  /**
   * Get recent entries
   */
  recent(limit = 10) {
    return this.manager.getCombinedContext(limit);
  }

  /**
   * Get entries for specific files
   */
  forFiles(files) {
    return this.search.getContextForFiles(files);
  }

  // ========== Conversation Tracking ==========

  /**
   * Start tracking a conversation
   */
  startConversation(title) {
    return this.tracker.startSession(title);
  }

  /**
   * Log an exchange in the current conversation
   */
  log(role, content) {
    return this.tracker.logExchange(role, content);
  }

  /**
   * End and summarize current conversation
   */
  endConversation(options = {}) {
    return this.tracker.endSession(options);
  }

  // ========== Utility Methods ==========

  /**
   * Get memory statistics
   */
  stats() {
    return this.manager.stats();
  }

  /**
   * Export all memories
   */
  export(format = 'json') {
    return this.manager.export();
  }

  /**
   * Extract insights from text
   */
  extract(text) {
    return this.extractor.extractAll(text);
  }

  /**
   * Generate CLAUDE.md section with relevant context
   */
  generateClaudeMdSection(limit = 10) {
    const recent = this.manager.getCombinedContext(limit);

    if (recent.length === 0) {
      return '## Memory Context\n\nNo memory entries yet.';
    }

    let md = '## Memory Context\n\n';
    md += '*Auto-generated from claude-memory*\n\n';

    // Group by type
    const byType = {};
    for (const entry of recent) {
      if (!byType[entry.type]) {
        byType[entry.type] = [];
      }
      byType[entry.type].push(entry);
    }

    // Render each type
    for (const [type, entries] of Object.entries(byType)) {
      md += `### ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;
      for (const entry of entries.slice(0, 3)) {
        md += `- **${entry.title}**: ${entry.content.slice(0, 100)}${entry.content.length > 100 ? '...' : ''}\n`;
      }
      md += '\n';
    }

    return md;
  }
}

// Export everything
module.exports = {
  ClaudeMemory,
  MemoryManager,
  SearchEngine,
  ConversationTracker,
  Extractor,
  SyncManager,
  LangfuseClient,
  ENTRY_TYPES,
  SCOPES
};

// Also export a default instance factory
module.exports.create = (projectPath) => new ClaudeMemory(projectPath);
