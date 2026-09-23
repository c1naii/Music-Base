function createUpdater(autoUpdater, publish, schedule = setTimeout) {
  let state = 'idle';
  let checking = false;
  let availableVersion = '';

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-available', (info) => {
    if (state === 'downloading' || state === 'installing') return;
    state = 'available';
    availableVersion = info.version;
    publish({ state, version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    if (state === 'idle') availableVersion = '';
  });

  autoUpdater.on('download-progress', (progress) => {
    if (state === 'downloading') {
      publish({ state, version: availableVersion, percent: Math.floor(progress.percent) });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (state !== 'downloading') return;
    state = 'installing';
    publish({ state, version: availableVersion });
    schedule(() => autoUpdater.quitAndInstall(true, true), 1200);
  });

  autoUpdater.on('error', (error) => {
    console.error('Music Base update:', error);
    if (state === 'downloading') {
      state = 'available';
      publish({ state: 'error', version: availableVersion });
    }
  });

  async function check() {
    if (checking || state !== 'idle') return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('Music Base update check:', error);
    } finally {
      checking = false;
    }
  }

  async function install() {
    if (state !== 'available') return;
    state = 'downloading';
    publish({ state, version: availableVersion, percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (state === 'downloading') {
        console.error('Music Base update download:', error);
        state = 'available';
        publish({ state: 'error', version: availableVersion });
      }
    }
  }

  return { check, install };
}

module.exports = { createUpdater };
