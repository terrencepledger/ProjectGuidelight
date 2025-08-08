# Guidelight

## Mission
Build a unified, intuitive desktop application for church volunteers to control all visual presentations during services—including slideshows, videos, and scripture—with minimal training and maximum reliability.

## Core Use Cases

### Auto-Advancing Slideshow
- Load a folder of images.
- Display fullscreen on a second monitor.
- Advance automatically on a timer (e.g., every 7 seconds).
- Optional looping.

### Manual Image Display
- Load a folder of images.
- Preview images in the control panel.
- One-click display on the presentation screen.

### Scripture Display
- Enter verse reference (e.g., John 3:16).
- Fetch verse text from an online Bible API.
- Display verse with themed background.
- Controls for previous/next verse.

### Video Playback
- Load local video files (e.g., MP4).
- Preview in the control panel.
- One-click to play fullscreen on the second screen.
- Basic controls: play, pause, restart.

## User Experience Principles
- Target users: non-technical volunteers, often 65+.
- Large buttons (≥48px) with clear labels.
- Minimal nesting of controls.
- Real-time preview of content to be displayed.
- No clutter or extra modes.

## System Architecture

### Core Stack
- **App shell:** Electron
- **UI:** HTML/CSS/JS (or React)
- **Presentation layer:** Reveal.js for slides and scripture
- **Scripture integration:** API.Bible
- **Media playback:** HTML5 `<video>` or libVLC
- **Data storage:** JSON + local file system

### Dual-Window Sync
- Control window: operator interface built with Electron + HTML.
- Presentation window: fullscreen output on second display via Electron `BrowserWindow` with Reveal.js or `<video>` tag.
- Windows communicate using Electron's `ipcRenderer` and `ipcMain` messaging.

### Data Flow
- Images/videos: `[Folder] → [Control UI] → [Preview] → [Presentation Window]`
- Scripture: `[Reference] → [API.Bible] → [Styled Verse in Presentation Window]`

## MVP Development Plan
1. Set up an Electron app with dual windows.
2. Implement auto slideshow with folder picker and timer.
3. Provide manual image mode with preview and one-click send.
4. Add video player with preview and fullscreen output.
5. Enable scripture display with text input and API fetch.
6. Store basic configuration (folders, timer, preferences) in JSON.

