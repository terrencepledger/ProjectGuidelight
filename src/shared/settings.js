const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'settings.json');

const DEFAULT_SETTINGS = {
  standbyImage: null,
  slideshowInterval: 7000,
  bibleVersion: 'de4e12af7f28f599-02',
  scriptureBackground: '#000000',
  presentationDisplayId: null,
  scalingMode: 'fit',
  mediaLibrary: [],
  slideshowPresets: [],
  activePresetId: null
};

function loadSettings() {
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

module.exports = { loadSettings, saveSettings, DEFAULT_SETTINGS };
