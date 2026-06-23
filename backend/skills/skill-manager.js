const fs = require('fs');
const path = require('path');

class SkillManager {
  constructor() {
    this.skillsDir = path.join(__dirname);
  }

  // Helper to get all skill files
  getSkillFiles() {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
    return fs.readdirSync(this.skillsDir)
      .filter(f => f.endsWith('.js') && f !== 'skill-manager.js');
  }

  // List all registered skills with metadata
  listSkills() {
    const files = this.getSkillFiles();
    return files.map(f => {
      const name = path.basename(f, '.js');
      const filePath = path.join(this.skillsDir, f);
      try {
        // Clear require cache to get fresh exports in case it changed
        delete require.cache[require.resolve(filePath)];
        const skill = require(filePath);
        return {
          name,
          description: skill.description || 'No description provided.',
          parameters: skill.parameters || {}
        };
      } catch (err) {
        return {
          name,
          description: 'Error loading skill.',
          error: err.message
        };
      }
    });
  }

  // Create or overwrite a skill module
  createSkill(name, code) {
    // Validate skill name to avoid folder traversal
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeName) throw new Error('Invalid skill name.');

    const filePath = path.join(this.skillsDir, `${safeName}.js`);
    fs.writeFileSync(filePath, code, 'utf8');

    // Force verify that the syntax compiles
    try {
      delete require.cache[require.resolve(filePath)];
      const loaded = require(filePath);
      
      // Perform structural validation
      if (typeof loaded.execute !== 'function') {
        throw new Error('Skill module must export an async execute() function.');
      }
      return { success: true, name: safeName, meta: { description: loaded.description || '', parameters: loaded.parameters || {} } };
    } catch (err) {
      // If compile failed, delete it so we don't leave broken files in registry
      try { fs.unlinkSync(filePath); } catch (e) {}
      throw err;
    }
  }

  // Execute a skill
  async executeSkill(name, params = {}) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(this.skillsDir, `${safeName}.js`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Skill "${safeName}" does not exist.`);
    }

    // Force reload
    delete require.cache[require.resolve(filePath)];
    const skill = require(filePath);

    if (typeof skill.execute !== 'function') {
      throw new Error(`Skill "${safeName}" does not export execute() method.`);
    }

    // Execute skill
    return await skill.execute(params);
  }
}

module.exports = new SkillManager();
