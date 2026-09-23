const tabs = [...document.querySelectorAll('[role="tab"]')];
const pages = [...document.querySelectorAll('[role="tabpanel"]')];
const TRANSITION_MS = 250;
let transitionTimer;

function selectTab(tab, moveFocus = false) {
  if (tab.getAttribute('aria-selected') === 'true') return;

  clearTimeout(transitionTimer);
  const nextPage = document.getElementById(tab.getAttribute('aria-controls'));

  tabs.forEach((item) => {
    const selected = item === tab;
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });

  if (moveFocus) tab.focus();
  pages.forEach((page) => page.classList.remove('is-active'));
  nextPage.hidden = false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => nextPage.classList.add('is-active'));
  });

  transitionTimer = setTimeout(() => {
    pages.forEach((page) => {
      if (page !== nextPage) page.hidden = true;
    });
  }, TRANSITION_MS);
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    selectTab(tabs[(index + direction + tabs.length) % tabs.length], true);
  });
});

document.querySelectorAll('[data-window-action]').forEach((button) => {
  button.addEventListener('click', () => {
    window.musicBase.windowControl(button.dataset.windowAction);
  });
});

const library = window.musicKnowledge;
const knowledgeView = document.getElementById('knowledge-view');
let currentFolder = null;
let currentTopic = null;

function makeElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function makeBackButton(label, destination) {
  const button = makeElement('button', 'library-back', `←  ${label}`);
  button.type = 'button';
  button.dataset.back = destination;
  return button;
}

function makeHeading(kicker, title, description) {
  const heading = makeElement('div', 'library-heading');
  heading.append(makeElement('p', 'library-kicker', kicker));
  heading.append(makeElement('h1', 'library-title', title));
  if (description) heading.append(makeElement('p', 'library-description', description));
  return heading;
}

function showLibrary() {
  currentFolder = null;
  currentTopic = null;
  const fragment = document.createDocumentFragment();
  fragment.append(makeHeading('БАЗА ЗНАНИЙ', 'Теория музыки', 'От первых нот до собственного музыкального наброска.'));

  const list = makeElement('div', 'library-list');
  library.folders.forEach((folder, index) => {
    const button = makeElement('button', 'library-row');
    button.type = 'button';
    button.dataset.folder = folder.id;

    const icon = makeElement('span', 'folder-symbol');
    icon.setAttribute('aria-hidden', 'true');
    const main = makeElement('span', 'row-main');
    main.append(makeElement('span', 'row-index', String(index + 1).padStart(2, '0')));
    main.append(makeElement('span', 'row-title', folder.title));
    main.append(makeElement('span', 'row-description', folder.description));
    button.append(icon, main, makeElement('span', 'row-count', `${folder.topics.length} темы`), makeElement('span', 'row-arrow', '↗'));
    list.append(button);
  });

  fragment.append(list);
  knowledgeView.replaceChildren(fragment);
  knowledgeView.scrollTop = 0;
}

function showFolder(folder) {
  currentFolder = folder;
  currentTopic = null;
  const fragment = document.createDocumentFragment();
  fragment.append(makeBackButton('Все разделы', 'library'));
  fragment.append(makeHeading('ТЕОРИЯ МУЗЫКИ', folder.title, folder.description));

  const list = makeElement('div', 'library-list topic-list');
  folder.topics.forEach((topic, index) => {
    const button = makeElement('button', 'library-row topic-row');
    button.type = 'button';
    button.dataset.topic = topic.id;
    const main = makeElement('span', 'row-main');
    main.append(makeElement('span', 'row-index', String(index + 1).padStart(2, '0')));
    main.append(makeElement('span', 'row-title', topic.title));
    main.append(makeElement('span', 'row-description', topic.explanation));
    button.append(main, makeElement('span', 'row-arrow', '↗'));
    list.append(button);
  });

  fragment.append(list);
  knowledgeView.replaceChildren(fragment);
  knowledgeView.scrollTop = 0;
}

function showTopic(topic) {
  currentTopic = topic;
  const fragment = document.createDocumentFragment();
  fragment.append(makeBackButton(currentFolder.title, 'folder'));
  fragment.append(makeHeading(currentFolder.title.toUpperCase(), topic.title, topic.explanation));

  const article = makeElement('article', 'knowledge-article');
  const concepts = makeElement('section', 'article-section');
  concepts.append(makeElement('h2', '', 'Основные понятия'));
  const list = makeElement('ul', 'concept-list');
  topic.concepts.forEach((concept) => list.append(makeElement('li', '', concept)));
  concepts.append(list);

  const example = makeElement('section', 'article-section');
  example.append(makeElement('h2', '', 'Пример'));
  example.append(makeElement('p', '', topic.example));

  const practice = makeElement('section', 'article-section');
  practice.append(makeElement('h2', '', 'Применение в музыке'));
  practice.append(makeElement('p', '', topic.practice));

  const sources = makeElement('div', 'article-sources');
  sources.append(makeElement('span', 'source-label', 'ИСТОЧНИКИ'));
  topic.sources.forEach((reference) => {
    const source = library.sources[reference.id];
    const link = makeElement('a', 'source-link', source.label);
    link.href = `https://www.youtube.com/watch?v=${source.id}&t=${reference.at}s`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
  });

  article.append(concepts, example, practice, sources);
  fragment.append(article);
  knowledgeView.replaceChildren(fragment);
  knowledgeView.scrollTop = 0;
}

knowledgeView.addEventListener('click', (event) => {
  const folderButton = event.target.closest('[data-folder]');
  if (folderButton) {
    showFolder(library.folders.find((folder) => folder.id === folderButton.dataset.folder));
    return;
  }

  const topicButton = event.target.closest('[data-topic]');
  if (topicButton && currentFolder) {
    showTopic(currentFolder.topics.find((topic) => topic.id === topicButton.dataset.topic));
    return;
  }

  const backButton = event.target.closest('[data-back]');
  if (backButton) {
    if (backButton.dataset.back === 'folder') showFolder(currentFolder);
    else showLibrary();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.getElementById('panel-theory').hidden) return;
  if (currentTopic) showFolder(currentFolder);
  else if (currentFolder) showLibrary();
});

showLibrary();

const versionLabel = document.getElementById('app-version');
const updatePanel = document.getElementById('update-panel');
const updateKicker = document.getElementById('update-kicker');
const updateTitle = document.getElementById('update-title');
const updateNotes = document.getElementById('update-notes');
const updateProgress = document.getElementById('update-progress');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateProgressCaption = document.getElementById('update-progress-caption');
const updateError = document.getElementById('update-error');
const updateButton = document.getElementById('update-button');
const updateClose = document.getElementById('update-close');

window.musicBase.getVersion().then((version) => {
  versionLabel.textContent = `v${version}`;
  updateKicker.textContent = `Music Base v${version}`;
});

window.musicBase.onUpdateStatus((status) => {
  if (status.state === 'available') {
    updateTitle.textContent = `Доступна новая версия v${status.version}`;
    updateNotes.textContent = status.notes || 'Описание изменений для этого выпуска не добавлено.';
    updateProgress.hidden = true;
    updateError.hidden = true;
    updateButton.textContent = 'Обновить';
    updateButton.disabled = false;
    updateClose.disabled = false;
    updatePanel.hidden = false;
  } else if (status.state === 'downloading') {
    const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
    updateProgress.hidden = false;
    updateProgress.dataset.phase = 'downloading';
    updateProgress.setAttribute('aria-valuenow', String(percent));
    updateProgressFill.style.width = `${percent}%`;
    updateProgressCaption.textContent = `Загрузка обновления · ${percent}%`;
    updateButton.textContent = 'Загрузка…';
    updateButton.disabled = true;
    updateClose.disabled = true;
  } else if (status.state === 'installing') {
    updateProgress.hidden = false;
    updateProgress.dataset.phase = 'installing';
    updateProgress.setAttribute('aria-valuenow', '100');
    updateProgressFill.style.width = '100%';
    updateProgressCaption.textContent = 'Установка и перезапуск…';
    updateButton.textContent = 'Перезапуск…';
    updateButton.disabled = true;
    updateClose.disabled = true;
  } else if (status.state === 'error') {
    updateProgress.hidden = true;
    updateError.hidden = false;
    updateButton.textContent = 'Повторить';
    updateButton.disabled = false;
    updateClose.disabled = false;
    updatePanel.hidden = false;
  }
});

updateButton.addEventListener('click', () => window.musicBase.installUpdate());
updateClose.addEventListener('click', () => { updatePanel.hidden = true; });
