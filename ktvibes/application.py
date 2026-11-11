"""Build the web application and own its background task lifetimes."""
import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from . import songbook, stems, worker
from .runtime import Runtime
from .routes import catalog, lyrics, playback, system


def create_app(runtime: Runtime | None = None) -> FastAPI:
    runtime = runtime if runtime is not None else Runtime()

    @asynccontextmanager
    async def lifespan(app):
        runtime.cache.mkdir(parents=True, exist_ok=True)
        runtime.state.build = runtime.build()
        await asyncio.to_thread(songbook.backfill, runtime.cache, stems.prepared)
        runtime.state.restore(runtime.cache / 'queue.json', seed=lambda: {
            video_id: meta['prepared'] for video_id, meta in runtime.library.prepared_songs().items()
        })
        tasks = [asyncio.create_task(worker.run(runtime.state, runtime.cache)),
                 asyncio.create_task(runtime.updates.run())]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with suppress(asyncio.CancelledError):
                    await task
            await runtime.lyrics.close()

    app = FastAPI(title='KTVibes', lifespan=lifespan)
    app.state.runtime = runtime
    app.mount('/static', StaticFiles(directory=runtime.root / 'static'), name='static')

    @app.middleware('http')
    async def revalidate_static(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(('/static/', '/media/')) or request.url.path in ('/', '/tv', '/remote'):
            response.headers['Cache-Control'] = 'no-cache'
        return response

    app.include_router(system.create_router(runtime))
    from .routes import identities
    app.include_router(identities.create_router(runtime))
    app.include_router(playback.create_router(runtime))
    app.include_router(catalog.create_router(runtime))
    app.include_router(lyrics.create_router(runtime.lyrics))
    return app
