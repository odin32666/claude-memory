const MemoryManager = require('./memory-manager');
const { SCOPES } = require('./utils/schemas');

class SearchEngine {
  constructor(projectPath = null) {
    this.manager = new MemoryManager(projectPath);
  }

  /**
   * Full-text search across all entries
   */
  search(query, options = {}) {
    const {
      scope = 'both', // 'project', 'global', or 'both'
      types = null,   // array of types to filter, or null for all
      tags = null,    // array of tags to filter, or null for all
      limit = 50,
      sortBy = 'relevance' // 'relevance' or 'date'
    } = options;

    this.manager.init();

    // Get entries based on scope
    let entries = [];
    if (scope === 'both' || scope === 'project') {
      entries = [...entries, ...this.manager.getAll(SCOPES.PROJECT).map(e => ({ ...e, _scope: 'project' }))];
    }
    if (scope === 'both' || scope === 'global') {
      entries = [...entries, ...this.manager.getAll(SCOPES.GLOBAL).map(e => ({ ...e, _scope: 'global' }))];
    }

    // Filter by types if specified
    if (types && types.length > 0) {
      entries = entries.filter(e => types.includes(e.type));
    }

    // Filter by tags if specified
    if (tags && tags.length > 0) {
      entries = entries.filter(e => e.tags.some(t => tags.includes(t)));
    }

    // Score and rank entries
    const queryTerms = this._tokenize(query);
    const scored = entries.map(entry => ({
      ...entry,
      _score: this._calculateScore(entry, queryTerms)
    })).filter(e => e._score > 0);

    // Sort
    if (sortBy === 'relevance') {
      scored.sort((a, b) => b._score - a._score);
    } else {
      scored.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    return scored.slice(0, limit);
  }

  /**
   * Tokenize a query string
   */
  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1);
  }

  /**
   * Calculate relevance score for an entry
   */
  _calculateScore(entry, queryTerms) {
    let score = 0;

    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const tagsLower = entry.tags.map(t => t.toLowerCase());
    const searchTerms = entry.searchTerms || [];

    for (const term of queryTerms) {
      // Exact title match (highest weight)
      if (titleLower.includes(term)) {
        score += 10;
        // Bonus for word boundary match
        if (new RegExp(`\\b${term}\\b`).test(titleLower)) {
          score += 5;
        }
      }

      // Tag match (high weight)
      if (tagsLower.some(t => t.includes(term))) {
        score += 8;
      }

      // Content match (medium weight)
      if (contentLower.includes(term)) {
        score += 3;
        // Count occurrences (up to 5)
        const matches = contentLower.split(term).length - 1;
        score += Math.min(matches, 5);
      }

      // Search terms match (medium weight)
      if (searchTerms.includes(term)) {
        score += 4;
      }

      // Related files match
      if (entry.relatedFiles.some(f => f.toLowerCase().includes(term))) {
        score += 5;
      }
    }

    // Recency bonus (entries from last 7 days get a boost)
    const age = Date.now() - new Date(entry.timestamp).getTime();
    const daysOld = age / (1000 * 60 * 60 * 24);
    if (daysOld < 7) {
      score += (7 - daysOld) * 0.5;
    }

    return score;
  }

  /**
   * Find similar entries based on content
   */
  findSimilar(entryId, limit = 5) {
    this.manager.init();

    const entry = this.manager.getById(entryId, SCOPES.PROJECT) ||
                  this.manager.getById(entryId, SCOPES.GLOBAL);

    if (!entry) {
      return [];
    }

    // Use the entry's search terms and tags as the query
    const queryTerms = [...(entry.searchTerms || []), ...entry.tags];

    const allEntries = [
      ...this.manager.getAll(SCOPES.PROJECT),
      ...this.manager.getAll(SCOPES.GLOBAL)
    ].filter(e => e.id !== entryId);

    const scored = allEntries.map(e => ({
      ...e,
      _score: this._calculateSimilarity(e, queryTerms, entry.type)
    }));

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  /**
   * Calculate similarity between entries
   */
  _calculateSimilarity(entry, queryTerms, sourceType) {
    let score = 0;

    const entryTerms = new Set([...(entry.searchTerms || []), ...entry.tags]);

    for (const term of queryTerms) {
      if (entryTerms.has(term)) {
        score += 2;
      }
    }

    // Bonus for same type
    if (entry.type === sourceType) {
      score += 3;
    }

    return score;
  }

  /**
   * Get context-relevant entries for current work
   */
  getContextForFiles(files, limit = 10) {
    this.manager.init();

    const allEntries = [
      ...this.manager.getAll(SCOPES.PROJECT).map(e => ({ ...e, _scope: 'project' })),
      ...this.manager.getAll(SCOPES.GLOBAL).map(e => ({ ...e, _scope: 'global' }))
    ];

    // Score entries by relevance to the files
    const scored = allEntries.map(entry => {
      let score = 0;

      for (const file of files) {
        const fileName = file.split(/[/\\]/).pop();
        const fileDir = file.split(/[/\\]/).slice(-2, -1)[0] || '';

        // Direct file match
        if (entry.relatedFiles.some(f => f.includes(fileName))) {
          score += 10;
        }

        // Directory match
        if (entry.relatedFiles.some(f => f.includes(fileDir))) {
          score += 3;
        }

        // Content mentions file
        if (entry.content.includes(fileName)) {
          score += 2;
        }
      }

      return { ...entry, _score: score };
    }).filter(e => e._score > 0);

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  /**
   * Suggest tags based on content
   */
  suggestTags(content, existingTags = []) {
    this.manager.init();

    const allEntries = [
      ...this.manager.getAll(SCOPES.PROJECT),
      ...this.manager.getAll(SCOPES.GLOBAL)
    ];

    // Get all used tags and their frequencies
    const tagCounts = {};
    for (const entry of allEntries) {
      for (const tag of entry.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Tokenize the content
    const contentTerms = new Set(this._tokenize(content));

    // Score tags by relevance to content
    const suggestions = Object.entries(tagCounts)
      .filter(([tag]) => !existingTags.includes(tag))
      .map(([tag, count]) => {
        let score = 0;

        // Tag appears in content
        if (contentTerms.has(tag.toLowerCase())) {
          score += 10;
        }

        // Tag is commonly used
        score += Math.min(count, 5);

        return { tag, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ tag }) => tag);

    return suggestions;
  }
}

module.exports = SearchEngine;
