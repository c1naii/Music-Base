const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('all interface and knowledge topics have complete translations', () => {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ['knowledge.js', 'i18n.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context);
  }
  const { musicKnowledge, musicI18n } = context.window;
  const uiKeys = Object.keys(musicI18n.ru.ui);
  for (const code of ['en', 'uk']) {
    const translation = musicI18n[code];
    for (const key of uiKeys) assert.ok(translation.ui[key], `${code} UI: ${key}`);
    for (const folder of musicKnowledge.folders) {
      const translatedFolder = translation.knowledge.folders[folder.id];
      assert.ok(translatedFolder?.title && translatedFolder.description, `${code} folder: ${folder.id}`);
      for (const topic of folder.topics) {
        const translatedTopic = translatedFolder.topics[topic.id];
        assert.ok(translatedTopic, `${code} topic: ${topic.id}`);
        for (const key of ['title', 'explanation', 'example', 'practice']) {
          assert.ok(translatedTopic[key], `${code} ${topic.id}: ${key}`);
        }
        assert.equal(translatedTopic.concepts.length, topic.concepts.length, `${code} ${topic.id}: concepts`);
        assert.ok(translatedTopic.concepts.every(Boolean), `${code} ${topic.id}: empty concept`);
      }
    }
  }
});
