# Reddit Wallpaper New Tab

A browser extension that replaces your new tab page with images from Reddit.

Works on Chrome, Firefox, Edge, Brave, Opera, and other Chromium-based browsers.

![Screenshot from v1.1.2](resources/screenshot.png)
*Screenshot shows version 1.1.2 of the extension*

## Installation

### Chrome / Edge / Brave / Chromium-based browsers

1. Open `chrome://extensions/` in Chrome (or `edge://extensions/` in Edge)
2. Turn on "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select this folder
4. Open a new tab

### Firefox

1. Download or clone this repository
2. Rename `manifest_firefox.json` to `manifest.json` (backup the original first)
3. Open `about:debugging#/runtime/this-firefox` in Firefox
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from this folder
6. Open a new tab

**Note**: Firefox loads extensions temporarily in development mode. For permanent installation, the extension needs to be signed through Mozilla Add-ons.

## Usage

Shows a different image each time you open a new tab.

**Change the subreddit:**
- Click on the subreddit name at the bottom left (defaults to "CineShots")
- Type a new subreddit name
- Press Enter

**View the Reddit post:**
- Click on the image title at the bottom to open the original Reddit post in a new tab

**Refresh for a new image:**
- Click the refresh button (↻) in the bottom bar to instantly load a new random image

**Customize the clock:**
- Drag the clock anywhere on the screen to reposition it
- Double-click the clock to reset it to the default center position
- Click on the time to toggle between 12-hour (6:45 PM) and 24-hour (18:45) format
- All preferences are saved and persist across sessions

**Keyboard shortcuts:**
- `N` or `→` (Right Arrow) - Load next image
- `/` or `S` - Focus subreddit input field
- `I` or `?` - Toggle info & shortcuts menu
- `B` - Toggle background blur
- `Shift + N` - Toggle NSFW content filter
- `Escape` - Close info menu / Unfocus input
- Simple, discoverable shortcuts for power users

**Blur Toggle:**
- Click the eye icon (👁️) in the bottom bar to toggle a subtle blur filter on the background image
- Useful for improving text readability when the wallpaper is too busy or bright
- Setting persists across sessions

**NSFW filtering:**
- Click the lock icon (🔒) in the bottom bar to toggle NSFW content filtering
- NSFW content filtered by default (safe for work)
- Setting persists across sessions
- Cache automatically refreshes when changed

**Good subreddits to try:**
- CineShots (movie screenshots)
- EarthPorn (nature photos)
- aww
- wallpapers
- spaceporn
- CityPorn
- ArchitecturePorn

## How it works

Fetches 50 images at a time from Reddit and caches them locally. This means:
- First tab takes ~1 second to load
- Next 45+ tabs load instantly
- No rate limiting issues
- Minimal API calls

When cache drops below 5 images, automatically fetches another batch.

### CDN Prioritization

Images are sorted by CDN reliability before caching:
- **i.redd.it** (Priority 100): Reddit's CDN - most reliable
- **i.imgur.com** (Priority 90): Imgur CDN - very reliable
- **imgur.com** (Priority 85): Imgur non-CDN
- **preview.redd.it** (Priority 80): Reddit preview system
- **External hosts** (Priority 50): Unknown sources

Within each priority tier, images are randomized for variety. Most reliable images load first while maintaining visual diversity.

### Smart Image Preloading

Intelligently preloads images in the background to minimize loading screens:
- **Selective Preloading**: Only preloads slower external images (priority < 85)
- **Batch Management**: Tracks preload batches and cancels stale preloads when subreddit changes
- **Minimal Bandwidth**: Skips preloading fast CDNs (i.redd.it, imgur) that load instantly
- **Automatic Refill**: Preloads next batch when cache drops below 5 images

First 5 tabs after opening load nearly instantly with zero visible loading screens.

### Smart Image Loading

Includes intelligent retry logic with request throttling:
- **Automatic Retries**: If an image fails to load (broken URL, CORS issue, deleted content), automatically tries the next image
- **Up to 3 Attempts**: Retries up to 3 times to handle transient failures
- **Request Throttling**: 400ms cooldown between successful loads prevents overlapping requests
- **Lock-Based Throttling**: Only one image can load at a time, released when image actually completes
- **Visual Feedback**: Loading spinner replaces refresh icon during active loading or throttling
- **Format Validation**: Only loads static images (.jpg, .jpeg, .png, .webp), blocks GIFs and videos
- **Smart Error Messages**: Context-aware error messages with accurate, actionable guidance

### Image Extraction

Can extract images from multiple Reddit post formats:
- Direct image links (imgur, external hosts)
- Reddit-hosted images (i.redd.it)
- Gallery posts (extracts all images with position indicators)
- Preview images from Reddit's preview system

All extracted images include:
- **CDN priority scoring** for optimal loading performance
- **Format validation** to ensure only static images (.jpg, .jpeg, .png, .webp)
- **Automatic filtering** of videos (.gifv, .mp4, .webm, .mov) and video hosting domains (v.redd.it, gfycat, redgifs)

**Gallery Post Enhancement**: Multi-image gallery posts now contribute all their images to the pool, not just the first one. Each image is labeled with its position (e.g., "Post Title (3/5)") for better context.

## Troubleshooting

**No images showing up?**
- Check your internet connection
- Make sure the subreddit name is correct (no "r/" prefix)
- Try a different subreddit like "CineShots"

**Extension not working?**
- Make sure it's enabled in `chrome://extensions/`
- Click the reload button on the extension card
- Check the browser console (F12) for errors

**Slow loading?**
- Extension automatically prioritizes reliable CDNs
- External image hosts may be slower - this is expected
- Preloading ensures subsequent tabs load instantly

## Technical details

### Architecture

- **Modular Design**: Code organized into logical modules (Logger, Storage, Settings, ImageExtractor, RedditAPI, ImageCache, UI, App)
- **Cross-Browser Support**: Compatible with Chrome, Firefox, Edge, Brave, Opera
- **Caching Strategy**: Batch fetching (50 posts) with automatic refill when cache drops below 5 images
- **Gallery Support**: Extracts all images from gallery posts (not just the first one)
- **NSFW Filtering**: Filters NSFW posts by default with optional user toggle
- **CDN Prioritization**: Images sorted by source reliability (i.redd.it → imgur → external)
- **Smart Preloading**: Selective background preloading of slower images only
- **Error Handling**: Automatic retry mechanism with up to 3 attempts for failed image loads
- **Request Throttling**: 400ms cooldown with visual feedback to prevent race conditions
- **Image Format Validation**: Ensures only static image formats are loaded, filtering out GIFs and videos
- **Comprehensive Logging**: Structured logging system for easy debugging and monitoring
- **State Management**: Uses Browser Storage API (sync for settings, local for cache)
- **Refined Error Messages**: Accurate, tonally consistent error messages with specific actionable guidance
- **Customizable Clock**: Draggable positioning with persistent storage and format toggle (12/24 hour)

### Technologies

- Vanilla JavaScript (no frameworks or dependencies)
- Cross-browser compatible (Chrome, Firefox, Edge, Brave, Opera)
- Chrome Extension Manifest V3 (Chromium), Manifest V2 (Firefox)
- Reddit's public JSON API (no authentication required)
- Browser Storage API with cross-browser compatibility layer
- Fisher-Yates shuffle algorithm for randomization

### Data Flow

1. **Initialization**: Load saved subreddit preference from sync storage
2. **Cache Check**: Check if cache exists and has sufficient images (≥5)
3. **API Fetch**: If needed, fetch 50 posts from Reddit's `/r/{subreddit}/new.json` endpoint
4. **Filter & Extract**: Filter image posts and extract URLs from various post formats
5. **CDN Prioritization**: Sort images by CDN reliability (highest first) with randomization within tiers
6. **Cache & Preload**: Store sorted images and preload first 5 slow/external images in background
7. **Display**: Load next image from cache with automatic retry on failure
8. **Smart Refill**: When cache drops below 5, automatically fetch and preload next batch

### Performance Optimizations

#### CDN-Based Prioritization
- Images sorted by source reliability before caching
- Most reliable sources (i.redd.it, imgur) displayed first
- Random order within each reliability tier for variety
- Reduces failed loads and improves user experience

#### Selective Preloading Strategy
- Preloads only images with CDN priority < 85 (external/slower hosts)
- Skips preloading i.redd.it and imgur images (already fast)
- Saves ~3-4MB bandwidth per session on average
- First 5 tabs load nearly instantly with preloaded images
- Automatic batch tracking prevents stale preloads

#### Smart Error Handling
- HTTP status-specific error messages (404, 403, 500+)
- Contextual suggestions with working subreddit examples
- Visual error styling with red text for visibility
- Automatic retry with different images (up to 3 attempts)
- Graceful degradation on repeated failures

### User Interface

#### Design System
- **Modern Glassmorphism**: Semi-transparent backgrounds with backdrop blur for depth
- **Smooth Transitions**: 600ms crossfade between images with smart fade logic
- **Responsive Layout**: Fluid typography and adaptive layouts for all screen sizes
- **Visual Hierarchy**: Clear focal point (centered clock) with subtle bottom info bar

#### Accessibility Features
- **WCAG 2.1 AA Compliant**: Meets web accessibility standards
- **Semantic HTML**: Proper ARIA labels and roles for screen readers
- **Keyboard Navigation**: Full keyboard support with visible focus indicators
- **Motion Preferences**: Respects `prefers-reduced-motion` for users sensitive to animations
- **Contrast Preferences**: Enhanced borders for `prefers-contrast: high`
- **Touch Targets**: Minimum 36×36px interactive elements (exceeds 44px iOS recommendation)

#### Interactive Elements
- **Refresh Button**: Manual image refresh with animated icon rotation on hover. During loading or throttling, the refresh icon is replaced by a spinner
- **Blur Toggle**: Button to apply a subtle blur filter to the background image for better text readability. Highlights when active
- **NSFW Toggle**: Button to enable/disable NSFW content filtering. Highlights when active
- **Info Tooltip**: Persistent tooltip showing image information, keyboard shortcuts, and settings. Toggled by clicking the info icon or pressing `I` or `?`
- **Subreddit Input**: Inline editable field with hover/focus states
- **Post Title Link**: Clickable title to view original Reddit post
- **Error Messages**: Context-aware, tonally consistent error messages with accurate guidance
- **Draggable Clock**: Click and drag to reposition anywhere on screen, persists across sessions
- **Clock Reset**: Double-click clock to return to default center position
- **Time Format Toggle**: Click time to switch between 12-hour and 24-hour formats
- **Keyboard Shortcuts**: `N` or `→` for next image, `S` or `/` to focus subreddit, `I` or `?` to toggle info menu, `B` to toggle blur, `Shift+N` to toggle NSFW, `Esc` to close menu/unfocus input

#### Responsive Behavior
- **Desktop**: Horizontal info bar with all elements in one row
- **Mobile (≤768px)**: Stacked vertical layout with refresh button positioned top-right
- **Fluid Typography**: Uses `clamp()` for smooth scaling across viewport sizes
- **Adaptive Spacing**: Padding and gaps adjust based on screen size

#### Visual States
- **Loading**: Spinner animation with smooth fade-in
- **Loaded**: Smooth crossfade transition between images
- **Error**: Red-colored error text in post title area
- **Hover**: Subtle scale and opacity changes on interactive elements
- **Focus**: Visible outline on keyboard focus (keyboard users only)
- **Active**: Scale-down effect on button press for tactile feedback

### Key Features

- **Image Format Support**: Direct links, Reddit-hosted (i.redd.it), galleries (all images), previews. Only static images (.jpg, .jpeg, .png, .webp) are loaded; GIFs and videos are filtered out
- **Smart Filtering**: Automatically identifies and filters image-containing posts
- **Efficient Caching**: Minimizes API calls while ensuring fresh content
- **Gallery Extraction**: Extracts all images from gallery posts with position labels
- **CDN Prioritization**: Sorts images by source reliability for better success rates
- **Selective Preloading**: Preloads only slower images to save bandwidth
- **Retry Logic**: Automatically skips broken/failed images (up to 3 attempts)
- **Manual Refresh**: One-click button to load a new random image without refreshing the tab
- **Draggable Clock**: Reposition clock anywhere with drag, double-click to reset
- **Time Format Toggle**: Click time to switch between 12-hour (6:45 PM) and 24-hour (18:45) format
- **Keyboard Shortcuts**: Comprehensive shortcuts for navigation, input, settings, and info
- **NSFW Filtering**: Safe by default, optional toggle in UI button or keyboard shortcut
- **Image Info Display**: Shows resolution, score, post age, and author in persistent info tooltip
- **Blur Toggle**: Applies a subtle background blur for improved text readability, with persistent state
- **Request Throttling**: 400ms cooldown between image loads to prevent race conditions
- **Persistent Preferences**: Clock position, time format, NSFW setting, blur setting, and tooltip visibility saved across sessions
- **Refined Error Messages**: Accurate, tonally consistent messages with specific actionable guidance
- **Responsive UI**: Adaptive layout for mobile and desktop with fluid typography
- **Accessibility**: WCAG 2.1 AA compliant with ARIA labels, keyboard navigation, and motion preferences
- **Performance**: Background preloading, CSS transitions with will-change, crossfade animations
- **Modern Design**: Glassmorphism with backdrop blur, smooth transitions, and visual depth

### Storage

- **Sync Storage**: User preferences (subreddit name, clock position, time format, NSFW filter, blur setting, tooltip visibility)
- **Local Storage**: Image cache with metadata
  - Image URLs, titles, and permalinks
  - CDN priority scores for each image
  - Image metadata (author, score, post age, resolution)
  - Cache subreddit and timestamp
  - Typically ~15KB for 50 images

### Resource Usage

- **Storage**: ~15KB for URL cache (minimal overhead)
- **Memory**: Browser-managed image cache (~5-10MB temporary)
- **Bandwidth**: Optimized with selective preloading
  - Initial load: ~6MB (50 URLs + 5 preloaded images)
  - Subsequent sessions: Uses cached images when available
  - Saves ~3-4MB per session by skipping fast CDN preloads
- **CPU**: Negligible - browser handles image decoding

### Privacy & Security

- No tracking or analytics
- No external servers (except Reddit's public API)
- Content Security Policy enforced
- No data collection or transmission
- All data stored locally in browser


## Files

- `manifest.json` - Extension configuration for Chrome/Chromium browsers
- `manifest_firefox.json` - Extension configuration for Firefox
- `newtab.html` - New tab page structure
- `newtab.js` - Main application logic (cross-browser compatible)
- `resources/styles.css` - Responsive styles with accessibility features
- `resources/icon*.png` - Extension icons (16x16, 48x48, 128x128)
- `resources/screenshot.png` - Extension preview screenshot
- `README.md` - Documentation

## Privacy

- No data collection or tracking
- No external servers (only Reddit's public API)
- All data stored locally in browser
- Subreddit preference saved locally

## License

MIT
