const IPC_CHANNELS = {
  SHOW_IMAGE: 'show-image',
  SHOW_STANDBY: 'show-standby',
  SHOW_SCRIPTURE: 'show-scripture',
  SHOW_VIDEO: 'show-video',
  CONTROL_VIDEO: 'control-video',
  VIDEO_STATE: 'video-state',
  PLAY_AUDIO: 'play-audio',
  CONTROL_AUDIO: 'control-audio',
  PRESENTATION_STATE: 'presentation-state',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  SETTINGS_UPDATED: 'settings-updated',
  PICK_FOLDER: 'pick-folder',
  PICK_FILE: 'pick-file',
  GET_DISPLAYS: 'get-displays',
  SET_PRESENTATION_DISPLAY: 'set-presentation-display',
  GET_DISPLAY_RESOLUTION: 'get-display-resolution',
  DISPLAY_RESOLUTION_CHANGED: 'display-resolution-changed',
  SCAN_FOLDER: 'scan-folder',
  GET_MEDIA_LIBRARY: 'get-media-library',
  ADD_TO_LIBRARY: 'add-to-library',
  REMOVE_FROM_LIBRARY: 'remove-from-library',
  UPDATE_LIBRARY_ITEM: 'update-library-item',
  CONFIRM_DIALOG: 'confirm-dialog',
  PROMPT_DIALOG: 'prompt-dialog',
  GET_SLIDESHOW_PRESETS: 'get-slideshow-presets',
  SAVE_SLIDESHOW_PRESET: 'save-slideshow-preset',
  DELETE_SLIDESHOW_PRESET: 'delete-slideshow-preset',
  SET_TRANSITION: 'set-transition',
  SAVE_THUMBNAIL: 'save-thumbnail',
  GET_THUMBNAIL: 'get-thumbnail'
};

if (typeof module !== 'undefined') {
  module.exports = IPC_CHANNELS;
}
