const tabs = [...document.querySelectorAll('[role="tab"]')];
const pages = [...document.querySelectorAll('[role="tabpanel"]')];
const TRANSITION_MS = 250;
const baseLibrary = window.musicKnowledge;
let language = new URLSearchParams(location.search).get('language') || 'ru';
if (!window.musicI18n[language]) language = 'ru';
let ui = window.musicI18n[language].ui;
let library = baseLibrary;
let libraryLoaded = false;
let transitionTimer;
const warehouseCategories = ['drumkits', 'plugins', 'projects', 'presets'];
const warehouseCategoryList = document.getElementById('warehouse-categories');
const warehouseEmptyView = document.getElementById('warehouse-empty-view');
const warehouseDownloadsView = document.getElementById('warehouse-downloads-view');
const warehouseEmptyTitle = document.getElementById('warehouse-empty-title');
const warehouseItemsView = document.getElementById('warehouse-items');
const warehouseDownloadsList = document.getElementById('warehouse-downloads-list');
const warehouseDownloadsEmpty = document.getElementById('warehouse-downloads-empty');
const warehouseAdminTrigger = document.getElementById('warehouse-admin-trigger');
const adminPinBackdrop = document.getElementById('admin-pin-backdrop');
const adminPinForm = document.getElementById('admin-pin-form');
const adminPinInput = document.getElementById('admin-pin-input');
const adminPinError = document.getElementById('admin-pin-error');
const adminBackdrop = document.getElementById('admin-backdrop');
const adminForm = document.getElementById('admin-form');
const adminItemsList = document.getElementById('admin-list');
const adminCategoryInput = document.getElementById('admin-category');
const adminTitleInput = document.getElementById('admin-item-title');
const adminDescriptionInput = document.getElementById('admin-description');
const adminImageName = document.getElementById('admin-image-name');
const adminFileName = document.getElementById('admin-file-name');
const adminDeleteButton = document.getElementById('admin-delete');
const adminStatus = document.getElementById('admin-status');
let warehouseView = 'categories';
let currentWarehouseCategory = null;
let warehouseCatalog = { schemaVersion: 1, items: [] };
let warehouseDownloads = [];
let adminSelectedId = null;
let adminImagePath = null;
let adminFilePath = null;
let adminDeletePending = false;

function renderWarehouse() {
  warehouseCategoryList.hidden = warehouseView !== 'categories';
  warehouseEmptyView.hidden = warehouseView !== 'category';
  warehouseDownloadsView.hidden = warehouseView !== 'downloads';
  if (currentWarehouseCategory) warehouseEmptyTitle.textContent = ui[currentWarehouseCategory];
  renderWarehouseItems();
  renderWarehouseDownloads();
}

function renderWarehouseItems() {
  warehouseItemsView.replaceChildren();
  if (warehouseView !== 'category') return;
  const items = warehouseCatalog.items.filter((item) => item.category === currentWarehouseCategory);
  if (!items.length) {
    warehouseItemsView.classList.add('is-empty');
    const empty = makeElement('div', 'warehouse-empty-state');
    empty.append(makeElement('p', 'warehouse-empty-message', ui.catalogEmpty));
    warehouseItemsView.append(empty);
    return;
  }
  warehouseItemsView.classList.remove('is-empty');
  for (const item of items) {
    const card = makeElement('article', 'warehouse-item-card');
    const image = makeElement('img', 'warehouse-item-image');
    image.src = item.imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    const body = makeElement('div', 'warehouse-item-body');
    body.append(makeElement('h3', 'warehouse-item-title', item.title));
    if (item.description) body.append(makeElement('p', 'warehouse-item-description', item.description));
    const record = warehouseDownloads.find((entry) => entry.itemId === item.id);
    const download = makeElement('button', 'warehouse-item-download', record ? ui.downloadDone : ui.downloadItem);
    download.type = 'button';
    if (record?.draggable) {
      download.draggable = true;
      download.title = ui.dragToDaw;
      download.addEventListener('dragstart', (event) => {
        event.preventDefault();
        window.musicBase.startWarehouseDrag(record.id);
      });
    }
    download.addEventListener('click', async () => {
      if (record) { await window.musicBase.openWarehouseDownload(record.id); return; }
      download.disabled = true;
      download.textContent = ui.downloadStarted;
      try {
        warehouseDownloads = await window.musicBase.downloadWarehouseItem(item.id);
        download.textContent = ui.downloadDone;
        renderWarehouseItems();
        renderWarehouseDownloads();
      } catch {
        download.textContent = ui.downloadFailed;
      } finally {
        setTimeout(() => { if (download.isConnected) { download.disabled = false; download.textContent = ui.downloadDone; } }, 2200);
      }
    });
    const actions = makeElement('div', 'warehouse-item-actions');
    actions.append(download);
    if (record) actions.append(makeDownloadActions(record));
    body.append(actions);
    card.append(image, body);
    warehouseItemsView.append(card);
  }
}

function renderWarehouseDownloads() {
  if (!warehouseDownloadsList) return;
  warehouseDownloadsList.replaceChildren();
  const hasDownloads = warehouseDownloads.length > 0;
  warehouseDownloadsEmpty.hidden = hasDownloads;
  for (const file of warehouseDownloads) {
    const row = makeElement('div', 'warehouse-download-row');
    const details = makeElement('div', 'warehouse-download-details');
    details.append(makeElement('span', 'warehouse-download-title', file.title));
    details.append(makeElement('span', 'warehouse-download-filename', `${ui[file.category]} · ${file.fileName}`));
    row.append(details, makeDownloadActions(file));
    warehouseDownloadsList.append(row);
  }
}

function makeDownloadActions(record) {
  const actions = makeElement('div', 'warehouse-file-actions');
  const more = makeElement('button', 'warehouse-file-more', '⋯');
  more.type = 'button';
  more.setAttribute('aria-label', ui.moreActions);
  more.title = ui.moreActions;
  const menu = makeElement('div', 'warehouse-file-menu');
  menu.hidden = true;
  const open = makeElement('button', '', ui.openFolder);
  open.type = 'button';
  open.addEventListener('click', async () => {
    try { await window.musicBase.openWarehouseDownload(record.id); }
    finally { menu.hidden = true; }
  });
  const remove = makeElement('button', 'danger', ui.removeDownload);
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      warehouseDownloads = await window.musicBase.deleteWarehouseDownload(record.id);
      renderWarehouseItems();
      renderWarehouseDownloads();
    } catch { remove.disabled = false; }
  });
  menu.append(open, remove);
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    document.querySelectorAll('.warehouse-file-menu').forEach((other) => { if (other !== menu) other.hidden = true; });
    menu.hidden = !menu.hidden;
  });
  actions.append(more, menu);
  return actions;
}

function showWarehouseHome() {
  warehouseView = 'categories';
  currentWarehouseCategory = null;
  renderWarehouse();
}

function showWarehouseCategory(category) {
  if (!warehouseCategories.includes(category)) return;
  warehouseView = 'category';
  currentWarehouseCategory = category;
  renderWarehouse();
}

function showWarehouseDownloads() {
  warehouseView = 'downloads';
  currentWarehouseCategory = null;
  renderWarehouse();
  window.musicBase.getWarehouseDownloads().then((items) => {
    warehouseDownloads = items || [];
    renderWarehouseDownloads();
  });
}

function renderAdminList() {
  adminItemsList.replaceChildren();
  if (!warehouseCatalog.items.length) {
    adminItemsList.append(makeElement('p', 'admin-empty', ui.adminEmpty));
    return;
  }
  for (const item of [...warehouseCatalog.items].sort((a, b) => a.title.localeCompare(b.title))) {
    const button = makeElement('button', `admin-list-item${item.id === adminSelectedId ? ' selected' : ''}`);
    button.type = 'button';
    button.dataset.adminItem = item.id;
    button.append(makeElement('span', 'admin-list-item-title', item.title));
    button.append(makeElement('span', 'admin-list-item-category', ui[item.category]));
    adminItemsList.append(button);
  }
}

function resetAdminForm() {
  adminSelectedId = null;
  adminImagePath = null;
  adminFilePath = null;
  adminForm.reset();
  adminCategoryInput.value = currentWarehouseCategory || 'drumkits';
  adminImageName.textContent = ui.adminNoFileSelected;
  adminFileName.textContent = ui.adminNoFileSelected;
  adminDeleteButton.hidden = true;
  adminDeletePending = false;
  adminDeleteButton.textContent = ui.adminDelete;
  renderAdminList();
}

function editAdminItem(id) {
  const item = warehouseCatalog.items.find((entry) => entry.id === id);
  if (!item) return resetAdminForm();
  adminSelectedId = item.id;
  adminCategoryInput.value = item.category;
  adminTitleInput.value = item.title;
  adminDescriptionInput.value = item.description;
  adminImagePath = null;
  adminFilePath = null;
  adminImageName.textContent = ui.adminNoFileSelected;
  adminFileName.textContent = item.fileName;
  adminDeletePending = false;
  adminDeleteButton.hidden = false;
  adminDeleteButton.textContent = ui.adminDelete;
  adminStatus.textContent = '';
  renderAdminList();
}

async function chooseAdminFile(kind) {
  try {
    const result = await window.musicBase.pickWarehouseFile(kind);
    if (!result) return;
    if (kind === 'image') { adminImagePath = result.path; adminImageName.textContent = result.name; }
    else { adminFilePath = result.path; adminFileName.textContent = result.name; }
  } catch { adminStatus.textContent = ui.adminSaveError; }
}

async function refreshWarehouse() {
  try { warehouseCatalog = await window.musicBase.getWarehouseCatalog() || warehouseCatalog; }
  catch { /* The main process already falls back to its local catalog cache. */ }
  renderWarehouse();
  renderAdminList();
  renderSearch();
}

function closeAdmin() {
  adminBackdrop.hidden = true;
  adminPinBackdrop.hidden = true;
  adminPinInput.value = '';
  window.musicBase.lockWarehouseAdmin();
}

async function openAdminEditor() {
  warehouseCatalog = await window.musicBase.getWarehouseCatalog() || warehouseCatalog;
  renderAdminList();
  resetAdminForm();
  adminStatus.textContent = '';
  adminBackdrop.hidden = false;
}

function localizedLibrary(code) {
  const translated = window.musicI18n[code].knowledge;
  if (!translated) return baseLibrary;
  return {
    sources: Object.fromEntries(Object.entries(baseLibrary.sources).map(([key, source]) => [
      key, { ...source, label: translated.sources[key] || source.label }
    ])),
    folders: baseLibrary.folders.map((folder) => {
      const entry = translated.folders[folder.id];
      return {
        ...folder, title: entry.title, description: entry.description,
        topics: folder.topics.map((topic) => ({ ...topic, ...entry.topics[topic.id] }))
      };
    })
  };
}

function applyLanguage(code) {
  if (!window.musicI18n[code]) return;
  const folderId = currentFolder?.id;
  const topicId = currentTopic?.id;
  language = code;
  ui = window.musicI18n[code].ui;
  library = localizedLibrary(code);
  document.documentElement.lang = code;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = ui[node.dataset.i18n];
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', ui[node.dataset.i18nAria]);
  });
  document.querySelectorAll('[data-i18n-alt]').forEach((node) => {
    node.alt = ui[node.dataset.i18nAlt];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = ui[node.dataset.i18nPlaceholder];
  });
  if (libraryLoaded) {
    if (folderId) {
      const folder = library.folders.find((item) => item.id === folderId);
      if (topicId) {
        currentFolder = folder;
        showTopic(folder.topics.find((item) => item.id === topicId));
      } else showFolder(folder);
    } else showLibrary();
  }
  if (currentUpdateStatus) renderUpdateStatus(currentUpdateStatus);
  renderNotes();
  renderSearch();
  renderWarehouse();
  renderAdminList();
}

function showPage(pageId, activeTab = null) {
  clearTimeout(transitionTimer);
  if (pageId !== 'panel-home' && !searchPanel.hidden) closeSearch();
  searchTrigger.hidden = pageId !== 'panel-home';
  const nextPage = document.getElementById(pageId);

  tabs.forEach((item) => {
    const selected = item === activeTab;
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected || (!activeTab && item.id === 'tab-storage') ? 0 : -1;
  });

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

function selectTab(tab, moveFocus = false) {
  if (tab.getAttribute('aria-selected') === 'true') return;
  if (tab.id === 'tab-theory' && !libraryLoaded) showLibrary();
  if (tab.id === 'tab-storage') showWarehouseHome();
  showPage(tab.getAttribute('aria-controls'), tab);
  if (moveFocus) tab.focus();
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
document.getElementById('home-trigger').addEventListener('click', () => showPage('panel-home'));
warehouseCategoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-warehouse-category]');
  if (button) showWarehouseCategory(button.dataset.warehouseCategory);
});
document.getElementById('warehouse-back').addEventListener('click', showWarehouseHome);
document.getElementById('warehouse-downloads').addEventListener('click', showWarehouseDownloads);
document.getElementById('warehouse-downloads-back').addEventListener('click', showWarehouseHome);
warehouseAdminTrigger.addEventListener('click', () => {
  adminPinInput.value = '';
  adminPinError.textContent = '';
  adminPinBackdrop.hidden = false;
  adminPinInput.focus();
});
document.getElementById('admin-pin-close').addEventListener('click', closeAdmin);
adminPinBackdrop.addEventListener('click', (event) => { if (event.target === adminPinBackdrop) closeAdmin(); });
adminBackdrop.addEventListener('click', (event) => { if (event.target === adminBackdrop) closeAdmin(); });
document.getElementById('admin-close').addEventListener('click', closeAdmin);
adminPinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const allowed = await window.musicBase.verifyWarehouseAdmin(adminPinInput.value);
  if (!allowed) { adminPinError.textContent = ui.adminWrongPin; adminPinInput.select(); return; }
  adminPinBackdrop.hidden = true;
  adminPinInput.value = '';
  await openAdminEditor();
});
document.getElementById('admin-new').addEventListener('click', () => {
  resetAdminForm();
  adminTitleInput.focus();
});
adminItemsList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-item]');
  if (button) editAdminItem(button.dataset.adminItem);
});
document.getElementById('admin-pick-image').addEventListener('click', () => chooseAdminFile('image'));
document.getElementById('admin-pick-file').addEventListener('click', () => chooseAdminFile('file'));
adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = document.getElementById('admin-save');
  saveButton.disabled = true;
  adminStatus.textContent = ui.downloadStarted;
  try {
    warehouseCatalog = await window.musicBase.saveWarehouseItem({
      id: adminSelectedId,
      category: adminCategoryInput.value,
      title: adminTitleInput.value,
      description: adminDescriptionInput.value,
      imagePath: adminImagePath,
      filePath: adminFilePath
    });
    const saved = warehouseCatalog.items.find((item) => item.id === adminSelectedId) ||
      warehouseCatalog.items.find((item) => item.title === adminTitleInput.value.trim() && item.category === adminCategoryInput.value);
    adminSelectedId = saved?.id || null;
    adminImagePath = null;
    adminFilePath = null;
    adminImageName.textContent = ui.adminNoFileSelected;
    adminFileName.textContent = saved?.fileName || ui.adminNoFileSelected;
    adminDeleteButton.hidden = !saved;
    adminDeletePending = false;
    adminDeleteButton.textContent = ui.adminDelete;
    adminStatus.textContent = ui.adminSaved;
    renderWarehouse();
    renderAdminList();
    renderSearch();
  } catch { adminStatus.textContent = ui.adminSaveError; }
  finally { saveButton.disabled = false; }
});
adminDeleteButton.addEventListener('click', async () => {
  if (!adminSelectedId) return;
  if (!adminDeletePending) {
    adminDeletePending = true;
    adminDeleteButton.textContent = ui.adminDeleteConfirm;
    adminStatus.textContent = ui.adminDeletePrompt;
    return;
  }
  adminDeleteButton.disabled = true;
  try {
    warehouseCatalog = await window.musicBase.deleteWarehouseItem(adminSelectedId);
    resetAdminForm();
    adminStatus.textContent = ui.adminSaved;
    renderWarehouse();
    renderSearch();
  } catch { adminStatus.textContent = ui.adminSaveError; }
  finally { adminDeleteButton.disabled = false; }
});

document.querySelectorAll('[data-window-action]').forEach((button) => {
  button.addEventListener('click', () => {
    window.musicBase.windowControl(button.dataset.windowAction);
  });
});

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
  libraryLoaded = true;
  currentFolder = null;
  currentTopic = null;
  const fragment = document.createDocumentFragment();
  fragment.append(makeHeading(ui.knowledgeBase, ui.theory, ui.libraryDescription));

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
    button.append(icon, main, makeElement('span', 'row-count', `${folder.topics.length} ${ui.topicCount}`), makeElement('span', 'row-arrow', '↗'));
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
  fragment.append(makeBackButton(ui.allSections, 'library'));
  fragment.append(makeHeading(ui.theory.toLocaleUpperCase(language), folder.title, folder.description));

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
  fragment.append(makeHeading(currentFolder.title.toLocaleUpperCase(language), topic.title, topic.explanation));

  const article = makeElement('article', 'knowledge-article');
  const concepts = makeElement('section', 'article-section');
  concepts.append(makeElement('h2', '', ui.concepts));
  const list = makeElement('ul', 'concept-list');
  topic.concepts.forEach((concept) => list.append(makeElement('li', '', concept)));
  concepts.append(list);

  const example = makeElement('section', 'article-section');
  example.append(makeElement('h2', '', ui.example));
  example.append(makeElement('p', '', topic.example));

  const practice = makeElement('section', 'article-section');
  practice.append(makeElement('h2', '', ui.practice));
  practice.append(makeElement('p', '', topic.practice));

  const sources = makeElement('div', 'article-sources');
  sources.append(makeElement('span', 'source-label', ui.sources));
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
    rememberPlace({ type: 'folder', folderId: currentFolder.id });
    return;
  }

  const topicButton = event.target.closest('[data-topic]');
  if (topicButton && currentFolder) {
    showTopic(currentFolder.topics.find((topic) => topic.id === topicButton.dataset.topic));
    rememberPlace({ type: 'topic', folderId: currentFolder.id, topicId: currentTopic.id });
    return;
  }

  const backButton = event.target.closest('[data-back]');
  if (backButton) {
    if (backButton.dataset.back === 'folder') {
      showFolder(currentFolder);
      rememberPlace({ type: 'folder', folderId: currentFolder.id });
    } else {
      showLibrary();
      rememberPlace({ type: 'library' });
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!notesBackdrop.hidden || !searchPanel.hidden) return;
  if (!settingsPanel.hidden) {
    closeSettings();
    return;
  }
  if (document.getElementById('panel-theory').hidden) return;
  if (currentTopic) showFolder(currentFolder);
  else if (currentFolder) showLibrary();
});

const versionLabel = document.getElementById('app-version');
const settingsTrigger = document.getElementById('settings-trigger');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const downloadPathLabel = document.getElementById('download-path');
const downloadPathStatus = document.getElementById('download-path-status');
const languageSelect = document.getElementById('language-select');
const splashToggle = document.getElementById('splash-toggle');
const effectsToggle = document.getElementById('effects-toggle');
const updatePanel = document.getElementById('update-panel');
const updateTitle = document.getElementById('update-title');
const updateVersion = document.getElementById('update-version');
const updateProgress = document.getElementById('update-progress');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateProgressCaption = document.getElementById('update-progress-caption');
const updateError = document.getElementById('update-error');
const updateButton = document.getElementById('update-button');
const updateClose = document.getElementById('update-close');
let currentUpdateStatus = null;
let updateDismissed = false;

function closeSettings() {
  settingsPanel.hidden = true;
  settingsTrigger.setAttribute('aria-expanded', 'false');
}

function renderPreferences(preferences) {
  languageSelect.value = preferences.language;
  splashToggle.setAttribute('aria-checked', String(preferences.showSplash));
  effectsToggle.setAttribute('aria-checked', String(preferences.visualEffects));
  document.documentElement.classList.toggle('effects-off', !preferences.visualEffects);
  if (preferences.language !== language) applyLanguage(preferences.language);
  if (preferences.downloadDirectory) {
    downloadPathLabel.textContent = `${preferences.downloadDirectory}${preferences.downloadDirectoryIsDefault ? ` · ${ui.defaultBadge}` : ''}`;
  }
}

settingsTrigger.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsTrigger.setAttribute('aria-expanded', String(!settingsPanel.hidden));
});
settingsClose.addEventListener('click', closeSettings);
document.addEventListener('pointerdown', (event) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsTrigger.contains(event.target)) closeSettings();
});
languageSelect.addEventListener('change', async () => {
  const preferences = await window.musicBase.setPreference('language', languageSelect.value);
  if (preferences) renderPreferences(preferences);
});
for (const [button, key] of [[splashToggle, 'showSplash'], [effectsToggle, 'visualEffects']]) {
  button.addEventListener('click', async () => {
    const nextValue = button.getAttribute('aria-checked') !== 'true';
    const preferences = await window.musicBase.setPreference(key, nextValue);
    if (preferences) renderPreferences(preferences);
  });
}
document.getElementById('choose-download-path').addEventListener('click', async () => {
  try {
    const preferences = await window.musicBase.chooseDownloadDirectory();
    if (preferences) renderPreferences(preferences);
  } catch { downloadPathStatus.textContent = ui.downloadPathError; }
});
document.getElementById('reset-download-path').addEventListener('click', async () => {
  try {
    const preferences = await window.musicBase.resetDownloadDirectory();
    if (preferences) { downloadPathStatus.textContent = ui.defaultPathSet; renderPreferences(preferences); }
  } catch { downloadPathStatus.textContent = ui.downloadPathError; }
});
for (const [buttonId, daw] of [['integrate-flstudio', 'flstudio'], ['integrate-ableton', 'ableton']]) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    try {
      const result = await window.musicBase.integrateDaw(daw);
      if (result) downloadPathStatus.textContent = `${ui.dawIntegrated}: ${result.path}`;
    } catch { downloadPathStatus.textContent = ui.dawIntegrationError; }
  });
}

function renderUpdateStatus(status) {
  updateTitle.textContent = ui.updateAvailable;
  updateVersion.textContent = `${ui.newVersion} v${status.version}`;
  updateError.textContent = ui.downloadError;
  if (status.state === 'available') {
    updateProgress.hidden = true;
    updateError.hidden = true;
    updateButton.textContent = ui.update;
    updateButton.disabled = false;
    updateClose.disabled = false;
    updatePanel.hidden = updateDismissed;
  } else if (status.state === 'downloading') {
    const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
    updateProgress.hidden = false;
    updateProgress.dataset.phase = 'downloading';
    updateProgress.setAttribute('aria-valuenow', String(percent));
    updateProgressFill.style.width = `${percent}%`;
    updateProgressCaption.textContent = `${ui.downloadProgress} · ${percent}%`;
    updateButton.textContent = ui.loading;
    updateButton.disabled = true;
    updateClose.disabled = true;
    updatePanel.hidden = false;
  } else if (status.state === 'installing') {
    updateProgress.hidden = false;
    updateProgress.dataset.phase = 'installing';
    updateProgress.setAttribute('aria-valuenow', '100');
    updateProgressFill.style.width = '100%';
    updateProgressCaption.textContent = ui.installing;
    updateButton.textContent = ui.restarting;
    updateButton.disabled = true;
    updateClose.disabled = true;
    updatePanel.hidden = false;
  } else if (status.state === 'error') {
    updateProgress.hidden = true;
    updateError.hidden = false;
    updateButton.textContent = ui.retry;
    updateButton.disabled = false;
    updateClose.disabled = false;
    updatePanel.hidden = false;
  }
}

const continueButton = document.getElementById('continue-button');
const searchTrigger = document.getElementById('search-trigger');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const notesTrigger = document.getElementById('notes-trigger');
const notesBackdrop = document.getElementById('notes-backdrop');
const notesList = document.getElementById('notes-list');
const noteCreate = document.getElementById('note-create');
const noteEdit = document.getElementById('note-edit');
const noteEmpty = document.getElementById('note-empty');
const noteTitleInput = document.getElementById('note-title-input');
const noteContent = document.getElementById('note-content');
const notePin = document.getElementById('note-pin');
const noteStatus = document.getElementById('note-status');
const noteDelete = document.getElementById('note-delete');
let lastPlace = null;
let notes = [];
let selectedNote = null;
let deletePending = false;
let saveTimer;

function rememberPlace(place) {
  lastPlace = place;
  continueButton.hidden = false;
  window.musicBase.setLastPlace(place);
}

async function openPlace(place) {
  if (!place) return;
  if (place.type === 'warehouse') {
    selectTab(document.getElementById('tab-storage'));
    showWarehouseCategory(place.category);
    rememberPlace(place);
    return;
  }
  if (place.type === 'note') {
    if (!notes.some((note) => note.title === place.noteTitle)) notes = await window.musicBase.listNotes();
    if (notes.some((note) => note.title === place.noteTitle)) openNotes(place.noteTitle);
    else { lastPlace = null; continueButton.hidden = true; }
    return;
  }
  selectTab(document.getElementById('tab-theory'));
  const folder = library.folders.find((item) => item.id === place.folderId);
  if (place.type === 'topic' && folder) {
    const topic = folder.topics.find((item) => item.id === place.topicId);
    if (topic) { currentFolder = folder; showTopic(topic); rememberPlace(place); return; }
  }
  if (place.type === 'folder' && folder) { showFolder(folder); rememberPlace(place); return; }
  showLibrary();
  rememberPlace({ type: 'library' });
}

continueButton.addEventListener('click', () => openPlace(lastPlace));
document.getElementById('tab-theory').addEventListener('click', () => {
  if (!currentFolder) rememberPlace({ type: 'library' });
  else if (currentTopic) rememberPlace({ type: 'topic', folderId: currentFolder.id, topicId: currentTopic.id });
  else rememberPlace({ type: 'folder', folderId: currentFolder.id });
});

function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function searchWords(value) {
  return normalizeSearch(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function searchItems() {
  const items = [];
  for (const category of warehouseCategories) {
    items.push({ kind: 'folder', title: ui[category], detail: ui.storage, text: ui[category], place: { type: 'warehouse', category } });
  }
  for (const item of warehouseCatalog.items) {
    items.push({ kind: 'topic', title: item.title, detail: ui[item.category], text: `${item.title} ${item.description}`, place: { type: 'warehouse', category: item.category } });
  }
  for (const folder of library.folders) {
    items.push({ kind: 'folder', title: folder.title, detail: folder.description, text: folder.title + ' ' + folder.description, place: { type: 'folder', folderId: folder.id } });
    for (const topic of folder.topics) {
      items.push({ kind: 'topic', title: topic.title, detail: folder.title, text: [topic.title, topic.explanation, ...topic.concepts, topic.example, topic.practice].join(' '), place: { type: 'topic', folderId: folder.id, topicId: topic.id } });
    }
  }
  for (const note of notes) items.push({ kind: 'note', title: note.title, detail: note.content.slice(0, 110), text: note.title + ' ' + note.content, place: { type: 'note', noteTitle: note.title } });
  return items;
}

function renderSearch() {
  const query = normalizeSearch(searchInput.value);
  searchResults.replaceChildren();
  if (!query) { searchResults.append(makeElement('p', 'search-message', ui.searchHint)); return; }
  const terms = searchWords(query);
  if (!terms.length) { searchResults.append(makeElement('p', 'search-message', ui.searchEmpty)); return; }
  const matches = searchItems().map((item) => {
    const titleWords = searchWords(item.title);
    const contentWords = searchWords(item.text);
    const title = normalizeSearch(item.title);
    const exactTitle = searchWords(title).join(' ') === terms.join(' ');
    const matchesTitle = terms.every((term) => titleWords.some((word) => word.startsWith(term)));
    const matchesContent = terms.every((term) => contentWords.some((word) => word.startsWith(term)));
    if (!matchesContent) return null;
    return { ...item, rank: exactTitle ? 3 : matchesTitle ? 2 : 1, phraseMatch: title.includes(query) };
  }).filter(Boolean).sort((a, b) => b.rank - a.rank || Number(b.phraseMatch) - Number(a.phraseMatch) || a.title.localeCompare(b.title)).slice(0, 30);
  if (!matches.length) { searchResults.append(makeElement('p', 'search-message', ui.searchEmpty)); return; }
  for (const match of matches) {
    const row = makeElement('button', 'search-result');
    row.type = 'button';
    row.append(makeElement('span', 'search-result-type', match.kind === 'folder' ? ui.folder : match.kind === 'note' ? ui.notes : ui.material));
    row.append(makeElement('span', 'search-result-title', match.title));
    row.append(makeElement('span', 'search-result-detail', match.detail));
    row.addEventListener('click', () => { closeSearch(); openPlace(match.place); });
    searchResults.append(row);
  }
}

function closeSearch() { searchPanel.hidden = true; searchTrigger.setAttribute('aria-expanded', 'false'); }
searchTrigger.addEventListener('click', () => {
  closeSettings();
  if (!notesBackdrop.hidden) closeNotes();
  searchPanel.hidden = !searchPanel.hidden;
  searchTrigger.setAttribute('aria-expanded', String(!searchPanel.hidden));
  if (!searchPanel.hidden) { renderSearch(); searchInput.focus(); }
});
document.getElementById('search-close').addEventListener('click', closeSearch);
searchInput.addEventListener('input', renderSearch);

function renderNotes() {
  notesList.replaceChildren();
  for (const note of notes) {
    const row = makeElement('button', 'note-list-row' + (note.title === selectedNote ? ' selected' : ''));
    row.type = 'button';
    row.append(makeElement('span', '', note.pinned ? '◇  ' + note.title : note.title));
    row.addEventListener('click', () => selectNote(note.title));
    notesList.append(row);
  }
  if (selectedNote) {
    const note = notes.find((item) => item.title === selectedNote);
    if (note) {
      notePin.textContent = note.pinned ? ui.unpin : ui.pin;
      notePin.setAttribute('aria-pressed', String(note.pinned));
      return;
    }
  }
  noteEdit.hidden = true;
  noteEmpty.hidden = !noteCreate.hidden;
}

async function selectNote(title) {
  if (selectedNote && selectedNote !== title && (noteTitleInput.value !== selectedNote || noteContent.value !== notes.find((item) => item.title === selectedNote)?.content)) {
    await saveCurrentNote();
  }
  clearTimeout(saveTimer);
  const note = notes.find((item) => item.title === title);
  if (!note) return;
  selectedNote = title;
  noteCreate.hidden = true;
  noteEmpty.hidden = true;
  noteEdit.hidden = false;
  noteTitleInput.value = note.title;
  noteContent.value = note.content;
  noteStatus.textContent = '';
  deletePending = false;
  noteDelete.textContent = ui.delete;
  renderNotes();
  rememberPlace({ type: 'note', noteTitle: title });
}

function openNotes(title) {
  closeSettings(); closeSearch();
  notesBackdrop.hidden = false;
  if (title) selectNote(title);
  else { renderNotes(); document.getElementById('note-new').focus(); }
}
function closeNotes() {
  clearTimeout(saveTimer);
  if (selectedNote && (noteTitleInput.value !== selectedNote || noteContent.value !== notes.find((item) => item.title === selectedNote)?.content)) saveCurrentNote();
  notesBackdrop.hidden = true;
}
notesTrigger.addEventListener('click', () => openNotes());
document.getElementById('notes-close').addEventListener('click', closeNotes);
notesBackdrop.addEventListener('click', (event) => { if (event.target === notesBackdrop) closeNotes(); });
document.getElementById('note-new').addEventListener('click', async () => {
  if (selectedNote) await saveCurrentNote();
  selectedNote = null;
  noteEdit.hidden = true;
  noteEmpty.hidden = true;
  noteCreate.hidden = false;
  document.getElementById('note-create-title').value = '';
  document.getElementById('note-create-error').textContent = '';
  document.getElementById('note-create-title').focus();
  renderNotes();
});
document.getElementById('note-create-button').addEventListener('click', async () => {
  const title = document.getElementById('note-create-title').value;
  try {
    notes = await window.musicBase.createNote(title);
    await selectNote(title.trim());
    renderSearch();
  } catch (error) { document.getElementById('note-create-error').textContent = error.message.includes('already exists') ? ui.noteDuplicate : ui.noteInvalid; }
});
document.getElementById('note-create-title').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('note-create-button').click();
});

async function saveCurrentNote() {
  if (!selectedNote) return;
  const old = selectedNote;
  const title = noteTitleInput.value.trim();
  const pinned = notePin.getAttribute('aria-pressed') === 'true';
  try {
    notes = await window.musicBase.saveNote(old, title, noteContent.value, pinned);
    selectedNote = title;
    noteStatus.textContent = ui.noteSaved;
    renderNotes(); renderSearch();
    rememberPlace({ type: 'note', noteTitle: title });
  } catch (error) { noteStatus.textContent = error.message.includes('already exists') ? ui.noteDuplicate : ui.noteError; }
}
document.getElementById('note-save').addEventListener('click', saveCurrentNote);
noteContent.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 900); });
noteTitleInput.addEventListener('change', saveCurrentNote);
notePin.addEventListener('click', () => { notePin.setAttribute('aria-pressed', String(notePin.getAttribute('aria-pressed') !== 'true')); saveCurrentNote(); });
noteDelete.addEventListener('click', async () => {
  if (!selectedNote) return;
  if (!deletePending) { deletePending = true; noteDelete.textContent = ui.confirmDelete; return; }
  try {
    clearTimeout(saveTimer);
    notes = await window.musicBase.deleteNote(selectedNote);
    selectedNote = null;
    rememberPlace({ type: 'library' });
    deletePending = false;
    noteDelete.textContent = ui.delete;
    renderNotes(); renderSearch();
  } catch { noteStatus.textContent = ui.noteError; }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!notesBackdrop.hidden) closeNotes();
  else if (!searchPanel.hidden) closeSearch();
});
document.addEventListener('copy', (event) => {
  if (!event.target.closest('input, textarea, select')) event.preventDefault();
});
applyLanguage(language);
document.documentElement.classList.toggle('effects-off', new URLSearchParams(location.search).get('effects') === 'off');
window.musicBase.getPreferences().then((preferences) => {
  if (preferences) {
    renderPreferences(preferences);
    lastPlace = preferences.lastPlace;
    continueButton.hidden = !lastPlace;
  }
});
window.musicBase.listNotes().then((items) => { notes = items || []; renderNotes(); renderSearch(); });
refreshWarehouse();
window.musicBase.getWarehouseDownloads().then((items) => { warehouseDownloads = items || []; renderWarehouseItems(); renderWarehouseDownloads(); });
window.musicBase.checkWarehouseAdmin().then((allowed) => { warehouseAdminTrigger.hidden = !allowed; });

window.musicBase.getVersion().then((version) => {
  versionLabel.textContent = `v${version}`;
});

window.musicBase.onUpdateStatus((status) => {
  if (status.state === 'available' && currentUpdateStatus?.version !== status.version) {
    updateDismissed = false;
  }
  currentUpdateStatus = status;
  renderUpdateStatus(status);
});

updateButton.addEventListener('click', () => window.musicBase.installUpdate());
updateClose.addEventListener('click', () => {
  updateDismissed = true;
  updatePanel.hidden = true;
});
