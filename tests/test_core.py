import asyncio
import unittest
from ktvibes.lyrics import parse_lrc
from ktvibes.youtube import parse_title
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
        self.assertEqual(state.lyric_scale, 1.8)

    async def test_duplicate_songs_have_independent_identity(self):
        state = State()
        a = await state.add('abcdefghijk', 'A', 'First')
        b = await state.add('abcdefghijk', 'A', 'Second')
        self.assertNotEqual(a['key'], b['key'])
        a['status'] = b['status'] = 'ready'
        state.promote()
        self.assertIs(state.current, a)
        await state.control({'action': 'offset', 'delta': .5})
        await state.control({'action': 'skip'})
        self.assertIs(state.current, b)
        self.assertEqual(state.offset, 0)

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

if __name__ == '__main__':
    unittest.main()

class LyricsMatchTests(unittest.TestCase):
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
