# Default theme redesign: TV, remote, live lyrics

2026-11-21 · built from the spikes on Andy's canvas, board `ktvibes-sound-off` (frames Player v2, Remote v1, Remote wide)

## Why

The Default theme should look like one finished product: frosted-glass cards, sentence-case labels, short factual status text, and a remote that copes with a big library. Keeping two full themes in step costs too much, so Classic gets hidden, not polished.

## Goals

- The TV player matches the Player v2 spike in every state: start, idle, preparing, queue, intro, singing, on-screen controls, guide, problems.
- The phone remote matches the Remote v1 spike, including the large-library and edge-case screens.
- On wider screens (tablet, foldable, laptop) the remote uses the two- and three-column layouts.
- On the remote, a full-screen live lyrics view highlights the lyrics word by word, like Spotify or Apple Music.

## Non-goals

- New Classic features, or restyling Classic. It stays reachable but frozen.
- New server features beyond the ones listed here: the Classic flag and one lyrics endpoint for the remote.
- Any change to the desktop launchers.

## Anti-goals

- Chatty copy. Use "Error preparing", not "Couldn't prepare this one".
- Busy TV overlays, or remote controls duplicated on the TV beyond the bar that exists today.
- ALL CAPS eyebrows.

## Decisions (the user's)

- **Classic:** stays selectable in the remote's Settings (the user changed their mind on the hidden flag, 2026-11-21). Not restyled, but it must not look broken.
- **Names:**
  - "Ready to sing" for prepared songs.
  - "Queue" on both the remote and the TV, never "Up next".
  - "More songs" for YouTube results, never "From YouTube".
- **Search placeholder:** English only, "Song or artist".
- **Copy:**
  - Matter of fact: "Preparing 42%", "Error preparing", "Queue empty", "No matches", "Added · #15".
  - Banners: "Reconnecting to TV…" and "TV sound off · click the TV to start".

## Approach

The work restyles the existing Default markup and JS in place, one surface at a time, on a new branch `redesign` taken from `fork-intake`, which already holds the new start screen. Each surface is its own commit:

1. **Classic flag.**
   - Setting `KTVIBES_CLASSIC=1` exposes `classic: true` in `/api/config`.
   - The remote shows the Theme section only when the flag is on.
   - With the flag off, the server refuses `theme=classic`, and a saved Classic state loads as Default.
2. **TV player.**
   - Changes go in `tv.html`, `style.css` and `tv.js`.
   - Glass cards, a "Queue" card with an "Add a song" QR row, title over artist, "Preparing 42%", the reconnecting toast.
3. **Phone remote.**
   - Changes go in `remote.html`, `remote.css` and `remote.js`.
   - **Home:** the now-singing card, then the Queue, then Ready to sing (a few songs, Recent / A–Z chips, "See all N").
   - **Library:** a full screen with a filter box, letter headers and an A–Z rail.
   - **Queue states:**
     - Rows show "In queue · N" chips.
     - Queue rows have drag handles, using the existing `reorder` action.
     - A failed song shows Error preparing with Retry, using the existing `retry` action.
     - Long queues show "Show N more".
   - **Banners:** TV offline and TV sound off, driven by the existing `player_connected` and `player_audio` state.
   - **Paused** appears on the now-singing card.
   - **After adding a song:** a toast reading "Added · #N", with Undo using the existing `undo` action.
   - **Search:** Ready to sing matches, filtered on the phone, sit above More songs. More songs shows loading rows, and a no-matches or offline state.
4. **Wider remote.**
   - Breakpoints are set on the remote's own width: under 600px, one column; 600–1000px, two columns; over 1000px, three columns with settings always open.
5. **Live lyrics view.**
   - A lyrics button on the now-singing card opens a full-screen view.
   - The lyrics come from a new `GET /api/current/lyrics`, which returns `state.current["lyrics"]` with its `key` and `lyrics_rev`.
     - The broadcast strips the lyrics for everyone but the TV, and `/api/songs/{id}/lyrics` serves the lyrics picker, so neither one works for this.
     - The remote fetches the lyrics again whenever `current.key` or `lyrics_rev` changes.
     - Each line's `units` already carry start and end times per word or character, from forced alignment or the vocal-energy spread, so every line can be highlighted word by word.
   - The playback position comes from `state.position` and is projected forward between updates while playing.
   - The current line scrolls into place. Sung words are solid, the current word fills left to right, and words still to come are dimmed.

### Other approaches considered

- **Delete Classic.** It would be simplest to maintain, but the user wants to keep it.
- **Rewrite the remote as a new page.** That loses the tested behaviour in `remote.js`, such as the suggestions and the sheet. Restyling in place keeps it.

## My calls (correct any)

- **Classic is frozen.**
  - Its CSS sits on top of the Default markup, so the restyle may leave it looking off.
  - I will keep it working: it loads, plays and takes keypad input. I will not keep it pixel-perfect.
- **"Most sung" is left out for now.**
  - The server tracks only when each song was last played, not how many times.
  - Recent and A–Z cover the large library. Most sung can come later with a play count.
- **The library reuses `/api/songbook`,** which already lists every prepared song. No new endpoint.
- **Tests:**
  - pytest covers the Classic flag on the server.
  - Each UI state gets checked in the browser against its canvas screen.
  - The work ends with a code review of the branch.

- **The Classic flag when it's off:**
  - The `theme` action raises, so the remote shows an error toast.
  - A saved `theme: classic` loads as Default, with `room_ends` cleared.
  - The room-time and score-hold paths already depend on `theme == classic`, so they go quiet on their own.
  - The classic files still load. Their rules are scoped to `[data-theme=classic]`.
- **Song menus:**
  - Tapping a queue row opens Play next, Move to the end (`reorder` to the last place), Wrong lyrics or language (today's lyrics picker under a new name) and Remove from queue.
  - The `•••` on a Ready to sing song opens Play next, Wrong lyrics or language and Delete download. Delete download is kept.
- **The library and Recent:**
  - Every prepared song gets a songbook number, both when it is prepared and through the backfill, so `/api/songbook` is the complete library.
  - "Recent" sorts by the later of last sung and prepared, so a fresh download shows up straight away.
- **What the lyrics view shows:**
  - Plain lyric lines in v1. Reading guides such as ruby and romanization stay on the TV.
  - It still shows when the TV's lyrics are set to Off, because it is a personal view.
  - It applies the TV's timing offset.

## Left to the builder

Exact spacing and type sizes follow the spike CSS (`dist/spike/build*.py`). Animation timings and the drag interaction details are also the builder's choice.
