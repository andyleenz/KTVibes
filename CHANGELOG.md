# Changelog

Notable changes to KTVibes. To get the latest version, see [Updating](README.md#updating).

## [Unreleased]

## [0.4.0] - 2026-10-05

### Added
- **Cheers.** The remote's 👏 🔥 🎉 💚 buttons float up the side of the TV, behind the lyrics.
- Between songs, the TV shows the next song as a card with its thumbnail and a countdown ring, with the two songs after it peeking out below.

### Changed
- **The remote is redesigned.** A now-playing card holds play, skip and cheers, and a bar at the bottom takes over once you scroll past it. Mix, key, speed and display settings open in a sheet that slides up, with an A cappella preset. Drag queue songs to reorder them, remove them with Undo, and watch each one's progress as a ring.
- In two-line mode, a new line slides up and fades in as the old one leaves. A long line split in two keeps its first half on screen until the second half is due.
- The TV's now-playing header is one line: title · artist. On wide screens the header and controls stay in the corners, and the idle screen's QR code is larger.
- The TV's fullscreen button is an icon at the bottom right, beside the remote button. The connection status only shows when the TV is disconnected.
- Messages say "device" instead of "TV", since any screen can play.

## [0.3.0] - 2026-10-04

### Added
- The TV's top and bottom bars and the mouse pointer hide after 3 seconds without mouse or keyboard activity.
- On screens wider than 1920 pixels, like a 4K display at 100% scaling, the TV's bars, title card and idle screen scale up with the screen.

### Changed
- Lyrics keep growing with the screen past 1920 pixels wide, and scrolling lyrics are a little larger on big screens.
- A two-line lyric too long for the screen is split into two shorter lines, each with its own turn, instead of wrapping or being squeezed.
- Two-line mode works more like a karaoke machine. A sung line stays highlighted until it is replaced, which happens once the next line has started and the sung line's last word has finished. Over an instrumental break the screen clears, then the next two lines come up together with a count-in. New lines appear without animating in, and sit a little lower on the screen.

### Fixed
- Two-line lyrics no longer jump when a line has no pronunciation guide, or when the last line of a song is on its own.

## [0.2.1] - 2026-10-04

### Changed
- Two-line lyrics are larger by default, closer to the size of scrolling lyrics.

## [0.2.0] - 2026-10-04

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
- Word timing no longer lets a line start highlighting while the previous one is still being sung. Lines are aligned in runs so the audio decides where each line ends, and more lines get word-level timing.
- Backing-vocal lines in brackets, like "(Caught in the undertow)", no longer push the lead line off screen early.
- A song that LRCLIB has no lyrics for, or that couldn't be word-timed, is no longer looked up again on every play.
- Titles like "Song [4K Upgrade] - Artist" and "Song - Artist (Lyrics) 🎵" are read correctly.
- The idle screen no longer shows the video of a song that failed to download.
- Missing ffmpeg or Node.js, and YouTube's bot check, are explained in plain words instead of "WinError 2". The Windows installer retries Node.js.

## [0.1.0] - 2026-10-03

First public release: YouTube search from a phone remote, AI vocal removal, synced lyrics with per-word timing, pronunciation guides (pinyin, jyutping, Korean romanization, romaji, Hangul), key and speed control, and one-line installers for Linux, macOS and Windows.

[Unreleased]: https://github.com/andyleenz/KTVibes/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/andyleenz/KTVibes/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/andyleenz/KTVibes/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/andyleenz/KTVibes/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/andyleenz/KTVibes/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andyleenz/KTVibes/releases/tag/v0.1.0
