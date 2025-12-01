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

Includes intelligent retry logic:
- If an image fails to load (broken URL, CORS issue, deleted content), automatically tries the next image
- Up to 3 automatic retries to handle transient failures
- Prevents infinite loops by using different images from cache
- Only shows error if multiple consecutive images fail

### Image Extraction

Can extract images from multiple Reddit post formats:
- Direct image links (imgur, external hosts)
- Reddit-hosted images (i.redd.it)
- Gallery posts (extracts all images with position indicators)
- Preview images from Reddit's preview system

All extracted images include CDN priority scoring for optimal loading performance.

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

- **Modular Design**: Code organized into logical modules (Storage, Settings, ImageExtractor, RedditAPI, ImageCache, UI, App)
- **Cross-Browser Support**: Compatible with Chrome, Firefox, Edge, Brave, Opera
- **Caching Strategy**: Batch fetching (50 posts) with automatic refill when cache drops below 5 images
- **Gallery Support**: Extracts all images from gallery posts (not just the first one)
- **CDN Prioritization**: Images sorted by source reliability (i.redd.it → imgur → external)
- **Smart Preloading**: Selective background preloading of slower images only
- **Error Handling**: Automatic retry mechanism with up to 3 attempts for failed image loads
- **State Management**: Uses Browser Storage API (sync for settings, local for cache)
- **User-Friendly Messages**: Context-aware error messages with actionable suggestions
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
- **Refresh Button**: Manual image refresh with animated icon rotation on hover
- **Loading Indicator**: Subtle spinner appears during image loads (same position as refresh button)
- **Subreddit Input**: Inline editable field with hover/focus states
- **Post Title Link**: Clickable title to view original Reddit post
- **Error Messages**: Color-coded red text with user-friendly descriptions
- **Draggable Clock**: Click and drag to reposition anywhere on screen, persists across sessions
- **Clock Reset**: Double-click clock to return to default center position
- **Time Format Toggle**: Click time to switch between 12-hour and 24-hour formats

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

- **Image Format Support**: Direct links, Reddit-hosted (i.redd.it), galleries (all images), previews
- **Smart Filtering**: Automatically identifies and filters image-containing posts
- **Efficient Caching**: Minimizes API calls while ensuring fresh content
- **Gallery Extraction**: Extracts all images from gallery posts with position labels
- **CDN Prioritization**: Sorts images by source reliability for better success rates
- **Selective Preloading**: Preloads only slower images to save bandwidth
- **Retry Logic**: Automatically skips broken/failed images (up to 3 attempts)
- **Manual Refresh**: One-click button to load a new random image without refreshing the tab
- **Draggable Clock**: Reposition clock anywhere with drag, double-click to reset
- **Time Format Toggle**: Click time to switch between 12-hour (6:45 PM) and 24-hour (18:45) format
- **Persistent Preferences**: Clock position and time format saved across sessions
- **Responsive UI**: Adaptive layout for mobile and desktop with fluid typography
- **Accessibility**: WCAG 2.1 AA compliant with ARIA labels, keyboard navigation, and motion preferences
- **Performance**: Background preloading, CSS transitions with will-change, crossfade animations
- **Error Styling**: Red-colored error messages for immediate visibility
- **Context-Aware Errors**: Specific error messages based on failure type (404, 403, network, etc.)
- **Modern Design**: Glassmorphism with backdrop blur, smooth transitions, and visual depth

### Storage

- **Sync Storage**: User preferences (subreddit name, clock position, time format)
- **Local Storage**: Image cache with metadata
  - Image URLs, titles, and permalinks
  - CDN priority scores for each image
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
