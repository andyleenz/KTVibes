# Code structure

The Python application and browser pages keep their existing entry points and URLs.
There is no frontend build step. Both installers recursively copy `ktvibes/` and
`static/`, including the modules described here.

## Server

- `ktvibes/main.py` provides `ktvibes.main:app`, the `ktvibes` CLI and the source updater.
- `application.create_app(runtime)` builds FastAPI, installs route groups and manages
  the worker, update checker and outstanding lyrics lookup tasks during shutdown.
- `runtime.Runtime` owns one application's playback `State`, cache/root paths,
  port, song library, lyrics service and release checker. Tests create a fresh
  runtime and app instead of replacing production globals.
- `routes/` groups HTTP/WebSocket handlers into system, playback, catalog and lyrics.
  Routers receive their runtime or lyrics service; none imports `main.py`.
- `lyric_service.LyricsService` coordinates lyrics viewing and selection, including
  lookup deduplication, selection races and cache locking. `lyrics.py` remains
  responsible for LRCLIB access and text processing.
- `library.SongLibrary` reads prepared song metadata. `updates.ReleaseUpdates`
  checks GitHub releases and owns the result for its application.
- `queue.State`, `worker` and the audio/language modules retain their existing roles.
  Queue snapshots, cache filenames and HTTP/WebSocket message formats are unchanged.

Use the same `State` instance for the lifetime of a runtime: mutate its queue and
playback properties rather than replacing the instance. Route validation lives
in the router functions and the request models in `schemas.py`.

## Browser

- `remote.js` coordinates incoming state, playback/settings, search and Recent.
- `remote-status.js` owns the status label, version polling and update popover.
- `remote-lyrics.js` owns the reader/picker panel and follows current-song changes.
- `remote-queue.js` owns queue rows, pagination, drag ordering and swipe actions.
- `swipe-state.js` coordinates the single revealed swipe row across Recent and Queue.
- `shared.connect(role, callbacks)` handles WebSocket messages and reconnection.
  It reports open/close events; Remote and TV render their own connection status.

The queue and lyrics modules receive a current-state getter so asynchronous work
and gestures read the latest snapshot. Queue reordering can update that snapshot
optimistically through its supplied setter.

See [Testing](testing.md) for validation commands and the limits of fixture-based
browser checks. The current suite does not prove real media preparation, audio
synchronization or installer behavior on every machine.
