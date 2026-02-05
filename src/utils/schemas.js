/**
 * Memory entry types
 */
const ENTRY_TYPES = {
  DECISION: 'decision',
  LEARNING: 'learning',
  ERROR: 'error',
  SOLUTION: 'solution',
  PATTERN: 'pattern',
  CONTEXT: 'context',
  CONVERSATION: 'conversation'
};

/**
 * Memory scopes
 */
const SCOPES = {
  GLOBAL: 'global',
  PROJECT: 'project'
};

/**
 * Create a new memory entry
 */
function createEntry({
  type,
  title,
  content,
  tags = [],
  relatedFiles = [],
  source = 'manual',
  scope = SCOPES.PROJECT,
  metadata = {}
}) {
  const { generateId } = require('./storage');

  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type,
    title,
    content,
    tags,
    relatedFiles,
    searchTerms: extractSearchTerms(title, content, tags),
    source,
    scope,
    metadata
  };
}

/**
 * Create a conversation summary entry
 */
function createConversationSummary({
  title,
  summary,
  decisions = [],
  learnings = [],
  filesDiscussed = [],
  keyTopics = [],
  exchangeCount = 0
}) {
  const { generateId } = require('./storage');

  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type: ENTRY_TYPES.CONVERSATION,
    title,
    summary,
    decisions,
    learnings,
    filesDiscussed,
    keyTopics,
    exchangeCount
  };
}

/**
 * Extract search terms from title, content, and tags
 */
function extractSearchTerms(title, content, tags) {
  const allText = `${title} ${content} ${tags.join(' ')}`.toLowerCase();

  // Remove common words and punctuation
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
  ]);

  const words = allText
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Return unique terms
  return [...new Set(words)];
}

/**
 * Validate an entry has required fields
 */
function validateEntry(entry) {
  const errors = [];

  if (!entry.type || !Object.values(ENTRY_TYPES).includes(entry.type)) {
    errors.push(`Invalid type: ${entry.type}. Must be one of: ${Object.values(ENTRY_TYPES).join(', ')}`);
  }

  if (!entry.title || entry.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (!entry.content || entry.content.trim().length === 0) {
    errors.push('Content is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  ENTRY_TYPES,
  SCOPES,
  createEntry,
  createConversationSummary,
  extractSearchTerms,
  validateEntry
};
