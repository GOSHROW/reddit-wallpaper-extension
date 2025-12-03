# Reddit Wallpaper New Tab

A browser extension that replaces your new tab page with stunning images from Reddit.

Works on Chrome, Firefox, Edge, Brave, Opera, and other Chromium-based browsers.

![Screenshot](resources/screenshot.png)
*Screenshot shows version 1.3.0 of the extension*

## Features

- **Beautiful wallpapers** from any subreddit (defaults to CineShots)
- **Smart caching** - first load ~1s, then 45+ tabs load instantly
- **Smart aspect ratio** - fill display (crops edges) or fit image (with blurred background)
- **NSFW filtering** - safe by default with optional toggle
- **Keyboard shortcuts** - navigate efficiently without mouse
- **Draggable clock** - reposition anywhere, 12/24-hour format toggle
- **Background blur** - improve readability on busy images
- **Image info** - see resolution, score, age, and author
- **Gallery support** - extracts all images from multi-image posts
- **CDN prioritization** - loads most reliable sources first
- **Cross-browser** - works seamlessly on all major browsers

## Installation

### Chrome / Edge / Brave / Chromium-based browsers

1. Open `about://extensions/` (`edge://extensions/` in Edge)
2. Turn on "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select this folder
4. Open a new tab

### Firefox

1. Download or clone this repository
2. Rename `manifest_firefox.json` to `manifest.json` (backup original first)
3. Open `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file

**Note**: Firefox requires signing through Mozilla Add-ons for permanent installation.

## Usage

### Basic Controls

- **Change subreddit**: Click name at bottom left, type new name, press Enter
- **View post**: Click image title to open Reddit post
- **Refresh image**: Click refresh button (↻) or press `N`
- **Reposition clock**: Drag to move, double-click to reset
- **Toggle time format**: Click time to switch 12/24-hour format

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` or `→` | Load next image |
| `S` or `/` | Focus subreddit input |
| `I` or `?` | Toggle info & shortcuts menu |
| `B` | Toggle background blur |
| `F` | Toggle display mode (fill/fit) |
| `Shift+N` | Toggle NSFW filter |
| `Esc` | Close menu / Unfocus input |

### NSFW Filtering

- **Default**: Filtered (🔒 locked icon)
- **Enabled**: Allowed (🔓 unlocked icon, orange highlight)
- **Smart clearing**: Immediately removes NSFW image when filter is enabled
- **Persistent**: Setting saved across sessions

### Blur Toggle

- Click eye icon (👁️) to toggle subtle blur on background
- Improves text readability on busy images
- Setting persists across sessions

### Display Mode

- **Fill** (default): Fills viewport by cropping image edges - traditional wallpaper style
- **Fit**: Shows full image with blurred background filling letterbox areas - artistic effect
- Click display mode button or press `F` to switch
- Fill works best for landscapes, Fit preserves portraits and unusual aspect ratios
- Setting persists across sessions

### Recommended Subreddits

- `CineShots` - Movie screenshots
- `EarthPorn` - Nature photography
- `wallpapers` - Curated wallpapers
- `spaceporn` - Space imagery
- `CityPorn` - Urban photography
- `ArchitecturePorn` - Architecture photos

## How It Works

### Caching Strategy

1. Fetches 50 images at once from Reddit's public API
2. Stores URLs locally (not the images themselves)
3. Automatically refills when cache drops below 5 images
4. No rate limiting, minimal API calls

**Result**: First tab loads in ~1s, subsequent tabs are instant.

### CDN Prioritization

Images are sorted by source reliability:

1. **i.redd.it** (100) - Reddit's CDN, most reliable
2. **i.imgur.com** (90) - Imgur CDN
3. **imgur.com** (85) - Imgur direct
4. **preview.redd.it** (80) - Reddit preview
5. **External hosts** (50) - Unknown sources

Within each tier, images are randomized for variety.

### Smart Loading

- **Selective preloading**: Only preloads slower external images
- **In-page throttling**: 400ms cooldown prevents rapid UI switches
- **Cross-tab throttling**: 1-second global API rate limit across all tabs
- **Format validation**: Blocks GIFs and videos (only .jpg, .jpeg, .png, .webp)
- **Auto-retry**: Up to 3 attempts for failed loads
- **Visual feedback**: Spinner shows loading state
- **Smart error detection**: Optimized single-pass filtering distinguishes between missing images and NSFW-only content

### Image Extraction

Supports multiple Reddit post formats:
- Direct image links (imgur, external hosts)
- Reddit-hosted images (i.redd.it)
- Gallery posts (extracts all images with position labels)
- Preview images from Reddit's preview system

## Technical Details

### Architecture

**Modular design** with clean separation:
- `Logger` - Structured logging for debugging
- `Storage` - Browser storage abstraction (sync/local)
- `Settings` - User preferences management
- `ImageExtractor` - Multi-format image extraction
- `RedditAPI` - API calls and post filtering
- `ImageCache` - Caching and preloading logic
- `UI` - DOM manipulation and event handling
- `App` - Main application controller

**Key technologies**:
- Vanilla JavaScript (no dependencies)
- Manifest V3 (Chrome), V2 (Firefox)
- Reddit's public JSON API
- Browser Storage API
- CSS Glassmorphism & Backdrop Filters

### Performance

- **Dual-layer throttling**: In-page (400ms) + cross-tab (1000ms) prevents API abuse
- **Single-pass filtering**: Optimized image detection counts all images in one iteration
- **Bandwidth savings**: Skips preloading fast CDNs (~3-4MB saved per session)
- **Efficient caching**: ~15KB storage for 50 image URLs
- **Browser-managed images**: ~5-10MB temporary memory
- **Minimal CPU**: Browser handles image decoding

### Accessibility

- **WCAG 2.1 AA compliant**
- Semantic HTML with ARIA labels
- Full keyboard navigation
- Respects `prefers-reduced-motion`
- Enhanced borders for `prefers-contrast: high`
- Touch targets ≥36px (exceeds iOS 44px standard)

### User Interface

**Design system**:
- Glassmorphism with backdrop blur
- 600ms smooth crossfade transitions
- Responsive layout (mobile/desktop)
- Fluid typography with `clamp()`

**Interactive elements**:
- Refresh button (spinner replaces icon during load)
- Blur toggle (eye icon)
- NSFW toggle (lock icon: 🔒/🔓)
- Info tooltip (persistent, shows image metadata)
- Draggable clock with reset
- Error messages (context-aware, actionable)

### Storage

**Sync Storage** (across devices):
- Subreddit preference
- Clock position & format
- NSFW & blur settings
- Tooltip visibility

**Local Storage** (device-specific):
- Image cache URLs (~15KB for 50 images)
- CDN priority scores
- Image metadata (author, score, age, resolution)

### Privacy & Security

- ✅ No tracking or analytics
- ✅ No external servers (only Reddit's public API)
- ✅ No data collection or transmission
- ✅ Content Security Policy enforced
- ✅ All data stored locally in browser

## Troubleshooting

**No images showing?**
- Check internet connection
- Verify subreddit name (no "r/" prefix)
- Try default subreddit: "CineShots"

**Extension not working?**
- Enable in `chrome://extensions/`
- Click reload button on extension card
- Check browser console (F12) for errors

**Slow loading?**
- External hosts may be slower (expected behavior)
- Extension auto-prioritizes reliable CDNs
- Preloading ensures subsequent tabs load instantly

## Files

- `manifest.json` - Chrome/Chromium configuration
- `manifest_firefox.json` - Firefox configuration
- `newtab.html` - New tab page structure
- `newtab.js` - Main application logic
- `resources/styles.css` - Styling and animations
- `resources/icon*.png` - Extension icons
- `resources/screenshot.png` - Preview screenshot

## License

MIT
