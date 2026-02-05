const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const {
  MEMORY_DIR,
  GLOBAL_DIR,
  PROJECTS_DIR,
  readJson,
  writeJsonAtomic,
  ensureDir,
  initializeMemoryStructure
} = require('./utils/storage');

/**
 * Sync manager for desktop/mobile memory synchronization
 * Supports multiple backends: GitHub Gist, REST API, Local File Server
 */
class SyncManager {
  constructor(config = {}) {
    this.config = {
      backend: config.backend || 'gist', // 'gist', 'api', 'file'
      apiUrl: config.apiUrl || null,
      gistId: config.gistId || null,
      gistToken: config.gistToken || process.env.GITHUB_TOKEN,
      syncFile: config.syncFile || path.join(MEMORY_DIR, 'sync-state.json'),
      ...config
    };

    this.syncState = this._loadSyncState();
  }

  /**
   * Load sync state from local file
   */
  _loadSyncState() {
    const state = readJson(this.config.syncFile);
    return state || {
      lastSync: null,
      lastPush: null,
      lastPull: null,
      remoteVersion: null,
      localVersion: null,
      deviceId: this._generateDeviceId(),
      devices: []
    };
  }

  /**
   * Save sync state
   */
  _saveSyncState() {
    ensureDir(path.dirname(this.config.syncFile));
    writeJsonAtomic(this.config.syncFile, this.syncState);
  }

  /**
   * Generate unique device ID
   */
  _generateDeviceId() {
    const os = require('os');
    const crypto = require('crypto');
    const info = `${os.hostname()}-${os.platform()}-${os.userInfo().username}`;
    return crypto.createHash('md5').update(info).digest('hex').slice(0, 8);
  }

  /**
   * Get all local memory data for sync
   */
  _getLocalMemoryData() {
    initializeMemoryStructure();

    const data = {
      version: Date.now(),
      deviceId: this.syncState.deviceId,
      timestamp: new Date().toISOString(),
      global: this._readDirectoryData(GLOBAL_DIR),
      projects: {}
    };

    // Read all project data
    if (fs.existsSync(PROJECTS_DIR)) {
      const projectDirs = fs.readdirSync(PROJECTS_DIR);
      for (const dir of projectDirs) {
        const projectPath = path.join(PROJECTS_DIR, dir);
        if (fs.statSync(projectPath).isDirectory()) {
          data.projects[dir] = this._readDirectoryData(projectPath);
        }
      }
    }

    return data;
  }

  /**
   * Read all JSON files from a directory
   */
  _readDirectoryData(dirPath) {
    const data = {};

    if (!fs.existsSync(dirPath)) {
      return data;
    }

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && file.endsWith('.json')) {
        data[file] = readJson(filePath);
      } else if (stat.isDirectory() && file === 'conversations') {
        data.conversations = {};
        const convFiles = fs.readdirSync(filePath);
        for (const convFile of convFiles) {
          if (convFile.endsWith('.json')) {
            data.conversations[convFile] = readJson(path.join(filePath, convFile));
          }
        }
      }
    }

    return data;
  }

  /**
   * Write memory data to local directories
   */
  _writeLocalMemoryData(data) {
    initializeMemoryStructure();

    // Write global data
    if (data.global) {
      this._writeDirectoryData(GLOBAL_DIR, data.global);
    }

    // Write project data
    if (data.projects) {
      for (const [projectHash, projectData] of Object.entries(data.projects)) {
        const projectPath = path.join(PROJECTS_DIR, projectHash);
        ensureDir(projectPath);
        this._writeDirectoryData(projectPath, projectData);
      }
    }
  }

  /**
   * Write data to a directory
   */
  _writeDirectoryData(dirPath, data) {
    ensureDir(dirPath);

    for (const [key, value] of Object.entries(data)) {
      if (key === 'conversations' && typeof value === 'object') {
        const convDir = path.join(dirPath, 'conversations');
        ensureDir(convDir);
        for (const [convFile, convData] of Object.entries(value)) {
          writeJsonAtomic(path.join(convDir, convFile), convData);
        }
      } else if (key.endsWith('.json')) {
        writeJsonAtomic(path.join(dirPath, key), value);
      }
    }
  }

  /**
   * Merge remote data with local data
   */
  _mergeData(local, remote) {
    const merged = {
      version: Date.now(),
      deviceId: this.syncState.deviceId,
      timestamp: new Date().toISOString(),
      global: this._mergeEntries(local.global || {}, remote.global || {}),
      projects: {}
    };

    // Merge projects
    const allProjects = new Set([
      ...Object.keys(local.projects || {}),
      ...Object.keys(remote.projects || {})
    ]);

    for (const projectHash of allProjects) {
      merged.projects[projectHash] = this._mergeEntries(
        (local.projects || {})[projectHash] || {},
        (remote.projects || {})[projectHash] || {}
      );
    }

    return merged;
  }

  /**
   * Merge entries from two sources
   */
  _mergeEntries(local, remote) {
    const merged = { ...local };

    for (const [key, value] of Object.entries(remote)) {
      if (key === 'conversations') {
        merged.conversations = { ...(local.conversations || {}), ...value };
      } else if (Array.isArray(value)) {
        // Merge arrays by ID, preferring newer entries
        const localArr = local[key] || [];
        const localById = new Map(localArr.map(e => [e.id, e]));

        for (const item of value) {
          if (!item.id) continue;

          const existing = localById.get(item.id);
          if (!existing) {
            localById.set(item.id, item);
          } else if (item.timestamp > existing.timestamp) {
            localById.set(item.id, item);
          }
        }

        merged[key] = Array.from(localById.values());
      } else if (typeof value === 'object' && value !== null) {
        // Deep merge objects
        merged[key] = this._mergeEntries(local[key] || {}, value);
      } else if (local[key] === undefined) {
        merged[key] = value;
      }
    }

    return merged;
  }

  // ========== Push Methods ==========

  /**
   * Push local memory to remote
   */
  async push() {
    const localData = this._getLocalMemoryData();

    switch (this.config.backend) {
      case 'gist':
        return this._pushToGist(localData);
      case 'api':
        return this._pushToApi(localData);
      case 'file':
        return this._pushToFile(localData);
      default:
        throw new Error(`Unknown backend: ${this.config.backend}`);
    }
  }

  /**
   * Push to GitHub Gist
   */
  async _pushToGist(data) {
    if (!this.config.gistToken) {
      throw new Error('GITHUB_TOKEN not set. Run: export GITHUB_TOKEN=your_token');
    }

    const gistData = {
      description: 'Claude Memory Sync',
      public: false,
      files: {
        'claude-memory.json': {
          content: JSON.stringify(data, null, 2)
        }
      }
    };

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: this.config.gistId ? `/gists/${this.config.gistId}` : '/gists',
        method: this.config.gistId ? 'PATCH' : 'POST',
        headers: {
          'User-Agent': 'claude-memory-sync',
          'Authorization': `token ${this.config.gistToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              // Save gist ID for future syncs
              this.config.gistId = result.id;
              this.syncState.lastPush = new Date().toISOString();
              this.syncState.remoteVersion = data.version;
              this._saveSyncState();
              this._saveConfig();

              resolve({
                success: true,
                gistId: result.id,
                url: result.html_url,
                message: 'Memory pushed to GitHub Gist'
              });
            } else {
              reject(new Error(`GitHub API error: ${result.message || body}`));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(gistData));
      req.end();
    });
  }

  /**
   * Push to REST API
   */
  async _pushToApi(data) {
    if (!this.config.apiUrl) {
      throw new Error('API URL not configured');
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.config.apiUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = protocol.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.syncState.lastPush = new Date().toISOString();
            this._saveSyncState();
            resolve({ success: true, message: 'Memory pushed to API' });
          } else {
            reject(new Error(`API error: ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(data));
      req.end();
    });
  }

  /**
   * Push to local file (for testing or local network sync)
   */
  async _pushToFile(data) {
    const syncFilePath = this.config.syncFilePath || path.join(MEMORY_DIR, 'remote-sync.json');
    writeJsonAtomic(syncFilePath, data);

    this.syncState.lastPush = new Date().toISOString();
    this._saveSyncState();

    return {
      success: true,
      path: syncFilePath,
      message: 'Memory saved to sync file'
    };
  }

  // ========== Pull Methods ==========

  /**
   * Pull remote memory to local
   */
  async pull(merge = true) {
    let remoteData;

    switch (this.config.backend) {
      case 'gist':
        remoteData = await this._pullFromGist();
        break;
      case 'api':
        remoteData = await this._pullFromApi();
        break;
      case 'file':
        remoteData = await this._pullFromFile();
        break;
      default:
        throw new Error(`Unknown backend: ${this.config.backend}`);
    }

    if (merge) {
      const localData = this._getLocalMemoryData();
      const mergedData = this._mergeData(localData, remoteData);
      this._writeLocalMemoryData(mergedData);

      this.syncState.lastPull = new Date().toISOString();
      this.syncState.lastSync = new Date().toISOString();
      this._saveSyncState();

      return {
        success: true,
        merged: true,
        message: 'Memory pulled and merged'
      };
    } else {
      this._writeLocalMemoryData(remoteData);

      this.syncState.lastPull = new Date().toISOString();
      this.syncState.lastSync = new Date().toISOString();
      this._saveSyncState();

      return {
        success: true,
        merged: false,
        message: 'Memory pulled (replaced local)'
      };
    }
  }

  /**
   * Pull from GitHub Gist
   */
  async _pullFromGist() {
    if (!this.config.gistId) {
      throw new Error('No gist ID configured. Run push first or set gistId in config.');
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/gists/${this.config.gistId}`,
        method: 'GET',
        headers: {
          'User-Agent': 'claude-memory-sync',
          'Authorization': this.config.gistToken ? `token ${this.config.gistToken}` : undefined,
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      // Remove undefined headers
      if (!options.headers.Authorization) {
        delete options.headers.Authorization;
      }

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const gist = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const memoryFile = gist.files['claude-memory.json'];
              if (!memoryFile) {
                reject(new Error('No claude-memory.json in gist'));
                return;
              }
              const data = JSON.parse(memoryFile.content);
              resolve(data);
            } else {
              reject(new Error(`GitHub API error: ${gist.message || body}`));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Pull from REST API
   */
  async _pullFromApi() {
    if (!this.config.apiUrl) {
      throw new Error('API URL not configured');
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.config.apiUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET'
      };

      const req = protocol.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Parse error: ${e.message}`));
            }
          } else {
            reject(new Error(`API error: ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Pull from local file
   */
  async _pullFromFile() {
    const syncFilePath = this.config.syncFilePath || path.join(MEMORY_DIR, 'remote-sync.json');
    const data = readJson(syncFilePath);
    if (!data) {
      throw new Error(`Sync file not found: ${syncFilePath}`);
    }
    return data;
  }

  // ========== Utility Methods ==========

  /**
   * Full sync (pull, merge, push)
   */
  async sync() {
    try {
      // Pull and merge first
      await this.pull(true);

      // Then push the merged result
      const result = await this.push();

      this.syncState.lastSync = new Date().toISOString();
      this._saveSyncState();

      return {
        success: true,
        ...result,
        message: 'Full sync complete'
      };
    } catch (error) {
      // If pull fails (no remote yet), just push
      if (error.message.includes('No gist ID') || error.message.includes('not found')) {
        return this.push();
      }
      throw error;
    }
  }

  /**
   * Get sync status
   */
  status() {
    return {
      backend: this.config.backend,
      gistId: this.config.gistId,
      deviceId: this.syncState.deviceId,
      lastSync: this.syncState.lastSync,
      lastPush: this.syncState.lastPush,
      lastPull: this.syncState.lastPull,
      configured: this._isConfigured()
    };
  }

  /**
   * Check if sync is configured
   */
  _isConfigured() {
    switch (this.config.backend) {
      case 'gist':
        return !!this.config.gistToken;
      case 'api':
        return !!this.config.apiUrl;
      case 'file':
        return true;
      default:
        return false;
    }
  }

  /**
   * Save sync config
   */
  _saveConfig() {
    const configPath = path.join(MEMORY_DIR, 'sync-config.json');
    writeJsonAtomic(configPath, {
      backend: this.config.backend,
      gistId: this.config.gistId,
      apiUrl: this.config.apiUrl
    });
  }

  /**
   * Load sync config
   */
  static loadConfig() {
    const configPath = path.join(MEMORY_DIR, 'sync-config.json');
    return readJson(configPath) || {};
  }
}

module.exports = SyncManager;
