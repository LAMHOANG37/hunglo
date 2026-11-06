const { contextBridge, ipcRenderer } = require('electron');

// Giao diện theo máy (thanh tiêu đề Mac/Windows) và theo bản (khách: ẩn tab API)
const edition = (process.argv.find(a => a.startsWith('--mss-edition=')) || '').split('=')[1] || 'pro';
window.addEventListener('DOMContentLoaded', () => {
  Object.assign(document.documentElement.dataset, { os: process.platform, edition });
  if (edition !== 'customer') return;
  document.title = 'LamMuse';
  document.querySelector('.brand-logo-hex').textContent = 'L';
  document.querySelector('.brand-title').textContent = 'LamMuse';
});

contextBridge.exposeInMainWorld('electronAPI', {
  openMuseLogin: () => ipcRenderer.invoke('open-muse-login'),
  checkMuseStatus: () => ipcRenderer.invoke('check-muse-status'),
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  scrapeAndAnalyzeLadi: (url, opts) => ipcRenderer.invoke('scrape-and-analyze-ladi', url, opts),
  getUserConfig: () => ipcRenderer.invoke('get-user-config'),
  saveUserConfig: (cfg) => ipcRenderer.invoke('save-user-config', cfg),
  fetchFbPages: (token) => ipcRenderer.invoke('fetch-fb-pages', token),
  verifyFbToken: (payload) => ipcRenderer.invoke('verify-fb-token', payload),
  publishFbReels: (payload) => ipcRenderer.invoke('publish-fb-reels', payload),
  logoutMuse: () => ipcRenderer.invoke('logout-muse'),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  selectImageFile: (multi) => ipcRenderer.invoke('select-image-file', multi),
  queueLoad: () => ipcRenderer.invoke('queue-load'),
  queueSave: (data) => ipcRenderer.invoke('queue-save', data),
  fetchImageBase64: (url) => ipcRenderer.invoke('fetch-image-base64', url),
  getLibraryVideos: () => ipcRenderer.invoke('get-library-videos'),
  mergeVideos: (paths, name) => ipcRenderer.invoke('merge-videos', paths, name),
  addMusic: (video) => ipcRenderer.invoke('add-music', video),
  openMusicFolder: () => ipcRenderer.invoke('open-music-folder'),
  getStudio: () => ipcRenderer.invoke('studio-get'),
  saveStudio: (patch) => ipcRenderer.invoke('studio-save', patch),
  addStudioImage: (src) => ipcRenderer.invoke('studio-add-image', src),
  addProject: (name) => ipcRenderer.invoke('project-add', name),
  updateProject: (id, patch) => ipcRenderer.invoke('project-update', id, patch),
  setProject: (id) => ipcRenderer.invoke('project-current', id),
  removeProject: (id) => ipcRenderer.invoke('project-remove', id),
  submitTask: (input) => ipcRenderer.invoke('task-submit', input),
  listTasks: () => ipcRenderer.invoke('task-list'),
  cancelTask: (id) => ipcRenderer.invoke('task-cancel', id),
  retryTask: (id) => ipcRenderer.invoke('task-retry', id),
  removeTask: (id) => ipcRenderer.invoke('task-remove', id),
  resumeTasks: () => ipcRenderer.invoke('task-resume'),
  clearFinishedTasks: () => ipcRenderer.invoke('task-clear-finished'),
  revealFile: (p) => ipcRenderer.invoke('reveal-file', p),
  getApiKey: (regenerate) => ipcRenderer.invoke('get-api-key', regenerate),
  runTasks: (ids) => ipcRenderer.invoke('task-run', ids),
  stopAllTasks: () => ipcRenderer.invoke('task-stop-all'),
  listAccounts: () => ipcRenderer.invoke('accounts-list'),
  addAccount: (name) => ipcRenderer.invoke('account-add', name),
  updateAccount: (id, patch) => ipcRenderer.invoke('account-update', id, patch),
  removeAccount: (id) => ipcRenderer.invoke('account-remove', id),
  loginAccount: (id) => ipcRenderer.invoke('account-login', id),
  showAccount: (id) => ipcRenderer.invoke('account-show', id),
  logoutAccount: (id) => ipcRenderer.invoke('account-logout', id),
  saveAccountSettings: (patch) => ipcRenderer.invoke('accounts-settings', patch),
  checkQuota: (id) => ipcRenderer.invoke('accounts-check-quota', id),
  checkProxies: () => ipcRenderer.invoke('proxies-check'),
  checkLogins: () => ipcRenderer.invoke('accounts-check-login'),
  listLibrary: () => ipcRenderer.invoke('list-library'),
  trashFiles: (paths) => ipcRenderer.invoke('trash-files', paths),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Listeners from Main process
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_event, value) => callback(value)),
  onVideoCompleted: (callback) => ipcRenderer.on('video-completed', (_event, value) => callback(value)),
  onTaskUpdate: (callback) => ipcRenderer.on('task-update', (_event, value) => callback(value)),
  onStudioUpdate: (callback) => ipcRenderer.on('studio-update', (_event, value) => callback(value)),
  onMergeProgress: (callback) => ipcRenderer.on('merge-progress', (_event, value) => callback(value)),
  onAccountsUpdate: (callback) => ipcRenderer.on('accounts-update', (_event, value) => callback(value)),
  onCrmJobReceived: (callback) => ipcRenderer.on('crm-job-received', (_event, value) => callback(value)),
  onLog: (callback) => ipcRenderer.on('app-log', (_event, value) => callback(value))
});
