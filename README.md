# KTVibes

An independently maintained fork of [KTVibes by Andrew Lee](https://github.com/andyleenz/KTVibes). This fork keeps the KTVibes name and MIT license. For features and instructions shared with the original project, see the [upstream README](https://github.com/andyleenz/KTVibes#readme).

### Japanese furigana alignment

Furigana stays aligned with its kanji as lyrics highlight during playback.

![Japanese karaoke lyrics with furigana aligned above the sung kanji](docs/screenshots/fork/fork-japanese-furigana.png)

### Mobile lyrics

Open a dedicated lyrics viewer from the phone remote. Search LRCLIB with parsed title terms or your own query, preview results, and choose synced or plain lyrics. Mark a song as having no suitable lyrics when lookup finds no match.

<img src="docs/screenshots/fork/fork-remote-queue-overview.gif" width="800" alt="Remote showing song search, Recent, playback controls, and Queue">

### Remote queue management

See each queued song's lyrics status, change the song order, insert a song to play next, and remove songs from the queue.

![Queue interactions: adding songs, reordering, and queue actions](docs/screenshots/fork/fork-queue-interactions.gif)

### Wide-screen remote

On wide screens, the remote uses a two-column layout for song lists and playback controls.

<img src="docs/screenshots/fork/fork-wide-screen-remote.gif" width="800" alt="KTVibes remote in a wide-screen two-column layout">

## Install this fork

### Windows

Download `KTVibes-Setup-x64.exe` from the [latest KTVibes release](https://github.com/JeffShih-wiwynn/KTVibes/releases/latest) and run it. The unsigned installer may trigger a Windows SmartScreen warning.

Choose an install folder during setup. The application, its private runtimes, songs, lyrics, queue and models are stored there. Reinstalling preserves `cache/`; uninstall asks whether to remove it.

### macOS and Linux

The installer requires Git, FFmpeg and Node.js 22 or later. It installs uv, clones this fork's `dev` branch into `~/KTVibes`, installs Python dependencies and adds a `ktvibes` command:

```bash
curl -LsSf https://raw.githubusercontent.com/JeffShih-wiwynn/KTVibes/dev/install.sh | bash
```

If you prefer to install from source:

```bash
git clone --branch dev https://github.com/JeffShih-wiwynn/KTVibes.git
cd KTVibes
uv sync
uv run ktvibes
```

## Updates

- **Windows:** Download and run the newer installer. It updates the application in the selected folder and keeps `cache/`.
- **macOS / Linux:** Stop KTVibes and run `ktvibes update`. Your songs, lyrics and queue remain in the cache.

## Upstream and license

This project is based on [andyleenz/KTVibes](https://github.com/andyleenz/KTVibes). The upstream MIT license and copyright notice are retained in [`LICENSE`](LICENSE). Changes in this fork are maintained independently.
