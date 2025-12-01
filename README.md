# Reddit Wallpaper New Tab

A Chrome extension that replaces your new tab page with images from Reddit.

![Screenshot](screenshot.png)

## Installation

1. Open `chrome://extensions/` in Chrome
2. Turn on "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select this folder
4. Open a new tab

## Usage

Shows a different image each time you open a new tab.

**Change the subreddit:**
- Click on the subreddit name at the bottom left (defaults to "CineShots")
- Type a new subreddit name
- Press Enter

**View the Reddit post:**
- Click on the image title at the bottom to open the original Reddit post in a new tab

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
- Gallery posts (uses first image)
- Preview images from Reddit's preview system

All extracted images include CDN priority scoring for optimal loading performance.

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
- **Caching Strategy**: Batch fetching (50 images) with automatic refill when cache drops below 5 images
- **CDN Prioritization**: Images sorted by source reliability (i.redd.it → imgur → external)
- **Smart Preloading**: Selective background preloading of slower images only
- **Error Handling**: Automatic retry mechanism with up to 3 attempts for failed image loads
- **State Management**: Uses Chrome Storage API (sync for settings, local for cache)
- **User-Friendly Messages**: Context-aware error messages with actionable suggestions

### Technologies

- Vanilla JavaScript (no frameworks or dependencies)
- Chrome Extension Manifest V3
- Reddit's public JSON API (no authentication required)
- Chrome Storage API for persistent data
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

### Key Features

- **Image Format Support**: Direct links, Reddit-hosted (i.redd.it), galleries, previews
- **Smart Filtering**: Automatically identifies and filters image-containing posts
- **Efficient Caching**: Minimizes API calls while ensuring fresh content
- **CDN Prioritization**: Sorts images by source reliability for better success rates
- **Selective Preloading**: Preloads only slower images to save bandwidth
- **Retry Logic**: Automatically skips broken/failed images (up to 3 attempts)
- **Responsive UI**: Adaptive layout for mobile and desktop
- **Accessibility**: ARIA labels, semantic HTML, keyboard navigation support
- **Performance**: Background preloading, CSS transitions with will-change
- **Error Styling**: Red-colored error messages for immediate visibility
- **Context-Aware Errors**: Specific error messages based on failure type (404, 403, network, etc.)

### Storage

- **Sync Storage**: User preferences (subreddit name)
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

- `manifest.json` - Extension configuration and permissions
- `newtab.html` - New tab page structure
- `newtab.js` - Main application logic (modular architecture)
- `styles.css` - Responsive styles with accessibility features
- `icon*.png` - Extension icons (16x16, 48x48, 128x128)
- `README.md` - Documentation

## Privacy

- No data collection or tracking
- No external servers (only Reddit's public API)
- All data stored locally in browser
- Subreddit preference saved locally

## License

MIT
