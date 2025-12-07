const fs = require('fs');
const path = require('path');

let SETTINGS_PATH = null;

const DEFAULT_SETTINGS = {
  standbyImage: null,
  slideshowInterval: 7000,
  bibleVersion: 'de4e12af7f28f599-02',
  bibleApiKey: '',
  scriptureBackground: '#000000',
  scriptureBackgroundImage: null,
  scriptureFontFamily: 'Georgia',
  scriptureFontSize: 48,
  scriptureFontColor: '#FFFFFF',
  presentationDisplayId: null,
  scalingMode: 'fit',
  mediaLibrary: [],
  slideshowPresets: [],
  activePresetId: null,
  pinnedScriptures: [],
  recentScriptures: []
};

function initSettings(userDataPath) {
  SETTINGS_PATH = path.join(userDataPath, 'settings.json');
}

function loadSettings() {
  if (!SETTINGS_PATH) {
    console.error('Settings path not initialized');
    return { ...DEFAULT_SETTINGS };
  }
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  if (!SETTINGS_PATH) {
    console.error('Settings path not initialized');
    return false;
  }
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving settings:', err);
    return false;
  }
}

module.exports = { initSettings, loadSettings, saveSettings, DEFAULT_SETTINGS };
