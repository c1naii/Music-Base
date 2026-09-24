const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createBackupService({ notesDirectory, notesPinsPath, downloadsIndexPath, favoritesPath, backupDirectory }) {
  const sources = [
    { name: 'Notes', path: notesDirectory, directory: true },
    { name: 'notes-pins.json', path: notesPinsPath },
    { name: 'downloads.json', path: downloadsIndexPath },
    { name: 'warehouse-favorites.json', path: favoritesPath }
  ];

  function create() {
    fs.mkdirSync(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDirectory, `Music Base ${stamp}`);
    const staging = path.join(backupDirectory, `.backup-${crypto.randomUUID()}`);
    fs.mkdirSync(staging);
    try {
      const included = [];
      for (const source of sources) {
        if (!fs.existsSync(source.path)) continue;
        if (source.directory) fs.cpSync(source.path, path.join(staging, source.name), { recursive: true, force: false, errorOnExist: true });
        else fs.copyFileSync(source.path, path.join(staging, source.name), fs.constants.COPYFILE_EXCL);
        included.push(source.name);
      }
      fs.writeFileSync(path.join(staging, 'backup.json'), JSON.stringify({ createdAt: new Date().toISOString(), included }, null, 2), 'utf8');
      fs.renameSync(staging, target);
      return target;
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  return { create };
}

module.exports = { createBackupService };
