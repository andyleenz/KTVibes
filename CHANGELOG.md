# Changelog

Notable changes to KTVibes. To get the latest version, see [Updating](README.md#updating).

## [Unreleased]

### Fixed
- Lyrics no longer drift later and later through a song that starts singing in its first half second (Love The Way You Lie (Part II) ended up nearly 15 seconds late).
- Lyrics follow music videos more reliably. Where a video cuts or lengthens a break, the sections after it are now moved together, so a short bridge right after the edit moves with them, and one misleading section can no longer pull the rest of the song off.
- Lyrics find their place after a music-video intro longer than 30 seconds (Adele's Hello talks for over a minute first).
- Songs re-time their lyrics the next time they play.

## [0.6.1] - 2026-10-07

### Changed
- In Classic, the score shows for 5 seconds instead of 3, on a fully opaque background.

### Fixed
- The Classic TV follows browser zoom and no longer grows oversized on tall windows; its keys no longer overlap the fullscreen and remote buttons.
- The Classic TV fits portrait and narrow windows: the bottom strip stacks its keys, and the title card stays clear of it.

## [0.6.0] - 2026-10-07

### Added
- A Classic theme in the style of a Korean noraebang, chosen at the bottom of the remote's Settings. The TV and remote switch to navy and yellow; the TV gets a top strip with the song's number, title and a room clock; two-line lyrics alternate left and right with a blue wipe; and a score from 60 to 100 shows after each song.
- Classic rooms start with 30 minutes. Add time from Settings on the remote; when time runs out, the current song finishes and the next waits.
- Every downloaded song gets a songbook number. In Classic, the remote is a handset with four tabs: 리모컨 (a keypad that reserves by number, with 우선예약 to sing next), 노래책 (the songbook: 신곡, 최근 and A–Z with jump tabs; typing filters it), 예약 (the queue as an LCD table with 우선, 취소 and 재시도) and 설정. Dialled digits show on the TV's top strip.
- In Classic, the TV shows a 예약곡 board between songs, a small QR code during songs, and a machine-style boot screen before sound is enabled. The theme can also be picked on the TV's Enable sound screen, in either theme.
- In Classic, the score shows only when a song is sung to the end (not when it's skipped), as soon as its music stops, for 3 seconds before the 예약곡 board.
- In Classic, 👏 is the remote's only cheer.
- The TV and remote pages show the KT icon in browser tabs, and when the remote is added to a phone's home screen.

### Fixed
- Messages on the remote show above the lyrics picker instead of behind it.
- If the TV loses its connection just as a song ends, it tells the server again when it reconnects, so the room moves on to the next song.

## [0.5.0] - 2026-10-05

### Fixed
- Lyrics stay in sync with music videos that cut or lengthen an instrumental break. Each section between breaks is now matched to the vocals on its own, so lines after the edit no longer run early (Coldplay's Fix You was off by about 7 seconds after the first chorus). The whole-song shift also no longer mistakes a line-early fit for the right one on evenly paced songs. Cached songs re-time once on their next play.
- In two-line mode, resizing the window no longer replays the lyrics' slide-in.
- Romanization over Hangul and other guides has a little more room above the lyric.
- The up-next card no longer runs under the QR code in small windows, and gives a long title more room.

### Changed
- Lyrics default to 150%. Scroll mode at that size shows the line before and after the one being sung.
- With a music video, two-line lyrics sit lower, nearer the bottom of the screen.
- The remote's settings sheet is called **Settings**, and the bottom bar has a Settings button. The bar's queue button is an icon with the count, so song titles get more room.

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

[Unreleased]: https://github.com/andyleenz/KTVibes/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/andyleenz/KTVibes/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/andyleenz/KTVibes/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/andyleenz/KTVibes/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/andyleenz/KTVibes/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/andyleenz/KTVibes/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/andyleenz/KTVibes/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/andyleenz/KTVibes/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andyleenz/KTVibes/releases/tag/v0.1.0
