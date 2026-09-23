const fs = require('node:fs');
const path = require('node:path');

const defaults = Object.freeze({
  language: 'ru',
  showSplash: true,
  visualEffects: true,
  bounds: null,
  maximized: false,
  lastPlace: null
});

function validBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isInteger)) return null;
  if (width < 680 || height < 480) return null;
  return { x, y, width, height };
}

function normalizePreferences(value = {}) {
  const place = value.lastPlace;
  const lastPlace = place && typeof place === 'object' &&
    (place.type === 'library' || place.type === 'folder' || place.type === 'topic' || place.type === 'note') &&
    (place.folderId === undefined || typeof place.folderId === 'string') &&
    (place.topicId === undefined || typeof place.topicId === 'string') &&
    (place.noteTitle === undefined || typeof place.noteTitle === 'string') ? {
      type: place.type,
      ...(place.folderId ? { folderId: place.folderId } : {}),
      ...(place.topicId ? { topicId: place.topicId } : {}),
      ...(place.noteTitle ? { noteTitle: place.noteTitle } : {})
    } : null;
  return {
    language: ['ru', 'en', 'uk'].includes(value.language) ? value.language : defaults.language,
    showSplash: typeof value.showSplash === 'boolean' ? value.showSplash : defaults.showSplash,
    visualEffects: typeof value.visualEffects === 'boolean' ? value.visualEffects : defaults.visualEffects,
    bounds: validBounds(value.bounds),
    maximized: value.maximized === true,
    lastPlace
  };
}

function loadPreferences(file) {
  try {
    return normalizePreferences(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizePreferences();
  }
}

function savePreferences(file, preferences) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalizePreferences(preferences)), 'utf8');
}

module.exports = { loadPreferences, savePreferences, normalizePreferences };
