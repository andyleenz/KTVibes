# Changelog

Notable changes to KTVibes. To get the latest version, see [Updating](README.md#updating).

## [Unreleased]

### Added
- **Two-line karaoke lyrics**, now the default: lines take turns top-left and bottom-right, like a KTV machine. The line just sung stays up for a moment before the next one replaces it. Long lines are squeezed sideways instead of wrapping. Scrolling lyrics are still available, or lyrics can be turned off.
- **Blur or hide the music video** from the remote. Blur is handy for lyric videos, whose own lyrics clash with KTVibes'.
- **Search lyrics by hand** from the remote's lyrics sheet, when none were found or the wrong song came up.
- **`ktvibes update`** pulls the latest version.
- `KTVIBES_COOKIES_FROM_BROWSER` uses a signed-in browser's YouTube cookies, for when YouTube asks to "confirm you're not a bot".
- `KTVIBES_VIDEO_HEIGHT` sets the highest music video resolution to download.

### Changed
- **Songs take about a quarter of the space** (about 30 MB instead of 115 MB): separated tracks are stored as Opus, and videos download at up to 720p by default. Songs cached by older versions convert the next time they are queued.
- The remote's controls are grouped by how often they're used. Song position, Vocals and Music stay pinned at the top of the panel, and the panel fits better on phones.
- The title card at the start of each song is larger and centered.
- Lyric size goes up to 250%.
- A TV or remote left open across an update reloads itself.

### Fixed
- Backing-vocal lines in brackets, like "(Caught in the undertow)", no longer push the lead line off screen early.
- A song that LRCLIB has no lyrics for, or that couldn't be word-timed, is no longer looked up again on every play.
- Titles like "Song [4K Upgrade] - Artist" and "Song - Artist (Lyrics) 🎵" are read correctly.
- The idle screen no longer shows the video of a song that failed to download.
- Missing ffmpeg or Node.js, and YouTube's bot check, are explained in plain words instead of "WinError 2". The Windows installer retries Node.js.

## [0.1.0] - 2026-10-03

First public release: YouTube search from a phone remote, AI vocal removal, synced lyrics with per-word timing, pronunciation guides (pinyin, jyutping, Korean romanization, romaji, Hangul), key and speed control, and one-line installers for Linux, macOS and Windows.

[Unreleased]: https://github.com/andyleenz/KTVibes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andyleenz/KTVibes/releases/tag/v0.1.0
