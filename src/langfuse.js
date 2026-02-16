const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { CLAUDE_HOME, readJson, writeJsonAtomic, ensureDir } = require('./utils/storage');

const LANGFUSE_CONFIG_PATH = path.join(CLAUDE_HOME, 'langfuse.json');

class LangfuseClient {
  constructor() {
    this.config = this._loadConfig();
  }

  /**
   * Load Langfuse configuration
   */
  _loadConfig() {
    return readJson(LANGFUSE_CONFIG_PATH) || {
      enabled: false,
      publicKey: null,
      secretKey: null,
      baseUrl: 'https://cloud.langfuse.com'
    };
  }

  /**
   * Save Langfuse configuration
   */
  _saveConfig() {
    ensureDir(CLAUDE_HOME);
    writeJsonAtomic(LANGFUSE_CONFIG_PATH, this.config);
  }

  /**
   * Initialize Langfuse with API keys
   */
  init(publicKey, secretKey, baseUrl = 'https://cloud.langfuse.com') {
    this.config = {
      enabled: true,
      publicKey,
      secretKey,
      baseUrl
    };
    this._saveConfig();
    return { success: true };
  }

  /**
   * Check if Langfuse is configured and enabled
   */
  isEnabled() {
    return !!(this.config.enabled && this.config.publicKey && this.config.secretKey);
  }

  /**
   * Get Basic auth header value
   */
  _getAuth() {
    return Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString('base64');
  }

  /**
   * Make an HTTPS request to Langfuse API
   */
  _request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.config.baseUrl);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Basic ${this._getAuth()}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Send a batch of events to Langfuse ingestion API
   */
  async _ingest(events) {
    if (!this.isEnabled()) return null;
    return this._request('POST', '/api/public/ingestion', { batch: events });
  }

  /**
   * Create a trace (top-level operation)
   */
  async createTrace({ name, metadata = {}, tags = [], input = null, output = null }) {
    const traceId = crypto.randomUUID();
    const result = await this._ingest([{
      id: crypto.randomUUID(),
      type: 'trace-create',
      timestamp: new Date().toISOString(),
      body: {
        id: traceId,
        name,
        metadata,
        tags,
        input,
        output
      }
    }]);
    return { traceId, result };
  }

  /**
   * Add a score to a trace
   */
  async createScore({ traceId, name, value, comment = '', dataType = 'NUMERIC' }) {
    return this._ingest([{
      id: crypto.randomUUID(),
      type: 'score-create',
      timestamp: new Date().toISOString(),
      body: {
        traceId,
        name,
        value,
        comment,
        dataType
      }
    }]);
  }

  /**
   * Add a generation/span to a trace
   */
  async createGeneration({ traceId, name, input = null, output = null, metadata = {} }) {
    const generationId = crypto.randomUUID();
    await this._ingest([{
      id: crypto.randomUUID(),
      type: 'generation-create',
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId,
        name,
        input,
        output,
        metadata
      }
    }]);
    return generationId;
  }

  /**
   * Track a memory operation (add, search, sync, etc.)
   * Fire-and-forget - errors are silently ignored.
   */
  trackOperation(name, details = {}) {
    if (!this.isEnabled()) return;

    this.createTrace({
      name: `cmem.${name}`,
      metadata: details,
      tags: ['claude-memory', name]
    }).catch(() => {});
  }

  /**
   * Submit a feedback report (like the sweep results)
   */
  async submitFeedback({ name, scores = {}, details = '' }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Langfuse not configured. Run: cmem langfuse init' };
    }

    const { traceId } = await this.createTrace({
      name,
      metadata: { details },
      tags: ['claude-memory', 'feedback'],
      input: { report: name },
      output: { details, scores }
    });

    // Attach individual scores
    for (const [scoreName, scoreValue] of Object.entries(scores)) {
      const value = typeof scoreValue === 'object' ? scoreValue.value : scoreValue;
      const comment = typeof scoreValue === 'object' ? scoreValue.comment : '';
      await this.createScore({
        traceId,
        name: scoreName,
        value,
        comment
      });
    }

    return { success: true, traceId };
  }

  /**
   * Get Langfuse status
   */
  status() {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        message: 'Langfuse not configured. Run: cmem langfuse init <public-key> <secret-key>'
      };
    }

    return {
      enabled: true,
      baseUrl: this.config.baseUrl,
      publicKey: this.config.publicKey.slice(0, 12) + '...'
    };
  }

  /**
   * Test the connection to Langfuse
   */
  async testConnection() {
    if (!this.isEnabled()) {
      return { success: false, error: 'Not configured' };
    }

    try {
      const result = await this._request('GET', '/api/public/health');
      return {
        success: result.status === 200,
        status: result.status,
        data: result.data
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = LangfuseClient;
