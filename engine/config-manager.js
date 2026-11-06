/**
 * CONFIG MANAGER
 * Lưu trữ an toàn cài đặt người dùng (Token Facebook, Page ID, cấu hình) vào máy tính
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class ConfigManager {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'user_config.json');
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Lỗi đọc user_config.json:', e);
    }
    return {
      fbToken: '',
      fbPages: [],
      selectedPageId: '',
      selectedPageName: '',
      selectedPageAccessToken: '',
      selectedPageAvatar: '',
      autoPublishAfterRender: false
    };
  }

  save(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Lỗi lưu user_config.json:', e);
      return false;
    }
  }

  get() {
    return this.config;
  }
}

module.exports = new ConfigManager();
