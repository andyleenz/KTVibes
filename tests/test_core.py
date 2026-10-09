import asyncio
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import unittest.mock
from ktvibes.lyrics import parse_lrc
from ktvibes.youtube import is_music, parse_title
from ktvibes.queue import State

class LyricsTests(unittest.TestCase):
    def test_unicode_multistamp_and_offset(self):
        self.assertEqual(parse_lrc('[ar:周杰倫]\n[offset:-500]\n[00:02.50][00:04.000]你好 안녕\n[00:01.00]'),
                         [{'t': .5, 'text': ''}, {'t': 2.0, 'text': '你好 안녕'}, {'t': 3.5, 'text': '你好 안녕'}])

    def test_title_metadata_preserves_original_script(self):
        self.assertEqual(parse_title('周杰倫 - 晴天 (Official MV)'), {'artist': '周杰倫', 'title': '晴天'})
        self.assertEqual(parse_title('아이유 - 좋은 날 (Official Audio)'), {'artist': '아이유', 'title': '좋은 날'})
        self.assertEqual(parse_title('周杰倫 Jay Chou【晴天 Sunny Day】-Official Music Video'), {'artist': '周杰倫 Jay Chou', 'title': '晴天 Sunny Day'})
        self.assertEqual(parse_title('봄날', '방탄소년단 - Topic'), {'artist': '방탄소년단', 'title': '봄날'})
        self.assertEqual(parse_title('卓文萱 Genie Chuo&曹格 Gary Chaw【梁山伯與茱麗葉】華視偶像劇「戀愛女王」片尾曲', '滾石唱片 ROCK RECORDS'),
                         {'artist': '卓文萱 Genie Chuo&曹格 Gary Chaw', 'title': '梁山伯與茱麗葉'})
        # "Song - Artist" on the artist's own channel, with a remaster tag
        self.assertEqual(parse_title('Numb (Official Music Video) [4K UPGRADE] – Linkin Park', 'Linkin Park'), {'artist': 'Linkin Park', 'title': 'Numb'})
        self.assertEqual(parse_title('Adele - Hello', 'AdeleVEVO'), {'artist': 'Adele', 'title': 'Hello'})
        self.assertEqual(parse_title('Simple Plan - Perfect // Lyrics'), {'artist': 'Simple Plan', 'title': 'Perfect'})
        self.assertEqual(parse_title('Simple Plan - Perfect (Lyrics) 🎵'), {'artist': 'Simple Plan', 'title': 'Perfect'})

class YouTubeErrorTests(unittest.TestCase):
    def test_bot_check_is_explained(self):
        from ktvibes import youtube
        error = Exception("ERROR: [youtube] kXYiU_JCYtU: Sign in to confirm you’re not a bot. Use --cookies-from-browser")
        self.assertIn('KTVIBES_COOKIES_FROM_BROWSER', youtube.explain(error))
        self.assertEqual(youtube.explain(Exception('HTTP Error 404')), 'HTTP Error 404')
        with unittest.mock.patch.dict('os.environ', {'KTVIBES_COOKIES_FROM_BROWSER': 'firefox'}):
            self.assertEqual(youtube.base_options()['cookiesfrombrowser'], ('firefox',))

class MusicFilterTests(unittest.TestCase):
    def test_keeps_songs_and_drops_other_videos(self):
        self.assertTrue(is_music('BTS - Dynamite (Official MV)', 223))
        self.assertTrue(is_music('晴天', None))
        for title in ('BTS Dynamite Reaction!!', 'Dynamite Dance Practice', 'Dynamite (Instrumental)', 'Pink Venom #shorts'):
            self.assertFalse(is_music(title, 200), title)
        self.assertFalse(is_music('周杰倫最好聽的20首歌曲', 4000))
        self.assertFalse(is_music('Intro', 30))

class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_guide_cycles_only_through_modes_with_content(self):
        state = State()
        a = await state.add('abcdefghijk', 'IU', '좋은 날')
        a['status'], a['duration'] = 'ready', 100
        a['lyrics'] = [{'t': 0, 'text': '좋은', 'units': [['좋', 0, 1, 'jo', ''], ['은', 1, 2, 'eun', '']]}]
        state.promote()
        self.assertEqual(state.guides(), ['off', 'latin'])
        await state.control({'action': 'guide', 'value': 'cycle'})
        self.assertEqual(state.guide, 'off')
        await state.control({'action': 'guide', 'value': 'cycle'})
        self.assertEqual(state.guide, 'latin')
        with self.assertRaises(ValueError):
            await state.control({'action': 'guide', 'value': 'klingon'})
        state.guide = 'hangul'  # a mode this Korean song has nothing for
        await state.control({'action': 'guide', 'value': 'cycle'})
        self.assertEqual(state.guide, 'latin')

    async def test_breather_only_between_songs(self):
        import time
        state = State()
        first = await state.add('abcdefghijk', 'A', 'First')
        first['status'] = 'ready'
        state.promote()
        # From an empty stage the song starts at once; its intro carries the title card.
        self.assertLessEqual(state.transition_until, time.time())
        second = await state.add('bbbbbbbbbbb', 'B', 'Second')
        second['status'] = 'ready'
        await state.control({'action': 'skip'})
        self.assertIs(state.current, second)
        self.assertAlmostEqual(state.transition_until - time.time(), 4, delta=0.5)
        # A song that was still preparing when the last one ended starts without a pause once ready.
        await state.control({'action': 'skip'})
        third = await state.add('ccccccccccc', 'C', 'Third')
        state.transition_until = 0
        third['status'] = 'ready'
        state.promote()
        self.assertLessEqual(state.transition_until, time.time())

    async def test_classic_breather_leaves_room_for_the_score(self):
        import time
        state = State()
        await state.control({'action': 'theme', 'value': 'classic'})
        songs = []
        for vid in ('abcdefghijk', 'bbbbbbbbbbb', 'ccccccccccc'):
            song = await state.add(vid, 'A', vid)
            song['status'] = 'ready'
            songs.append(song)
        state.promote()
        # A song sung to the end: the score (5 s) shows, then the 예약곡 board (4 s).
        await state.control({'action': 'ended', 'key': songs[0]['key']})
        self.assertIs(state.current, songs[1])
        self.assertAlmostEqual(state.transition_until - time.time(), 9, delta=0.5)
        # A skipped song gets no score, so only the board.
        await state.control({'action': 'skip'})
        self.assertAlmostEqual(state.transition_until - time.time(), 4, delta=0.5)

    async def test_seek_and_lyric_scale_are_clamped(self):
        state = State()
        with self.assertRaises(ValueError):
            await state.control({'action': 'seek', 'position': 5})
        a = await state.add('abcdefghijk', 'A', 'First')
        a['status'], a['duration'] = 'ready', 100
        state.promote()
        await state.control({'action': 'seek', 'position': 500})
        self.assertEqual((state.position, state.seek_id), (100, 1))
        await state.control({'action': 'lyric_scale', 'value': 9})
        self.assertEqual(state.lyric_scale, 2.5)
        await state.control({'action': 'music', 'value': -1})
        self.assertEqual(state.music, 0)
        await state.control({'action': 'speed', 'value': 3})
        self.assertEqual(state.speed, 1.5)
        await state.control({'action': 'key', 'value': -9})
        self.assertEqual(state.key, -6)

    async def test_display_settings_take_known_values_or_cycle(self):
        state = State()
        await state.control({'action': 'video_mode', 'value': 'blur'})
        await state.control({'action': 'lyric_mode', 'value': 'two'})
        self.assertEqual((state.video_mode, state.lyric_mode), ('blur', 'two'))
        await state.control({'action': 'video_mode', 'value': 'cycle'})
        self.assertEqual(state.video_mode, 'hide')
        with self.assertRaises(ValueError):
            await state.control({'action': 'lyric_mode', 'value': 'sideways'})
        self.assertEqual(state.snapshot()['lyric_mode'], 'two')

    async def test_duplicates_rejected_until_song_leaves_stage(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        with self.assertRaises(ValueError):
            await state.add('abcdefghijk', 'A', 'Again')
        a['status'] = 'ready'
        state.promote()
        self.assertIs(state.current, a)
        self.assertIn('abcdefghijk', state.played)
        await state.control({'action': 'offset', 'delta': .5})
        await state.control({'action': 'skip'})
        self.assertIsNone(state.current)
        self.assertEqual(state.offset, 0)
        b = await state.add('abcdefghijk', 'A', 'Encore')
        self.assertNotEqual(a['key'], b['key'])

    async def test_queue_and_history_survive_restart(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'queue.json'
            state = State()
            state.restore(path, seed=lambda: {'zzzzzzzzzzz': 1.0})
            self.assertEqual(state.played, {'zzzzzzzzzzz': 1.0})
            a = await state.add('abcdefghijk', '周杰倫', '晴天')
            await state.add('12345678901', '아이유', '좋은 날')
            a['status'] = 'ready'
            state.promote()
            await state.control({'action': 'seek', 'position': 0})
            state.position = 42.5
            await state.broadcast()
            again = State()
            again.restore(path, seed=lambda: self.fail('history should come from the file'))
            self.assertEqual([(i['id'], i['title'], i['status']) for i in again.upcoming],
                             [('abcdefghijk', '晴天', 'queued'), ('12345678901', '좋은 날', 'queued')])
            again.upcoming[0]['status'] = 'ready'
            again.promote()
            self.assertEqual(again.current['title'], '晴天')
            self.assertEqual(again.position, 42.5)
            self.assertIn('zzzzzzzzzzz', again.played)

    async def test_order_waits_for_first_and_skips_error(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        b = await state.add('12345678901', 'B', 'Second')
        b['status'] = 'ready'
        state.promote()
        self.assertIsNone(state.current)
        a['status'] = 'error'
        state.promote()
        self.assertIs(state.current, b)
        self.assertEqual(state.upcoming, [a])

    async def test_removed_inflight_item_cannot_return(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        a['status'] = 'separating'
        await state.control({'action': 'remove', 'key': a['key']})
        a['status'] = 'ready'
        state.promote()
        self.assertIsNone(state.current)

    async def test_stale_ended_and_wrong_player_do_not_advance(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        a['status'] = 'ready'
        state.promote()
        state.player = object()
        await state.control({'action': 'ended', 'key': a['key']}, object())
        await state.control({'action': 'ended', 'key': 'stale'}, state.player)
        self.assertIs(state.current, a)
        await state.control({'action': 'ended', 'key': a['key']}, state.player)
        self.assertIsNone(state.current)

    async def test_reorder_requires_current_members(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        b = await state.add('12345678901', 'B', 'Second')
        with self.assertRaises(ValueError):
            await state.control({'action': 'reorder', 'keys': [a['key'], a['key']]})
        await state.control({'action': 'reorder', 'keys': [b['key'], a['key']]})
        self.assertEqual(state.upcoming, [b, a])

    async def test_removal_can_be_undone_in_place(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        b = await state.add('12345678901', 'B', 'Second')
        await state.control({'action': 'remove', 'key': a['key']})
        self.assertEqual(state.undo['item']['title'], 'First')
        await state.control({'action': 'undo'})
        self.assertEqual(state.upcoming, [a, b])
        with self.assertRaises(ValueError):
            await state.control({'action': 'undo'})
        await state.control({'action': 'remove', 'key': a['key']})
        await state.add('abcdefghijk', 'A', 'Again')
        with self.assertRaises(ValueError):  # the song was queued again meanwhile
            await state.control({'action': 'undo'})

    async def test_failed_song_can_be_retried(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        a['status'], a['error'] = 'error', 'HTTP 403'
        await state.control({'action': 'retry', 'key': a['key']})
        self.assertEqual((a['status'], a['error']), ('queued', None))

    async def test_lyrics_go_to_each_tv_once_per_song(self):
        class Socket:
            def __init__(self):
                self.sent = []
            async def send_json(self, message):
                self.sent.append(message)
        state = State()
        tv, remote = Socket(), Socket()
        state.clients = {tv: 'tv', remote: 'remote'}
        state.player = tv
        a = await state.add('abcdefghijk', 'A', 'First')
        a['status'], a['lyrics'] = 'ready', [{'t': 0, 'text': 'la'}]
        state.promote()
        await state.broadcast()
        await state.broadcast()
        self.assertEqual([m['current'].get('lyrics') for m in tv.sent[-2:]], [a['lyrics'], None])
        self.assertTrue(all('lyrics' not in (m['current'] or {}) for m in remote.sent))
        self.assertTrue(all('lyrics' not in i for m in tv.sent for i in m['upcoming']))

    async def test_audio_flag_only_from_player_and_cleared_on_disconnect(self):
        state = State()
        tv = object()
        state.player = tv
        await state.control({'action': 'audio', 'value': True}, object())
        self.assertFalse(state.snapshot()['player_audio'])
        await state.control({'action': 'audio', 'value': True}, tv)
        self.assertTrue(state.snapshot()['player_audio'])
        state.disconnect(tv)
        self.assertFalse(state.audio)

    async def test_lyric_offset_is_remembered_per_song(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            state = State()
            state.restore(Path(folder) / 'queue.json')
            (Path(folder) / 'abcdefghijk').mkdir()
            meta = Path(folder) / 'abcdefghijk' / 'meta.json'
            meta.write_text(json.dumps({'title': '晴天'}), encoding='utf-8')
            a = await state.add('abcdefghijk', 'A', 'First')
            a['status'], a['offset'] = 'ready', 1.0
            state.promote()
            self.assertEqual(state.offset, 1.0)
            await state.control({'action': 'offset', 'delta': .5})
            self.assertEqual(json.loads(meta.read_text(encoding='utf-8')), {'title': '晴天', 'lyric_offset': 1.5})

    async def test_classic_room_timer_holds_the_next_song_until_time_is_added(self):
        state = State()
        clock = unittest.mock.patch('ktvibes.queue.time.time')
        now = clock.start()
        self.addCleanup(clock.stop)
        now.return_value = 1000.0
        state.lyric_mode = 'scroll'
        await state.control({'action': 'theme', 'value': 'classic'})
        self.assertEqual(state.room_ends, 1000.0 + 30 * 60)
        self.assertEqual(state.lyric_mode, 'two')  # Classic is always two lines
        await state.control({'action': 'lyric_mode', 'value': 'scroll'})
        self.assertEqual(state.lyric_mode, 'two')
        now.return_value = 1100.0
        await state.control({'action': 'theme', 'value': 'classic'})  # choosing it again keeps the time
        self.assertEqual(state.room_ends, 1000.0 + 30 * 60)
        for video_id in ('aaaaaaaaaaa', 'bbbbbbbbbbb'):
            item = await state.add(video_id, 'IU', video_id)
            item['status'], item['duration'] = 'ready', 100
        state.promote()
        now.return_value = 1000.0 + 31 * 60
        self.assertTrue(state.snapshot()['time_up'])
        await state.control({'action': 'skip'})
        self.assertIsNone(state.current)  # the room's time is up
        await state.control({'action': 'add_time', 'minutes': 10})
        self.assertEqual(state.current['id'], 'bbbbbbbbbbb')
        self.assertEqual(state.room_ends, 1000.0 + 41 * 60)
        await state.control({'action': 'theme', 'value': 'default'})
        self.assertIsNone(state.room_ends)
        self.assertFalse(state.snapshot()['time_up'])
        with self.assertRaises(ValueError):
            await state.control({'action': 'add_time', 'minutes': 10})  # no timer in Default
        await state.control({'action': 'theme', 'value': 'classic'})
        self.assertEqual(state.room_ends, 1000.0 + 61 * 60)  # a fresh 30 minutes

    async def test_theme_and_room_time_survive_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'queue.json'
            state = State()
            state.path = path
            await state.control({'action': 'theme', 'value': 'classic'})
            ends = state.room_ends
            again = State()
            again.restore(path)
            self.assertEqual((again.theme, again.room_ends), ('classic', ends))
            with self.assertRaises(ValueError):
                await again.control({'action': 'add_time', 'minutes': 0})

    async def test_reserve_next_puts_the_song_first_with_its_number(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            for video_id, number in [('aaaaaaaaaaa', 10001), ('bbbbbbbbbbb', 10002)]:
                (cache / video_id).mkdir()
                (cache / video_id / 'meta.json').write_text(json.dumps({'artist': 'IU', 'title': video_id, 'number': number}), encoding='utf-8')
            state = State()
            state.path = cache / 'queue.json'
            await state.control({'action': 'reserve', 'number': 10001})
            await state.control({'action': 'reserve', 'number': 10002, 'next': True})
            self.assertEqual([(i['id'], i['number']) for i in state.upcoming], [('bbbbbbbbbbb', 10002), ('aaaaaaaaaaa', 10001)])

    async def test_dial_reaches_the_tv_and_reserve_queues_by_number(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            (cache / 'aaaaaaaaaaa').mkdir()
            (cache / 'aaaaaaaaaaa' / 'meta.json').write_text(json.dumps({'artist': 'IU', 'title': '좋은 날', 'number': 10001}), encoding='utf-8')
            state = State()
            state.path = cache / 'queue.json'
            state.player = tv = object()
            sent = []
            async def send(ws, message):
                sent.append((ws, message))
                return True
            state.send = send
            revision = state.revision
            await state.control({'action': 'dial', 'digits': '100'})
            self.assertEqual(sent, [(tv, {'type': 'dial', 'digits': '100'})])
            self.assertEqual(state.revision, revision)  # nothing saved or broadcast
            with self.assertRaises(ValueError):
                await state.control({'action': 'dial', 'digits': '12a'})
            await state.control({'action': 'reserve', 'number': 10001})
            self.assertEqual((state.upcoming[0]['id'], state.upcoming[0]['title']), ('aaaaaaaaaaa', '좋은 날'))
            self.assertIn((tv, {'type': 'reserved', 'number': 10001}), sent)
            with self.assertRaises(ValueError):
                await state.control({'action': 'reserve', 'number': 10001})  # already queued
            with self.assertRaisesRegex(ValueError, 'No song 10099'):
                await state.control({'action': 'reserve', 'number': 10099})
            self.assertEqual(len(state.upcoming), 1)
            # Reserving while the room's time is up queues the song but doesn't start it.
            state.theme, state.room_ends = 'classic', 1.0
            state.upcoming[0]['status'] = 'ready'
            state.promote()
            self.assertIsNone(state.current)

class WorkerRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_removed_song_stops_holding_up_the_queue(self):
        import tempfile, threading
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        from ktvibes import worker
        release = threading.Event()
        def fetch_video(video_id, folder, progress):
            if video_id == 'aaaaaaaaaaa':
                release.wait(10)  # a slow download that outlives its song's place in the queue
        async def no_lyrics(*args):
            return {'raw': '', 'lines': []}
        state = State()
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(worker, 'fetch_video', fetch_video), \
             patch.object(worker.stems, 'ready', lambda folder: True), \
             patch.object(worker.sf, 'info', lambda path: SimpleNamespace(duration=100)), \
             patch.object(worker.lyrics, 'fetch', no_lyrics):
            task = asyncio.create_task(worker.run(state, Path(temp)))
            try:
                slow = await state.add('aaaaaaaaaaa', 'A', 'Slow')
                for _ in range(50):
                    if slow.get('step') == 'video':
                        break
                    await asyncio.sleep(0.05)
                self.assertEqual(slow.get('step'), 'video')
                await state.control({'action': 'remove', 'key': slow['key']})
                nxt = await state.add('bbbbbbbbbbb', 'B', 'Next')
                for _ in range(60):
                    if state.current is nxt:
                        break
                    await asyncio.sleep(0.05)
                self.assertIs(state.current, nxt)
                self.assertFalse(release.is_set())
                # Undoing the removal prepares it again rather than leaving it half done.
                self.assertEqual(slow['status'], 'queued')
            finally:
                release.set()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task


class WorkerTests(unittest.TestCase):
    def test_old_stems_migrate_to_opus_with_gain(self):
        import tempfile
        from pathlib import Path
        import numpy as np
        import soundfile as sf
        from ktvibes import stems
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            self.assertIsNone(stems.migrate(folder, None))
            # A steady tone above full scale, as Demucs stems can be; Opus is lossy, so compare levels.
            tone = 1.5 * np.sin(np.arange(48000) * 2 * np.pi * 440 / 48000).astype('float32')[:, None].repeat(2, 1)
            level = lambda x: float(np.sqrt(np.mean(x[4000:-4000] ** 2)))
            sf.write(folder / 'vocals.wav', tone / 3, 48000, subtype='FLOAT')
            sf.write(folder / 'no_vocals.wav', tone, 48000, subtype='FLOAT')
            gain = stems.migrate(folder, None)
            self.assertTrue(stems.ready(folder))
            self.assertFalse((folder / 'vocals.wav').exists())
            restored, rate = sf.read(folder / 'no_vocals.opus', dtype='float32')
            self.assertEqual(rate, 48000)
            self.assertAlmostEqual(level(restored) * gain, level(tone), delta=0.02)
            # FLAC from the previous version was stored scaled by its gain; the level survives conversion.
            for name in stems.NAMES:
                (folder / f'{name}.opus').unlink()
            sf.write(folder / 'vocals.flac', tone / 3 / 2, 44100, subtype='PCM_24')
            sf.write(folder / 'no_vocals.flac', tone / 2, 44100, subtype='PCM_24')
            gain = stems.migrate(folder, 2.0)
            self.assertFalse((folder / 'no_vocals.flac').exists())
            vocals, _ = sf.read(stems.path(folder, 'vocals'), dtype='float32')
            self.assertAlmostEqual(level(vocals) * gain, level(tone / 3), delta=0.02)

    def test_timed_lyrics_are_reused_until_the_lrc_changes(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import numpy as np
        import soundfile as sf
        from ktvibes import worker
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            sf.write(folder / 'vocals.wav', np.zeros((8000, 2), dtype='float32'), 8000)
            with patch.object(worker.align, 'align') as align:
                first = worker.timed_lyrics(folder, '[00:00.10]hello', folder / 'vocals.wav', parse_lrc('[00:00.10]hello'))
                again = worker.timed_lyrics(folder, '[00:00.10]hello', folder / 'vocals.wav', parse_lrc('[00:00.10]hello'))
                self.assertEqual(align.call_count, 1)
                self.assertEqual(first, again)
                worker.timed_lyrics(folder, '[00:00.10]goodbye', folder / 'vocals.wav', parse_lrc('[00:00.10]goodbye'))
                self.assertEqual(align.call_count, 2)
            # Without the aligner, the energy estimate is kept and only retried in a later run.
            with patch.object(worker.align, 'align', side_effect=RuntimeError) as align:
                worker.timed_lyrics(folder, '[00:00.10]again', folder / 'vocals.wav', parse_lrc('[00:00.10]again'))
                worker.timed_lyrics(folder, '[00:00.10]again', folder / 'vocals.wav', parse_lrc('[00:00.10]again'))
                self.assertEqual(align.call_count, 1)
                with patch.object(worker, 'STARTED', time.time() + 60):  # as if KTVibes restarted
                    worker.timed_lyrics(folder, '[00:00.10]again', folder / 'vocals.wav', parse_lrc('[00:00.10]again'))
                self.assertEqual(align.call_count, 2)

if __name__ == '__main__':
    unittest.main()

class LyricsMatchTests(unittest.TestCase):
    def test_cantonese_gets_jyutping_and_is_detected(self):
        from ktvibes import lyrics
        lines = [{'t': 0, 'text': '我哋喺度', 'units': [[c, 0, 1] for c in '我哋喺度']}, {'t': 1, 'text': '冇嘢', 'units': [[c, 1, 2] for c in '冇嘢']}]
        self.assertTrue(lyrics.cantonese(lines))
        self.assertEqual([u[5] for u in lyrics.add_jyutping(lines)[0]['units']], ['ngo5', 'dei6', 'hai2', 'dou6'])
        self.assertFalse(lyrics.cantonese([{'t': 0, 'text': '我是你的'}]))

    def test_japanese_gets_romaji_not_pinyin(self):
        from ktvibes import lyrics
        units = lyrics.split_units('きっと世界 ちゃんと Love')
        self.assertEqual(lyrics.romaji(units), ['ki', '', 'tto', 'sekai', '', 'cha', '', 'n', 'to', ''])
        lines = [{'t': 0, 'text': '世界', 'units': [['世', 0, 1], ['界', 1, 2]]}, {'t': 2, 'text': 'ありがとう', 'units': [[c, 2, 3] for c in 'ありがとう']}]
        lines = lyrics.add_pinyin(lyrics.add_romaji(lines))
        self.assertEqual(lines[0]['units'][0][3], 'sekai')  # a kanji-only line in a Japanese song is still Japanese

    def test_original_script_beats_romanized_record(self):
        from ktvibes import lyrics
        romanized = {"trackName": "Spring Day", "duration": 274, "syncedLyrics": "[00:10.00] bogo sipda"}
        hangul = {"trackName": "Spring Day", "duration": 276, "syncedLyrics": "[00:10.00] 보고 싶다"}
        japanese = {"trackName": "Spring Day", "duration": 274, "syncedLyrics": "[00:10.00] 会いたい"}
        best = min([romanized, japanese, hangul], key=lambda c: lyrics.rank(c, ["Spring Day"], 274, "ko"))
        self.assertIs(best, hangul)

    def test_script_tells_korean_japanese_and_chinese_apart(self):
        from ktvibes import lyrics
        self.assertEqual([lyrics.script(t) for t in ("보고 싶다", "会いたい", "晴天", "bogo sipda")], ["ko", "ja", "zh", "latin"])
        self.assertEqual(lyrics.wanted_script("BTS (방탄소년단)", "Spring Day"), "ko")
        self.assertIsNone(lyrics.wanted_script("NewJeans", "Super Shy"))

    def test_untimed_synced_lyrics_are_rejected(self):
        from unittest.mock import patch
        from ktvibes import lyrics
        untimed = {'trackName': '一路向北', 'duration': 301.0, 'syncedLyrics': '後視鏡裏的世界\n越來越遠的道別'}
        timed = {'trackName': '一路向北', 'duration': 302.0, 'syncedLyrics': '[00:20.00]後視鏡裏的世界'}
        class Response:
            def __init__(self, status, data): self.status_code, self.data = status, data
            def json(self): return self.data
            def raise_for_status(self): pass
        class Client:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass
            async def get(self, path, params):
                return Response(404, {}) if path == '/api/get' else Response(200, [untimed, timed])
        with patch('httpx.AsyncClient', Client):
            result = asyncio.run(lyrics.fetch('周杰倫', '一路向北', 301.2))
        self.assertEqual(result['lines'], [{'t': 20.0, 'text': '後視鏡裏的世界'}])

    def test_variants_split_bilingual_names(self):
        from ktvibes.lyrics import variants
        self.assertEqual(variants("아이유(IU)"), ["아이유(IU)", "아이유", "IU"])
        self.assertEqual(variants("晴天"), ["晴天"])
        self.assertEqual(variants("周杰倫 Jay Chou"), ["周杰倫 Jay Chou", "周杰倫", "Jay Chou"])
        self.assertEqual(variants("安靜 Silence"), ["安靜 Silence", "安靜", "Silence"])

    def test_rank_prefers_title_match_over_duration(self):
        from ktvibes.lyrics import rank
        a = {"trackName": "Good day (좋은 날)", "duration": 236.0}
        b = {"trackName": "Rain Drop", "duration": 235.6}
        self.assertLess(rank(a, ["좋은 날"], 235.6), rank(b, ["좋은 날"], 235.6))

    def test_units_follow_synthetic_vocal_energy(self):
        from ktvibes.lyrics import time_units
        # Synthetic envelope, 0.05s frames: singing 1-2s, silence 2-3s, singing 3-4s.
        energy = [0.0] * 20 + [1.0] * 20 + [0.0] * 20 + [1.0] * 20 + [0.0] * 40
        lines = time_units([{'t': 1.0, 'text': '你好'}, {'t': 5.0, 'text': ''}], energy)
        (a, a_start, a_end), (b, b_start, b_end) = lines[0]['units']
        self.assertEqual((a, b), ('你', '好'))
        self.assertAlmostEqual(a_start, 1.0)
        self.assertLessEqual(a_end, 2.1)
        self.assertGreaterEqual(b_start, 2.9)
        self.assertLessEqual(b_end, 4.1)

    def test_whole_song_shift_found_from_vocal_onsets(self):
        import numpy as np
        from ktvibes.lyrics import find_shift, shift_lines
        stamps = [4.0, 11.5, 17.0, 26.5, 33.0, 41.5, 47.0, 55.5, 61.0, 68.5, 74.0, 82.5]
        lines = [{'t': t, 'text': 'la la'} for t in stamps]
        def sung(offset):
            energy = np.zeros(1900)  # 95 s of 50 ms frames
            for t in stamps:
                start = int((t + offset) / .05)
                energy[start:start + 40] = 1  # two seconds of singing per line
            return energy
        self.assertAlmostEqual(find_shift(lines, sung(3.3)), 3.3, delta=.1)
        self.assertEqual(find_shift(lines, sung(0)), 0)
        self.assertEqual(find_shift(lines, sung(.3)), 0)  # small offsets are left to per-line alignment
        self.assertEqual(find_shift(lines, np.random.default_rng(1).random(1900)), 0)  # no clear fit
        lines[0]['units'] = [['la ', 4.0, 4.5]]
        shift_lines(lines, 3.3)
        self.assertEqual((lines[0]['t'], lines[0]['units'][0][1:]), (7.3, [7.3, 7.8]))

    def test_sections_after_a_cut_break_move_again(self):
        import numpy as np
        from ktvibes.lyrics import find_shift, shift_lines, shift_sections
        # Fix You: its singing (start frame, length) and LRC stamps. The vocals start ~2 s before the stamps,
        # but with lines ~7 s apart, shifting every stamp back a whole line also lands on singing, and scored higher.
        runs = [(227, 6), (234, 21), (257, 8), (276, 11), (289, 35), (368, 7), (377, 5), (385, 4), (390, 20), (415, 5),
                (422, 4), (428, 41), (508, 9), (519, 17), (538, 13), (556, 4), (562, 47), (632, 10), (644, 84), (791, 4),
                (797, 14), (812, 41), (856, 42), (931, 30), (963, 16), (980, 11), (998, 29), (1071, 18), (1090, 29),
                (1122, 12), (1135, 39), (1199, 15), (1217, 101), (1401, 33), (1437, 50), (1489, 31), (1544, 32),
                (1577, 51), (1629, 8), (1640, 31), (1678, 4), (1683, 31), (1715, 49), (1776, 17), (1921, 19), (1948, 12),
                (1961, 4), (1966, 51), (2061, 7), (2069, 89), (2198, 6), (2205, 99), (2324, 15), (2340, 100), (2527, 15),
                (2543, 4), (2548, 14), (2564, 50), (2615, 34), (2669, 85), (2756, 7), (2766, 32), (2810, 86), (2904, 24),
                (4041, 33), (4099, 52), (4162, 38), (4201, 74), (4276, 5), (4315, 33), (4372, 144), (4588, 36),
                (4646, 23), (4671, 32), (4706, 114), (4863, 36), (4900, 11), (4919, 146), (5137, 34), (5172, 84),
                (5274, 121), (5406, 5), (5412, 375), (5854, 15)]
        energy = np.zeros(5876)
        for start, length in runs:
            energy[start:start + length] = 1
        stamps = [13.18, 20.29, 27.41, 33.32, 41.3, 48.53, 55.25, 61.66, 71.92, 79.02, 85.95, 105.02, 111.66, 118.55,
                  124.89, 135.35, 142.18, 149.3, 210.85, 217.04, 224.64, 238.28, 244.04, 251.98, 265.69, 272.31, 279.18]
        lines = [{'t': t, 'text': 'la'} for t in stamps]
        self.assertAlmostEqual(find_shift(lines, energy), -2, delta=.3)
        # The video also cuts ~7 s from the break after the first chorus, so later sections move again.
        gaps = [{'t': t, 'text': ''} for t in (39.56, 68.44, 92.14, 131.48, 155.64, 262.73, 285.32)]
        song = sorted(lines + gaps, key=lambda line: line['t'])
        shift_lines(song, -1.95)
        moved = shift_sections(song, energy)
        self.assertEqual(moved[:3], [0, 0, 0])  # sections already in place stay
        for later in moved[3:]:
            self.assertAlmostEqual(later, -7, delta=.5)

    def test_sections_stay_when_the_song_opens_on_its_first_word(self):
        import numpy as np
        from ktvibes.lyrics import shift_sections
        # Love The Way You Lie (Part II): sung from 0.23 s, with no quiet half second before it to compare.
        # That scored the opening as misplaced, moved it ~6 s, and the move carried into every later section.
        stamps = [0.23, 5.86, 11.56, 17.1, 23.22, 29.38, 35.28, 40.5]
        energy = np.zeros(1000)
        for t in stamps:
            energy[round(t / .05):round(t / .05) + 50] = 1
        song = sorted([{'t': t, 'text': 'la'} for t in stamps] + [{'t': t, 'text': ''} for t in (8.71, 14.0, 20.0, 26.0)],
                      key=lambda line: line['t'])
        self.assertEqual(set(shift_sections(song, energy)), {0})

    def test_a_long_video_intro_is_found(self):
        import numpy as np
        from ktvibes.lyrics import find_shift
        # Adele's Hello: the music video talks for ~75 s before the song, past the usual 30 s search.
        stamps = [5.82, 11.47, 17.81, 23.23, 30.1, 35.9, 41.2, 47.6, 53.3, 58.8, 64.5, 70.2]
        energy = np.zeros(3000)
        for t in stamps:
            energy[round((t + 75) / .05):round((t + 75) / .05) + 40] = 1
        self.assertAlmostEqual(find_shift([{'t': t, 'text': 'la'} for t in stamps], energy), 75, delta=.1)

    def test_a_song_that_fits_is_not_moved_to_a_far_repeat(self):
        import numpy as np
        from ktvibes.lyrics import find_shift
        # Stamps that fit as they are, if only a third of them clearly (soft singing), in audio where the
        # pattern repeats in full 60 s later: three times as good a fit, but the far search for long intros
        # only runs when the stamps fit badly as they are.
        stamps = [5.82, 11.47, 17.81, 23.23, 30.1, 35.9, 41.2, 47.6, 53.3, 58.8, 64.5, 70.2]
        energy = np.zeros(4000)
        for index, t in enumerate(stamps):
            for at in ((t, t + 60) if index % 3 == 0 else (t + 60,)):
                energy[round(at / .05):round(at / .05) + 40] = 1
        self.assertEqual(find_shift([{'t': t, 'text': 'la'} for t in stamps], energy), 0)

    def test_an_onset_of_minus_one_is_still_inside_the_audio(self):
        import numpy as np
        from ktvibes.lyrics import line_scores
        energy = np.zeros(400)
        energy[:20] = 1  # sung for the first second, then silent: a line at 1 s scores -1
        scores = line_scores([{'t': 1.0}, {'t': 30.0}], energy, .05, 0)
        self.assertEqual(scores[0, 0], -1.0)
        self.assertTrue(np.isnan(scores[1, 0]))  # past the end of the audio

    def test_a_short_section_after_a_cut_moves_with_the_rest(self):
        import numpy as np
        from ktvibes.lyrics import shift_sections
        # The video cuts 4 s from the break before a two-line bridge. Two lines alone are too little to move
        # a section, but the lines after the bridge are off by the same 4 s, so all of them move together.
        sung = [[5, 9.5, 15], [30, 34.5], [45, 49, 54.5, 58], [70, 75.5, 79]]
        gaps = [18, 37, 61, 82]
        energy = np.zeros(2000)
        for t in (t for section in sung for t in section):
            energy[round(t / .05):round(t / .05) + 30] = 1
        song = []
        for index, (section, gap) in enumerate(zip(sung, gaps)):
            late = 4 if index else 0
            song += [{'t': t + late, 'text': 'la'} for t in section] + [{'t': gap + late, 'text': ''}]
        self.assertEqual(shift_sections(song, energy), [0, -4, -4, -4])

    def test_line_switches_after_last_word_and_before_first(self):
        from ktvibes.lyrics import line_starts
        lines = [{'t': 27.08, 'text': 'Go ahead and bark after dark', 'units': [['Go ', 26.8, 26.9], ['dark', 29.23, 29.33]]},
                 {'t': 29.03, 'text': 'Fallen star', 'units': [['Fallen ', 30.04, 30.58], ['star', 30.68, 31.16]]},
                 {'t': 31.0, 'text': 'overlap', 'units': [['overlap', 31.1, 31.5]]},
                 {'t': 40.0, 'text': ''}]
        line_starts(lines)
        # Sanctuary: the stamp for "Fallen star" (29.03) cut off "after dark", sung until 29.33.
        self.assertEqual([line['start'] for line in lines], [26.5, 29.74, 31.1, 40.0])

    def test_backing_vocal_lines_overlap_the_lead(self):
        from ktvibes.lyrics import line_end, line_starts
        # Numb: "(Caught in the undertow…)" is stamped while the lead line is still being sung.
        lines = [{'t': 34.09, 'text': 'Put under the pressure of walking in your shoes', 'units': [['Put ', 34.1, 34.4], ['shoes', 40.2, 40.9]]},
                 {'t': 39.3, 'text': '(Caught in the undertow, just caught in the undertow)', 'units': [['(Caught ', 39.4, 39.8], ['undertow)', 42.0, 42.6]]},
                 {'t': 42.54, 'text': 'Every step that I take', 'units': [['Every ', 42.6, 42.9], ['take', 44.0, 44.5]]}]
        self.assertEqual(line_end(lines, 0), 42.54)  # aligned up to the next lead line, not cut at the echo
        self.assertEqual(line_end(lines, 1), 42.54)
        line_starts(lines)
        self.assertEqual([line['start'] for line in lines], [33.8, 39.1, 42.3])
        self.assertEqual([line.get('over') for line in lines], [None, 0, None])

    def test_lines_align_in_runs_split_at_gaps_and_backing_vocals(self):
        from ktvibes.align import runs
        lines = [{'t': 0, 'text': 'a'}, {'t': 3, 'text': 'b'}, {'t': 5, 'text': '(echo)'}, {'t': 6, 'text': 'c'},
                 {'t': 9, 'text': ''}, {'t': 20, 'text': 'd'}, {'t': 30, 'text': 'e'}, {'t': 70, 'text': 'f'}]
        words = {i: ['x'] for i, line in enumerate(lines) if line['text']}
        self.assertEqual(runs(lines, words), [[0, 1], [2], [3], [5, 6], [7]])

    def test_energy_timing_starts_after_the_previous_line(self):
        from ktvibes.lyrics import time_units
        lines = [{'t': 0, 'text': 'one', 'units': [['one', 0.5, 4.2]]}, {'t': 3.5, 'text': 'two'}, {'t': 9, 'text': ''}]
        time_units(lines, [1.0] * 200)
        self.assertGreaterEqual(lines[1]['units'][0][1], 4.2)  # the stamp (3.5) is before "one" is finished

    def test_enhanced_lrc_word_stamps(self):
        line = parse_lrc('[00:01.00]<00:01.00>Hel<00:01.50>lo')[0]
        self.assertEqual(line['text'], 'Hello')
        self.assertEqual(line['units'], [['Hel', 1.0, 1.5], ['lo', 1.5, 2.5]])

    def test_pinyin_per_unit_uses_line_context(self):
        from ktvibes.lyrics import add_pinyin
        lines = add_pinyin([{'t': 0, 'text': '还是 ok', 'units': [['还', 0, 1], ['是 ', 1, 2], ['ok', 2, 3]]},
                            {'t': 3, 'text': '좋은', 'units': [['좋', 3, 4], ['은', 4, 5]]}])
        self.assertEqual([u[3] for u in lines[0]['units']], ['hái', 'shì', ''])
        self.assertEqual(len(lines[1]['units'][0]), 3)

    def test_korean_romanization_follows_pronunciation(self):
        from ktvibes.lyrics import add_korean_romanization, romanize
        self.assertEqual(romanize('실라면'), ['sil', 'la', 'myeon'])
        units = [['눈', 0, 1], ['물', 1, 2], ['이 ', 2, 3], ['좋', 3, 4], ['은', 4, 5]]
        add_korean_romanization([{'t': 0, 'text': '눈물이 좋은', 'units': units}])
        self.assertEqual([u[3] for u in units], ['nun', 'mu', 'ri', 'jo', 'eun'])

    def test_aligner_letters_cover_all_scripts(self):
        from ktvibes.align import spoken_letters
        self.assertEqual(spoken_letters(['我', '好 ', '좋', '은 ', "Don't ", 'café', ', ']),
                         ['wo', 'hao', 'jot', 'eun', "don't", 'cafe', ''])

    def test_enhanced_lrc_voice_tag_and_end_stamp(self):
        line = parse_lrc('[00:06.00]v2: <00:06.00>a<00:06.40>pateu <00:07.00>')[0]
        self.assertEqual((line['text'], line['voice']), ('apateu', 'v2'))
        self.assertEqual(line['units'], [['a', 6.0, 6.4], ['pateu ', 6.4, 7.0]])

class GuideTests(unittest.TestCase):
    def test_english_to_hangul(self):
        from ktvibes.guides import english_hangul
        self.assertEqual([english_hangul(w) for w in ['someone', 'kiss', 'lips', 'crazy', 'queen', 'sweet', "Don't,", 'tryna']],
                         ['섬원', '키스', '립스', '크레이지', '퀸', '스위트', '돈트', ''])

    def test_chinese_to_hangul_standard_table(self):
        from ktvibes.guides import pinyin_hangul
        self.assertEqual([pinyin_hangul(s) for s in ['qing', 'tian', 'zhou', 'jie', 'lun', 'zhi', 'si', 'yi', 'xue', 'lv']],
                         ['칭', '톈', '저우', '제', '룬', '즈', '쓰', '이', '쉐', '뤼'])

    def test_add_hangul_keeps_latin_slot(self):
        from ktvibes.guides import add_hangul
        units = [['晴', 0, 1, 'qíng'], ['天 ', 1, 2, 'tiān'], ['kiss', 2, 3]]
        add_hangul([{'t': 0, 'text': '晴天 kiss', 'units': units}])
        self.assertEqual([u[3:] for u in units], [['qíng', '칭'], ['tiān', '톈'], ['', '키스']])


class SongbookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def song(self, video_id, mtime, **meta):
        folder = self.cache / video_id
        folder.mkdir()
        path = folder / 'meta.json'
        path.write_text(json.dumps({'artist': 'IU', 'title': video_id, **meta}), encoding='utf-8')
        os.utime(path, (mtime, mtime))
        return path

    def test_numbers_start_at_10001_and_never_repeat(self):
        from ktvibes import songbook
        meta = {}
        self.assertEqual(songbook.assign(self.cache, meta), 10001)
        self.song('aaaaaaaaaaa', 1, number=10001)
        self.song('bbbbbbbbbbb', 2, number=10007)
        meta = {}
        self.assertEqual(songbook.assign(self.cache, meta), 10008)
        kept = {'number': 10003}
        self.assertEqual(songbook.assign(self.cache, kept), 10003)  # a number is for life
        self.assertEqual(songbook.numbers(self.cache), {10001: 'aaaaaaaaaaa', 10007: 'bbbbbbbbbbb'})
        self.assertEqual(songbook.find(self.cache, 10007)[0], 'bbbbbbbbbbb')
        self.assertIsNone(songbook.find(self.cache, 10002))

    def test_backfill_numbers_prepared_songs_oldest_first_and_keeps_timestamps(self):
        from ktvibes import songbook
        newer = self.song('bbbbbbbbbbb', 200)
        older = self.song('aaaaaaaaaaa', 100)
        self.song('ccccccccccc', 300)  # not prepared: no stems
        self.song('ddddddddddd', 50, number=10001)
        songbook.backfill(self.cache, lambda folder: folder.name != 'ccccccccccc')
        self.assertEqual(json.loads(older.read_text(encoding='utf-8'))['number'], 10002)
        self.assertEqual(json.loads(newer.read_text(encoding='utf-8'))['number'], 10003)
        self.assertNotIn('number', json.loads((self.cache / 'ccccccccccc' / 'meta.json').read_text(encoding='utf-8')))
        self.assertEqual(older.stat().st_mtime, 100)  # "prepared" times feed the Recent list

class MusicEndTest(unittest.TestCase):
    def stem(self, folder, seconds_of_tone, seconds_of_silence, name="no_vocals"):
        import numpy as np, soundfile as sf
        rate = 48000
        t = np.arange(int(rate * seconds_of_tone)) / rate
        tone = 0.3 * np.sin(2 * np.pi * 440 * t)
        data = np.concatenate([tone, np.zeros(int(rate * seconds_of_silence))])
        path = Path(folder) / f"{name}.opus"
        sf.write(path, np.stack([data, data], axis=1), rate, format="OGG", subtype="OPUS")
        return path

    def test_music_end_is_where_the_trailing_silence_starts(self):
        from ktvibes import stems
        with tempfile.TemporaryDirectory() as folder:
            end = stems.music_end(self.stem(folder, 5, 4))
        self.assertAlmostEqual(end, 5, delta=0.3)

    def test_music_end_is_the_length_when_the_track_plays_to_the_end(self):
        from ktvibes import stems
        with tempfile.TemporaryDirectory() as folder:
            end = stems.music_end(self.stem(folder, 6, 0))
        self.assertAlmostEqual(end, 6, delta=0.3)

    def test_song_end_waits_for_a_last_line_sung_after_the_music_stops(self):
        from ktvibes import stems
        with tempfile.TemporaryDirectory() as folder:
            self.stem(folder, 5, 4)
            self.stem(folder, 7, 2, name="vocals")
            end = stems.song_end(Path(folder))
        self.assertAlmostEqual(end, 7, delta=0.3)

    def test_song_end_is_none_when_a_stem_cannot_be_read(self):
        from ktvibes import stems
        with tempfile.TemporaryDirectory() as folder:
            self.stem(folder, 5, 4)
            (Path(folder) / "vocals.opus").write_bytes(b"not audio")
            self.assertIsNone(stems.song_end(Path(folder)))
