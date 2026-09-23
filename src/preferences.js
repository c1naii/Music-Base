const fs = require('node:fs');
const path = require('node:path');

const defaults = Object.freeze({
  language: 'ru',
  showSplash: true,
  visualEffects: true,
  bounds: null,
  maximized: false
});

function validBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isInteger)) return null;
  if (width < 680 || height < 480) return null;
  return { x, y, width, height };
}

function normalizePreferences(value = {}) {
  return {
    language: ['ru', 'en', 'uk'].includes(value.language) ? value.language : defaults.language,
    showSplash: typeof value.showSplash === 'boolean' ? value.showSplash : defaults.showSplash,
    visualEffects: typeof value.visualEffects === 'boolean' ? value.visualEffects : defaults.visualEffects,
    bounds: validBounds(value.bounds),
    maximized: value.maximized === true
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
