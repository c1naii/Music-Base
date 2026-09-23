const fs = require('node:fs');
const path = require('node:path');

function versionParts(value) {
  return (value.match(/\d+/g) || []).map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

function findInstalledDaw(daw, roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
  if (!['flstudio', 'ableton'].includes(daw)) throw new Error('Invalid DAW');
  const matches = [];
  for (const root of roots.filter(Boolean)) {
    const parent = path.join(root, daw === 'flstudio' ? 'Image-Line' : 'Ableton');
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const version = daw === 'flstudio'
        ? /^FL Studio (\d+(?:\.\d+)*)$/i.exec(entry.name)
        : /^Live (\d+(?:\.\d+)*)(?:\s|$)/i.exec(entry.name);
      if (!version) continue;
      const installPath = path.join(parent, entry.name);
      const executable = daw === 'flstudio'
        ? path.join(installPath, 'FL64.exe')
        : path.join(installPath, 'Program', `Ableton ${entry.name}.exe`);
      if (fs.existsSync(executable)) matches.push({ daw, version: version[1], installPath });
    }
  }
  return matches.sort((a, b) => compareVersions(a.version, b.version))[0] || null;
}

module.exports = { findInstalledDaw };
