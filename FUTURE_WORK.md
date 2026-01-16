# Guidelight Future Work

Post-v1 roadmap for Guidelight church presentation system.

---

## Phase 1: Foundation & Infrastructure

### Version Control
Push entire codebase to GitHub repository for proper versioning, collaboration, and backup.

### Crashlytics
Auto-recovery from crashes with session state restoration. Log errors for troubleshooting and reliability improvements.

---

## Phase 2: Media & Content Management

### Email Integration
Connect an email account to automatically search for and pull media attachments. Useful for receiving announcements, flyers, and event graphics directly into the media library.

### Cloud Storage Integration
Sync with Google Drive, Dropbox, or OneDrive for centralized media management across devices and team members.

### Media Tagging
Organize media with labels/categories for quick filtering and discovery.

- Tag examples: Worship, Announcements, Easter, Youth, Backgrounds, Archive
- Multi-tag support per item
- Filter by tag in media library
- Smart tags (auto-tag by folder name on import)
- Color-coded tags for visual scanning

### Image Editing
Basic in-app editing for consistency across media.

- Crop, brightness, contrast adjustments
- Auto-resize/optimize on import
- Batch editing for multiple images

---

## Phase 3: Scripture Enhancements

### Offline Scripture Caching
Download and cache scripture content for offline use during services.

### Multi-Version Scripture
Display multiple Bible translations side-by-side or toggle between versions.

### Scripture Languages
Support for non-English translations and multilingual displays.

---

## Phase 4: Operator Experience

### UI Standards & Responsiveness Review
Re-examine the UI in each pane for best standards, resizing behavior, and ease of access. Ensure consistent spacing, alignment, and accessibility across all panels and window sizes.

### Keyboard Shortcuts & Quick-Switch Presets
Hotkeys or large dedicated buttons for common service segments. Reduce clicks during live services.

### More Slideshow Transitions
Expand beyond fade/slide with additional transition effects (dissolve, wipe, zoom, etc.).

### Audio Preview Options
Explore options for audio in the preview pane:

- Muted by default (current v1 behavior)
- Optional unmute toggle in preview
- Preview-only audio output (separate from presentation audio)
- Volume control in preview vs live

### Background Audio for Slideshows
Add ambient/background audio track support for slideshows:

- Attach audio file to slideshow preset
- Loop audio independently of slide timing
- Fade in/out controls
- Volume control separate from video audio

### Audio + Visual Layering
Allow audio to play simultaneously with other visual content:

- Audio continues while displaying images, slideshows, or scripture
- Independent transport controls for audio layer
- Visual indicator showing audio is playing behind current content
- Fade/crossfade between audio tracks

---

## Phase 5: Service Planning

### Service Planner
Ordered run-of-show with cued content segments.

- Drag-and-drop sequence builder
- Mix content types: slideshow → scripture → video → slideshow
- Pre-load entire service in advance
- One-click advance through planned segments

---

## Technical Considerations

### Tauri 2 Migration
Evaluate migrating from Electron to Tauri 2 with Svelte 5 for improved performance and smaller bundle size. Currently under consideration.

---

## Target Users Reminder

All features must prioritize:
- Large buttons (≥48px)
- Clear labels
- Minimal interface complexity
- Maximum reliability
- Minimal training requirements

Primary operators: Non-technical church volunteers, often 65+.
