# Reddit Wallpaper New Tab

A Chrome extension that replaces your new tab page with images from Reddit.

![Screenshot](screenshot.png)

## Installation

1. Open `chrome://extensions/` in Chrome
2. Turn on "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select this folder
4. Open a new tab

## Usage

The extension shows a different image each time you open a new tab.

**Change the subreddit:**
- Click on the subreddit name at the bottom left (defaults to "CineShots")
- Type a new subreddit name
- Press Enter

**View the Reddit post:**
- Click on the image title at the bottom to open the original Reddit post in a new tab

**Good subreddits to try:**
- CineShots (movie screenshots)
- EarthPorn (nature photos)
- wallpapers
- spaceporn
- CityPorn
- ArchitecturePorn

## How it works

The extension fetches 50 images at a time from Reddit and caches them locally. This means:
- Your first tab might take a second to load
- The next 45+ tabs load instantly
- No rate limiting issues
- Minimal API calls

When the cache runs low (< 5 images), it automatically fetches another batch.

## Troubleshooting

**No images showing up?**
- Check your internet connection
- Make sure the subreddit name is correct (no "r/" prefix)
- Try a different subreddit like "CineShots"

**Extension not working?**
- Make sure it's enabled in `chrome://extensions/`
- Click the reload button on the extension card
- Check the browser console (F12) for errors

## Technical details

- Built with vanilla JavaScript
- Uses Reddit's public JSON API
- Caches images in Chrome's local storage
- Extracts image URLs and Reddit permalinks from posts
- No tracking or analytics


## Files

- `manifest.json` - Extension config
- `newtab.html` - New tab page
- `newtab.js` - Main logic
- `styles.css` - Styles
- `icon*.png` - Icons
- `README.md` - This file

## Privacy

This extension:
- Doesn't collect any data
- Doesn't send anything to external servers
- Only fetches images from Reddit's public API
- Stores your subreddit preference locally

## License

MIT
