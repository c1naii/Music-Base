const fs = require('node:fs');
const path = require('node:path');

function validateTitle(value) {
  if (typeof value !== 'string') throw new Error('Invalid note title');
  const title = value.trim();
  if (!title || title.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(title) || /[. ]$/.test(title) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(title)) {
    throw new Error('Invalid note title');
  }
  return title;
}

function createNotesStore(dataDirectory) {
  const notesDirectory = path.join(dataDirectory, 'Notes');
  const pinsFile = path.join(dataDirectory, 'notes-pins.json');
  fs.mkdirSync(notesDirectory, { recursive: true });

  function titles() {
    return fs.readdirSync(notesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
      .map((entry) => entry.name.slice(0, -4));
  }

  function existingTitle(title) {
    return titles().find((item) => item.toLocaleLowerCase() === title.toLocaleLowerCase());
  }

  function notePath(title) {
    return path.join(notesDirectory, `${validateTitle(title)}.txt`);
  }

  function readPins() {
    try {
      const value = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
      return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    } catch { return []; }
  }

  function writePins(pins) {
    fs.writeFileSync(pinsFile, JSON.stringify(pins), 'utf8');
  }

  function list() {
    const pins = readPins();
    return titles().map((title) => ({
      title,
      content: fs.readFileSync(notePath(title), 'utf8'),
      pinned: pins.includes(title)
    })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title));
  }

  function create(title) {
    const clean = validateTitle(title);
    if (existingTitle(clean)) throw new Error('Note already exists');
    fs.writeFileSync(notePath(clean), '', { encoding: 'utf8', flag: 'wx' });
    return list();
  }

  function save(oldTitle, nextTitle, content, pinned) {
    const old = existingTitle(validateTitle(oldTitle));
    const next = validateTitle(nextTitle);
    if (!old) throw new Error('Note not found');
    if (typeof content !== 'string' || typeof pinned !== 'boolean') throw new Error('Invalid note');
    const collision = existingTitle(next);
    if (collision && collision !== old) throw new Error('Note already exists');
    if (old !== next) fs.renameSync(notePath(old), notePath(next));
    fs.writeFileSync(notePath(next), content, 'utf8');
    const pins = readPins().filter((item) => item !== old && item !== next);
    if (pinned) pins.push(next);
    writePins(pins);
    return list();
  }

  function remove(title) {
    const existing = existingTitle(validateTitle(title));
    if (!existing) throw new Error('Note not found');
    fs.unlinkSync(notePath(existing));
    writePins(readPins().filter((item) => item !== existing));
    return list();
  }

  return { list, create, save, remove };
}

module.exports = { createNotesStore, validateTitle };
