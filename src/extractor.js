const { ENTRY_TYPES } = require('./utils/schemas');

/**
 * Pattern-based extraction of insights from conversation text
 */
class Extractor {
  constructor() {
    // Patterns for detecting different types of content
    this.patterns = {
      decision: [
        /(?:we|i)\s+(?:decided|chose|went with|picked|selected)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
        /(?:the\s+)?decision\s+(?:is|was)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
        /(?:let's|we'll|we're going to)\s+(?:go with|use|implement)\s+(.+?)(?:\.|$)/gi,
        /(?:the\s+)?approach\s+(?:is|was|will be)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
        /(?:we're|i'm)\s+going\s+(?:to|with)\s+(.+?)(?:\.|$)/gi
      ],
      learning: [
        /(?:i|we)\s+(?:learned|discovered|found out|realized)\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
        /(?:turns out|it turns out)\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
        /(?:til|today i learned|TIL)[:\s]+(.+?)(?:\.|$)/gi,
        /(?:the\s+)?(?:key\s+)?(?:insight|takeaway|lesson)\s+(?:is|was)\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
        /(?:interestingly|surprisingly),?\s+(.+?)(?:\.|$)/gi
      ],
      error: [
        /(?:the\s+)?error\s+(?:is|was)[:\s]+(.+?)(?:\.|$)/gi,
        /(?:got|getting|received|seeing)\s+(?:an?\s+)?error[:\s]+(.+?)(?:\.|$)/gi,
        /(?:failed|failing)\s+(?:with|because|due to)[:\s]+(.+?)(?:\.|$)/gi,
        /(?:the\s+)?(?:issue|problem|bug)\s+(?:is|was)[:\s]+(.+?)(?:\.|$)/gi,
        /(?:doesn't|does not|won't|will not|can't|cannot)\s+(?:work|compile|run|build)(.+?)(?:\.|$)/gi
      ],
      solution: [
        /(?:the\s+)?(?:fix|solution)\s+(?:is|was)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
        /(?:fixed|solved|resolved)\s+(?:by|with|using)\s+(.+?)(?:\.|$)/gi,
        /(?:to\s+fix|to\s+solve)\s+(?:this|it),?\s+(.+?)(?:\.|$)/gi,
        /(?:the\s+)?(?:workaround|fix)\s+(?:is|was)\s+(.+?)(?:\.|$)/gi,
        /(?:this|that)\s+(?:fixed|solved|resolved)\s+(?:the\s+)?(?:issue|problem|bug)/gi
      ],
      pattern: [
        /(?:the\s+)?pattern\s+(?:is|was|here is)\s+(.+?)(?:\.|$)/gi,
        /(?:always|usually|typically)\s+(.+?)(?:\.|$)/gi,
        /(?:best practice|common pattern)[:\s]+(.+?)(?:\.|$)/gi,
        /(?:the\s+)?(?:convention|standard)\s+(?:is|was)\s+(?:to\s+)?(.+?)(?:\.|$)/gi
      ]
    };
  }

  /**
   * Extract all insights from a text
   */
  extractAll(text) {
    const results = [];

    for (const [type, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
          const content = match[1]?.trim();
          if (content && content.length > 10 && content.length < 500) {
            results.push({
              type,
              content,
              matchedPattern: pattern.source,
              confidence: this._calculateConfidence(content, type)
            });
          }
        }
      }
    }

    // Deduplicate similar extractions
    return this._deduplicateResults(results);
  }

  /**
   * Extract insights of a specific type
   */
  extractByType(text, type) {
    if (!this.patterns[type]) {
      return [];
    }

    const results = [];
    for (const pattern of this.patterns[type]) {
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(text)) !== null) {
        const content = match[1]?.trim();
        if (content && content.length > 10 && content.length < 500) {
          results.push({
            type,
            content,
            confidence: this._calculateConfidence(content, type)
          });
        }
      }
    }

    return this._deduplicateResults(results);
  }

  /**
   * Calculate confidence score for an extraction
   */
  _calculateConfidence(content, type) {
    let score = 0.5; // Base score

    // Longer, more detailed content = higher confidence
    if (content.length > 50) score += 0.1;
    if (content.length > 100) score += 0.1;

    // Contains specific technical terms
    const techTerms = /(?:api|function|class|module|import|export|async|await|promise|callback|component|hook|state|props|database|query|endpoint|route)/i;
    if (techTerms.test(content)) score += 0.15;

    // Contains file references
    const fileRef = /(?:\.\w{2,4}|\/[\w-]+\/)/;
    if (fileRef.test(content)) score += 0.1;

    // Type-specific boosts
    if (type === 'decision' && /because|since|due to|reason/i.test(content)) {
      score += 0.1; // Decisions with reasoning are more valuable
    }

    if (type === 'error' && /\d|error|exception|null|undefined/i.test(content)) {
      score += 0.1; // Errors with specific details
    }

    return Math.min(score, 1.0);
  }

  /**
   * Deduplicate similar results
   */
  _deduplicateResults(results) {
    const unique = [];

    for (const result of results) {
      const isDuplicate = unique.some(u =>
        this._similarity(u.content, result.content) > 0.7
      );

      if (!isDuplicate) {
        unique.push(result);
      } else {
        // If duplicate but higher confidence, replace
        const existing = unique.find(u =>
          this._similarity(u.content, result.content) > 0.7
        );
        if (existing && result.confidence > existing.confidence) {
          Object.assign(existing, result);
        }
      }
    }

    return unique.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate simple text similarity (Jaccard-like)
   */
  _similarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return intersection / union;
  }

  /**
   * Generate a title from extracted content
   */
  generateTitle(content, type) {
    // Take first meaningful chunk
    let title = content.split(/[.!?]/)[0].trim();

    // Truncate if too long
    if (title.length > 60) {
      title = title.slice(0, 57) + '...';
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return title;
  }

  /**
   * Extract file references from text
   */
  extractFileReferences(text) {
    const patterns = [
      /(?:in|from|at|file)\s+[`"']?([\w\-./]+\.\w{2,4})[`"']?/gi,
      /[`"']([\w\-./]+\.\w{2,4})[`"']/g,
      /(src\/[\w\-./]+)/g,
      /(lib\/[\w\-./]+)/g,
      /(components?\/[\w\-./]+)/g
    ];

    const files = new Set();

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const file = match[1];
        if (file && !file.includes('...') && file.length < 100) {
          files.add(file);
        }
      }
    }

    return [...files];
  }

  /**
   * Extract tags from text
   */
  extractTags(text) {
    const tagPatterns = {
      // Framework/library detection
      react: /\breact\b/i,
      vue: /\bvue\b/i,
      angular: /\bangular\b/i,
      node: /\bnode(?:js)?\b/i,
      typescript: /\btypescript\b|\bts\b/i,
      javascript: /\bjavascript\b|\bjs\b/i,
      python: /\bpython\b/i,
      rust: /\brust\b/i,
      go: /\bgolang\b|\bgo\b/i,

      // Concept detection
      api: /\bapi\b|\bendpoint\b|\brest\b|\bgraphql\b/i,
      database: /\bdatabase\b|\bdb\b|\bsql\b|\bmongo\b|\bpostgres\b/i,
      auth: /\bauth\b|\bauthentication\b|\bauthorization\b|\blogin\b/i,
      testing: /\btest\b|\btesting\b|\bjest\b|\bmocha\b/i,
      performance: /\bperformance\b|\boptimiz\b|\bfast\b|\bslow\b/i,
      security: /\bsecurity\b|\bvulnerability\b|\bxss\b|\binjection\b/i,
      ui: /\bui\b|\bux\b|\bdesign\b|\bstyle\b|\bcss\b/i,
      debugging: /\bdebug\b|\berror\b|\bbug\b|\bfix\b/i,
      architecture: /\barchitecture\b|\bpattern\b|\bdesign\b|\bstructure\b/i,
      deployment: /\bdeploy\b|\bci\b|\bcd\b|\bdocker\b|\bkubernetes\b/i
    };

    const tags = [];

    for (const [tag, pattern] of Object.entries(tagPatterns)) {
      if (pattern.test(text)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Summarize a conversation
   */
  summarizeConversation(exchanges) {
    // exchanges = [{role: 'human'|'assistant', content: string}]

    const allText = exchanges.map(e => e.content).join('\n');

    // Extract insights
    const insights = this.extractAll(allText);

    // Group by type
    const byType = {};
    for (const insight of insights) {
      if (!byType[insight.type]) {
        byType[insight.type] = [];
      }
      byType[insight.type].push(insight);
    }

    // Extract files discussed
    const files = this.extractFileReferences(allText);

    // Extract topics/tags
    const tags = this.extractTags(allText);

    // Generate summary (simple approach - take top insights)
    const topInsights = insights.slice(0, 5).map(i => i.content);

    return {
      summary: topInsights.join('. '),
      decisions: (byType.decision || []).map(d => d.content),
      learnings: (byType.learning || []).map(l => l.content),
      errors: (byType.error || []).map(e => e.content),
      solutions: (byType.solution || []).map(s => s.content),
      filesDiscussed: files,
      keyTopics: tags,
      exchangeCount: exchanges.length,
      insightCount: insights.length
    };
  }
}

module.exports = Extractor;
