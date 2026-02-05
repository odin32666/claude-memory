const path = require('path');
const MemoryManager = require('./memory-manager');
const Extractor = require('./extractor');
const { SCOPES, ENTRY_TYPES, createConversationSummary } = require('./utils/schemas');
const { writeJsonAtomic, readJson, generateId, getProjectMemoryDir, GLOBAL_DIR } = require('./utils/storage');

/**
 * Track and summarize conversations
 */
class ConversationTracker {
  constructor(projectPath = null) {
    this.manager = new MemoryManager(projectPath);
    this.extractor = new Extractor();
    this.currentSession = null;
    this.exchanges = [];
  }

  /**
   * Start a new conversation session
   */
  startSession(title = null) {
    this.manager.init();

    this.currentSession = {
      id: generateId(),
      startTime: new Date().toISOString(),
      title: title || `Session ${new Date().toLocaleDateString()}`,
      exchanges: []
    };
    this.exchanges = [];

    return this.currentSession.id;
  }

  /**
   * Log a conversation exchange
   */
  logExchange(role, content) {
    if (!this.currentSession) {
      this.startSession();
    }

    const exchange = {
      timestamp: new Date().toISOString(),
      role, // 'human' or 'assistant'
      content
    };

    this.exchanges.push(exchange);

    return exchange;
  }

  /**
   * End session and generate summary
   */
  endSession(options = {}) {
    if (!this.currentSession || this.exchanges.length === 0) {
      return null;
    }

    const {
      autoExtract = true,
      scope = SCOPES.PROJECT
    } = options;

    // Generate summary
    const summary = this.extractor.summarizeConversation(this.exchanges);

    // Create conversation summary entry
    const conversationEntry = createConversationSummary({
      title: this.currentSession.title,
      summary: summary.summary,
      decisions: summary.decisions,
      learnings: summary.learnings,
      filesDiscussed: summary.filesDiscussed,
      keyTopics: summary.keyTopics,
      exchangeCount: summary.exchangeCount
    });

    // Save the conversation summary
    const conversationsDir = path.join(
      scope === SCOPES.GLOBAL ? GLOBAL_DIR : getProjectMemoryDir(this.manager.projectPath),
      'conversations'
    );
    const conversationPath = path.join(conversationsDir, `${this.currentSession.id}.json`);

    writeJsonAtomic(conversationPath, {
      ...conversationEntry,
      exchanges: this.exchanges
    });

    // Auto-extract and save insights if enabled
    if (autoExtract) {
      this._saveExtractedInsights(summary, scope);
    }

    // Reset session
    const sessionSummary = {
      sessionId: this.currentSession.id,
      duration: Date.now() - new Date(this.currentSession.startTime).getTime(),
      exchangeCount: this.exchanges.length,
      insightsExtracted: summary.insightCount,
      ...summary
    };

    this.currentSession = null;
    this.exchanges = [];

    return sessionSummary;
  }

  /**
   * Save extracted insights as memory entries
   */
  _saveExtractedInsights(summary, scope) {
    // Save decisions
    for (const decision of summary.decisions.slice(0, 3)) { // Limit to top 3
      this.manager.add({
        type: ENTRY_TYPES.DECISION,
        title: this.extractor.generateTitle(decision, 'decision'),
        content: decision,
        tags: summary.keyTopics,
        relatedFiles: summary.filesDiscussed,
        source: 'auto-extracted',
        scope
      });
    }

    // Save learnings
    for (const learning of summary.learnings.slice(0, 3)) {
      this.manager.add({
        type: ENTRY_TYPES.LEARNING,
        title: this.extractor.generateTitle(learning, 'learning'),
        content: learning,
        tags: summary.keyTopics,
        relatedFiles: summary.filesDiscussed,
        source: 'auto-extracted',
        scope
      });
    }

    // Save error-solution pairs
    if (summary.errors.length > 0 && summary.solutions.length > 0) {
      const errorSolution = {
        error: summary.errors[0],
        solution: summary.solutions[0]
      };

      this.manager.add({
        type: ENTRY_TYPES.SOLUTION,
        title: `Fix: ${this.extractor.generateTitle(errorSolution.error, 'error')}`,
        content: `Error: ${errorSolution.error}\n\nSolution: ${errorSolution.solution}`,
        tags: [...summary.keyTopics, 'bugfix'],
        relatedFiles: summary.filesDiscussed,
        source: 'auto-extracted',
        scope
      });
    }
  }

  /**
   * Get all conversation summaries
   */
  getConversations(scope = SCOPES.PROJECT, limit = 20) {
    this.manager.init();

    const conversationsDir = path.join(
      scope === SCOPES.GLOBAL ? GLOBAL_DIR : getProjectMemoryDir(this.manager.projectPath),
      'conversations'
    );

    try {
      const fs = require('fs');
      if (!fs.existsSync(conversationsDir)) {
        return [];
      }

      const files = fs.readdirSync(conversationsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      return files.map(f => {
        const data = readJson(path.join(conversationsDir, f));
        // Return summary without full exchanges
        const { exchanges, ...summary } = data;
        return { ...summary, exchangeCount: exchanges?.length || 0 };
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Get a specific conversation with full exchanges
   */
  getConversation(sessionId, scope = SCOPES.PROJECT) {
    this.manager.init();

    const conversationsDir = path.join(
      scope === SCOPES.GLOBAL ? GLOBAL_DIR : getProjectMemoryDir(this.manager.projectPath),
      'conversations'
    );

    const conversationPath = path.join(conversationsDir, `${sessionId}.json`);
    return readJson(conversationPath);
  }

  /**
   * Manually add an insight from the current session context
   */
  addInsight(type, title, content, options = {}) {
    const {
      tags = [],
      files = [],
      scope = SCOPES.PROJECT
    } = options;

    // Auto-enhance with session context
    const sessionTags = this.currentSession ?
      this.extractor.extractTags(this.exchanges.map(e => e.content).join(' ')) : [];

    const sessionFiles = this.currentSession ?
      this.extractor.extractFileReferences(this.exchanges.map(e => e.content).join(' ')) : [];

    return this.manager.add({
      type,
      title,
      content,
      tags: [...new Set([...tags, ...sessionTags])],
      relatedFiles: [...new Set([...files, ...sessionFiles])],
      source: 'manual',
      scope,
      metadata: {
        sessionId: this.currentSession?.id
      }
    });
  }
}

module.exports = ConversationTracker;
