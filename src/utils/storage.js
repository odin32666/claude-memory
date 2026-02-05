const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Base paths
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const MEMORY_DIR = path.join(CLAUDE_HOME, 'memory');
const GLOBAL_DIR = path.join(MEMORY_DIR, 'global');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');

/**
 * Generate a hash for a project path (for unique project identification)
 */
function hashProjectPath(projectPath) {
  return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
}

/**
 * Get the project memory directory for a given project path
 */
function getProjectMemoryDir(projectPath) {
  const hash = hashProjectPath(projectPath);
  return path.join(PROJECTS_DIR, hash);
}

/**
 * Ensure a directory exists, create if not
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Initialize the full memory directory structure
 */
function initializeMemoryStructure(projectPath = null) {
  // Global directories
  ensureDir(GLOBAL_DIR);
  ensureDir(path.join(GLOBAL_DIR, 'conversations'));

  // Initialize global files if they don't exist
  const globalFiles = ['index.json', 'decisions.json', 'learnings.json'];
  for (const file of globalFiles) {
    const filePath = path.join(GLOBAL_DIR, file);
    if (!fs.existsSync(filePath)) {
      writeJsonAtomic(filePath, file === 'index.json' ? createEmptyIndex() : []);
    }
  }

  // Project-specific directories (if projectPath provided)
  if (projectPath) {
    const projectDir = getProjectMemoryDir(projectPath);
    ensureDir(projectDir);
    ensureDir(path.join(projectDir, 'conversations'));

    // Initialize project files
    const projectFiles = ['index.json', 'context.json', 'decisions.json'];
    for (const file of projectFiles) {
      const filePath = path.join(projectDir, file);
      if (!fs.existsSync(filePath)) {
        if (file === 'index.json') {
          writeJsonAtomic(filePath, createEmptyIndex());
        } else if (file === 'context.json') {
          writeJsonAtomic(filePath, { projectPath, created: new Date().toISOString(), entries: [] });
        } else {
          writeJsonAtomic(filePath, []);
        }
      }
    }

    return { globalDir: GLOBAL_DIR, projectDir };
  }

  return { globalDir: GLOBAL_DIR, projectDir: null };
}

/**
 * Create an empty index structure
 */
function createEmptyIndex() {
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    entries: {
      byType: {},
      byTag: {},
      byFile: {},
      recent: []
    }
  };
}

/**
 * Read JSON file safely
 */
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Write JSON atomically (write to temp, then rename)
 */
function writeJsonAtomic(filePath, data) {
  const tempPath = filePath + '.tmp';
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error.message);
    // Cleanup temp file if it exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    return false;
  }
}

/**
 * Append to a JSON array file
 */
function appendToJsonArray(filePath, item) {
  let data = readJson(filePath) || [];
  if (!Array.isArray(data)) {
    data = [];
  }
  data.push(item);
  return writeJsonAtomic(filePath, data);
}

/**
 * Update an item in a JSON array file by ID
 */
function updateInJsonArray(filePath, id, updates) {
  let data = readJson(filePath) || [];
  const index = data.findIndex(item => item.id === id);
  if (index === -1) {
    return false;
  }
  data[index] = { ...data[index], ...updates, updatedAt: new Date().toISOString() };
  return writeJsonAtomic(filePath, data);
}

/**
 * Delete an item from a JSON array file by ID
 */
function deleteFromJsonArray(filePath, id) {
  let data = readJson(filePath) || [];
  const filtered = data.filter(item => item.id !== id);
  if (filtered.length === data.length) {
    return false; // Nothing was deleted
  }
  return writeJsonAtomic(filePath, filtered);
}

/**
 * Generate a UUID v4
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Get current project path (cwd or explicit)
 */
function getCurrentProjectPath() {
  return process.cwd();
}

module.exports = {
  CLAUDE_HOME,
  MEMORY_DIR,
  GLOBAL_DIR,
  PROJECTS_DIR,
  hashProjectPath,
  getProjectMemoryDir,
  ensureDir,
  initializeMemoryStructure,
  createEmptyIndex,
  readJson,
  writeJsonAtomic,
  appendToJsonArray,
  updateInJsonArray,
  deleteFromJsonArray,
  generateId,
  getCurrentProjectPath
};
