from fastapi import APIRouter, Query
from ..schemas import LyricChoice, OffsetChoice


def create_router(service):
    router = APIRouter()

    @router.get('/api/lyrics/view/{target_key}')
    async def lyrics_view(target_key: str):
        'Read cached synced lyrics or an independently cached LRCLIB plain-lyrics fallback.'
        return await service.lyrics_view(target_key)

    @router.get('/api/songs/{video_id}/lyrics')
    async def lyric_options(video_id: str, q: str=Query('', max_length=200)):
        'Every LRCLIB version that fits the song, best first, so the remote can pick a language or edition.\n    With `q`, a free-text search instead, for songs the automatic lookup missed or got wrong.'
        return await service.lyric_options(video_id, q)

    @router.get('/api/lyrics/choices/{target_key}')
    async def lyric_choices(target_key: str, q: str=Query(min_length=1, max_length=200)):
        'Mixed-format manual search; the legacy song lyrics endpoint remains synced-only.'
        return await service.lyric_choices(target_key, q)

    @router.post('/api/lyrics/unavailable/{target_key}')
    async def mark_lyrics_unavailable(target_key: str):
        'Remember that no currently suitable lyrics should be shown for this song.'
        return await service.mark_lyrics_unavailable(target_key)

    @router.post('/api/lyrics/plain/{target_key}')
    async def choose_plain_lyrics(target_key: str, choice: LyricChoice):
        'Persist a Viewer-only fallback without touching synced lyrics or playback state.'
        return await service.choose_plain_lyrics(target_key, choice)

    @router.post('/api/songs/{video_id}/lyrics')
    async def choose_lyrics(video_id: str, choice: LyricChoice):
        'Save the chosen version; a current song switches immediately.'
        return await service.choose_lyrics(video_id, choice)

    @router.get('/api/queue/{queue_key}/lyrics')
    async def queued_lyrics(queue_key: str):
        return await service.queued_lyrics(queue_key)

    @router.post('/api/queue/{queue_key}/lyrics')
    async def choose_queued_lyrics(queue_key: str, choice: LyricChoice):
        return await service.choose_queued_lyrics(queue_key, choice)

    @router.patch('/api/queue/{queue_key}/offset')
    async def set_queued_offset(queue_key: str, choice: OffsetChoice):
        return await service.set_queued_offset(queue_key, choice)

    return router
