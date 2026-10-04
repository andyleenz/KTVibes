import asyncio
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
        self.assertEqual(state.snapshot()['undo']['title'], 'First')
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
