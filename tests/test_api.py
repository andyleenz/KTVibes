"""HTTP/WebSocket contract checks, runnable once uv sync installs dependencies."""
import asyncio
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

AVAILABLE = all(importlib.util.find_spec(name) for name in ('fastapi', 'httpx', 'soundfile', 'qrcode'))

@unittest.skipUnless(AVAILABLE, 'Run uv sync to install API test dependencies')
class APITests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from ktvibes import main, lyrics, worker, youtube
        self.youtube = youtube
        from ktvibes.application import create_app
        from ktvibes.runtime import Runtime
        from ktvibes.schemas import LyricChoice
        self.main = main
        self.lyrics = lyrics
        self.worker = worker
        self.LyricChoice = LyricChoice
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Runtime(cache=Path(self.temp.name))
        async def idle_worker(*args):
            await asyncio.Event().wait()
        self.patches = [patch.object(worker, 'run', idle_worker),
                        patch.object(self.runtime.updates, 'run', idle_worker)]
        for item in self.patches:
            item.start()
        self.app = create_app(self.runtime)
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_config_includes_current_project_version(self):
        response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['version'], self.runtime.project_version())

    def test_branded_qr_embeds_icon_and_keeps_plain_variant(self):
        import base64
        import xml.etree.ElementTree as ET
        for branded in (False, True):
            response = self.client.get('/api/qr.svg', params={'branded': str(branded).lower()})
            self.assertEqual(response.status_code, 200)
            svg = ET.fromstring(response.content)
            images = svg.findall('{http://www.w3.org/2000/svg}image')
            self.assertEqual(len(images), int(branded))
            if branded:
                self.assertEqual(base64.b64decode(images[0].attrib['href'].split(',')[1]),
                                 (self.runtime.root / 'static/apple-touch-icon.png').read_bytes())
                self.assertEqual(svg[0].attrib['fill'], 'white')

    def test_identity_management_and_queue_requester_snapshots(self):
        created = self.client.post('/api/identities', json={'name': 'Mina', 'avatar': 'avatar-03'})
        self.assertEqual(created.status_code, 201)
        identity = created.json()
        self.assertEqual(self.client.get('/api/identities').json()['identities'], [identity])
        song = {'id': 'aaaaaaaaaaa', 'artist': 'A', 'title': 'Song', 'identity_id': identity['id']}
        queued = self.client.post('/api/queue', json=song)
        self.assertEqual(queued.json()['requester'], {'id': identity['id'], 'name': 'Mina', 'avatar': 'avatar-03'})
        self.client.patch(f"/api/identities/{identity['id']}", json={'name': 'Mina 2', 'avatar': 'avatar-04'})
        self.client.delete(f"/api/identities/{identity['id']}")
        self.assertEqual(self.client.get('/api/state').json()['upcoming'][0]['requester']['name'], 'Mina')
        guest = self.client.post('/api/queue', json={**song, 'id': 'bbbbbbbbbbb', 'identity_id': None})
        self.assertEqual(guest.json()['requester']['name'], 'Guest')

    def test_identity_order_is_persistent_and_rejects_stale_lists(self):
        from ktvibes.identities import IdentityStore
        one = self.client.post('/api/identities', json={'name': 'One', 'avatar': 'avatar-01'}).json()
        two = self.client.post('/api/identities', json={'name': 'Two', 'avatar': 'avatar-02'}).json()
        ids = [two['id'], one['id']]
        response = self.client.put('/api/identities/order', json={'ids': ids})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([x['id'] for x in IdentityStore(self.runtime.cache / 'identities.json').items], ids)
        for invalid in ([one['id']], [one['id'], one['id']], [one['id'], 'missing']):
            self.assertEqual(self.client.put('/api/identities/order', json={'ids': invalid}).status_code, 409)
        self.assertEqual([x['id'] for x in self.runtime.identities.items], ids)

    def test_apps_keep_queue_cache_and_version_checks_independent(self):
        from fastapi.testclient import TestClient
        from ktvibes.application import create_app
        from ktvibes.runtime import Runtime
        other = Runtime(cache=Path(self.temp.name) / 'other')
        other.updates.info = {'version': 'v9.0.0', 'url': 'https://example.com/release'}
        with patch.object(other.updates, 'run', new_callable=AsyncMock):
            with TestClient(create_app(other)) as client:
                self.client.post('/api/queue', json={'id': 'aaaaaaaaaaa', 'artist': 'A', 'title': 'First'})
                client.post('/api/queue', json={'id': 'bbbbbbbbbbb', 'artist': 'B', 'title': 'Second'})
                self.assertEqual(self.client.get('/api/state').json()['upcoming'][0]['id'], 'aaaaaaaaaaa')
                self.assertEqual(client.get('/api/state').json()['upcoming'][0]['id'], 'bbbbbbbbbbb')
                self.assertEqual(client.get('/api/config').json()['update']['version'], 'v9.0.0')
                self.assertIsNone(self.client.get('/api/config').json()['update'])
                self.assertNotEqual(self.runtime.state.path, other.state.path)

    def test_update_pulls_only_a_clean_checkout(self):
        import subprocess
        root = Path(self.temp.name)
        (root / '.git').mkdir()
        calls = []
        def fake_git(command, **kwargs):
            calls.append(command[3])
            output = {'status': ' M ktvibes/main.py', 'rev-parse': 'abc1234'}.get(command[3], '')
            return subprocess.CompletedProcess(command, 0, output, '')
        with patch.object(self.main, 'ROOT', root), patch('subprocess.run', fake_git):
            with self.assertRaises(SystemExit):
                self.main.update()
            self.assertNotIn('pull', calls)

    def test_lyrics_can_be_searched_and_chosen_by_hand(self):
        import json
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Simple Plan', 'title': 'Perfect', 'duration': 280}), encoding='utf-8')
        record = {'id': 7, 'trackName': 'Perfect', 'artistName': 'Simple Plan', 'duration': 278, 'syncedLyrics': '[00:10.00]Hey dad look at me'}
        async def search(query, duration):
            self.assertEqual(query, 'simple plan perfect')
            return [record]
        async def fetch(record_id):
            return record if record_id == 7 else None
        with patch.object(self.lyrics, 'search', search), patch.object(self.lyrics, 'record', fetch):
            options = self.client.get('/api/songs/aaaaaaaaaaa/lyrics', params={'q': ' simple plan perfect '}).json()
            self.assertEqual((options[0]['id'], options[0]['difference'], options[0]['preview']), (7, -2, ['Hey dad look at me']))
            self.assertEqual(self.client.post('/api/songs/aaaaaaaaaaa/lyrics', json={'id': 8}).status_code, 404)
            self.assertEqual(self.client.post('/api/songs/aaaaaaaaaaa/lyrics', json={'id': 7}).status_code, 200)
        self.assertEqual((folder / 'lyrics.lrc').read_text(encoding='utf-8'), record['syncedLyrics'])
        self.assertEqual(json.loads((folder / 'meta.json').read_text(encoding='utf-8'))['lyrics_identity'], ['Simple Plan', 'Perfect'])

    def test_mixed_lyrics_choices_return_one_typed_record_and_preserve_synced_identity(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', '周杰倫', '晴天')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        raw = '[00:01.00]天青色'
        (folder / 'lyrics.lrc').write_text(raw, encoding='utf-8')
        (folder / 'meta.json').write_text(json.dumps({'artist': '周杰倫', 'title': '晴天', 'duration': 270,
                                                       'lyrics_record_id': 11}), encoding='utf-8')
        (folder / 'plain_lyrics.json').write_text(json.dumps({'identity': ['周杰倫', '晴天'], 'record_id': 22,
            'status': 'ready', 'checked_at': 1, 'text': '天青色等煙雨', 'origin': 'manual'}, ensure_ascii=False), encoding='utf-8')
        (folder / 'viewer_selection.json').write_text(json.dumps({'identity': ['周杰倫', '晴天'], 'format': 'plain',
            'record_id': 22, 'origin': 'manual'}, ensure_ascii=False), encoding='utf-8')
        records = [{'id': 11, 'trackName': '晴天', 'artistName': '周杰倫', 'duration': 270,
                    'syncedLyrics': raw, 'plainLyrics': '天青色等煙雨'},
                   {'id': 22, 'trackName': '晴天', 'artistName': '周杰倫', 'plainLyrics': '天青色等煙雨'},
                   {'id': 23, 'trackName': 'Stella', 'artistName': 'Other Artist', 'plainLyrics': '天幕の歌詞'}]
        async def search(*args): return records
        with patch.object(self.lyrics, 'mixed_search', search):
            response = self.client.get(f"/api/lyrics/choices/{item['key']}", params={'q': '晴天'})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload['synced_active'])
        self.assertEqual(payload['selection_format'], 'plain')
        self.assertEqual([entry['id'] for entry in payload['results']], [11, 22, 23])
        self.assertEqual(sum(entry['formats']['synced']['current'] for entry in payload['results']), 0)
        self.assertTrue(payload['results'][0]['formats']['plain']['available'])
        self.assertTrue(payload['results'][1]['formats']['plain']['selected'])
        self.assertTrue(payload['results'][1]['formats']['plain']['active'])
        self.assertTrue(payload['results'][2]['formats']['plain']['available'])

    def test_lyrics_search_503_returns_a_clear_wait_and_retry_message(self):
        from types import SimpleNamespace
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        error = RuntimeError('upstream unavailable')
        error.response = SimpleNamespace(status_code=503)
        async def fail(*args): raise error
        with patch.object(self.lyrics, 'mixed_search', fail):
            response = self.client.get(f"/api/lyrics/choices/{item['key']}", params={'q': 'Song'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], 'LRCLIB is temporarily busy. Please wait 1 second, then try again.')
        self.assertEqual(response.headers['retry-after'], '1')

    def test_lyrics_search_429_uses_upstream_retry_after(self):
        from types import SimpleNamespace
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        error = RuntimeError('too many requests')
        error.response = SimpleNamespace(status_code=429, headers={'Retry-After': '3'})
        async def fail(*args): raise error
        with patch.object(self.lyrics, 'mixed_search', fail):
            response = self.client.get(f"/api/lyrics/choices/{item['key']}", params={'q': 'Song'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers['retry-after'], '3')
        self.assertEqual(response.json()['detail'], 'LRCLIB is limiting lyric searches. Please wait 3 seconds, then try again.')

    def test_plain_selection_is_viewer_only_allowed_while_processing_and_keeps_synced_cache(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Cody・Lee', '我愛你')
        self.runtime.state.upcoming.append(item)  # still processing
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        raw = '[00:01.00]Synced lyric'
        metadata = {'artist': 'Cody・Lee', 'title': '我愛你', 'duration': 200, 'lyrics_record_id': 71,
                    'lyrics_revision': 3, 'lyrics_source': 'manual', 'lyric_offset': 1.2}
        meta_path = folder / 'meta.json'; meta_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        lrc_path = folder / 'lyrics.lrc'; lrc_path.write_text(raw, encoding='utf-8')
        record = {'id': 9, 'artistName': 'Cody・Lee', 'trackName': '我愛你', 'plainLyrics': '日本語と繁體中文 안녕'}
        with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value=record):
            response = self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': 9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json()['source'], response.json()['active']), ('plain', True))
        self.assertEqual(item['viewer_lyrics_source'], 'plain')
        cache = json.loads((folder / 'plain_lyrics.json').read_text(encoding='utf-8'))
        self.assertEqual((cache['record_id'], cache['text'], cache['origin']), (9, record['plainLyrics'], 'manual'))
        selection = json.loads((folder / 'viewer_selection.json').read_text(encoding='utf-8'))
        self.assertEqual((selection['format'], selection['record_id'], selection['origin']), ('plain', 9, 'manual'))
        view = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((view['source'], view['text']), ('plain', record['plainLyrics']))
        self.assertEqual(json.loads(meta_path.read_text(encoding='utf-8')), metadata)
        self.assertEqual(lrc_path.read_text(encoding='utf-8'), raw)
        self.assertFalse((folder / 'timed.json').exists())

    def test_manual_synced_selection_replaces_plain_viewer_preference(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        item.update(status='ready', lyrics_status='ready')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        raw = '[00:01.00]Synced is selected'
        (folder / 'lyrics.lrc').write_text(raw, encoding='utf-8')
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 120,
            'lyrics_record_id': 3, 'lyrics_identity': ['Artist', 'Song'], 'lyrics_source': 'manual'}), encoding='utf-8')
        plain = {'id': 8, 'artistName': 'Artist', 'trackName': 'Song', 'plainLyrics': 'Plain was selected first'}
        synced = {'id': 3, 'artistName': 'Artist', 'trackName': 'Song', 'syncedLyrics': raw}
        with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value=plain):
            self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': 8})
        with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value=synced):
            response = self.client.post(f"/api/queue/{item['key']}/lyrics", json={'id': 3})
        self.assertEqual(response.status_code, 200)
        view = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((view['source'], view['text']), ('synced', 'Synced is selected'))
        selection = json.loads((folder / 'viewer_selection.json').read_text(encoding='utf-8'))
        self.assertEqual((selection['format'], selection['record_id']), ('synced', 3))
        self.assertTrue((folder / 'plain_lyrics.json').is_file())

    def test_plain_selection_is_shown_when_no_synced_cache_and_rejects_stale_target(self):
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Cody・Lee', '我愛你')
        self.runtime.state.upcoming.append(item)
        (Path(self.temp.name) / item['id']).mkdir()
        record = {'id': 10, 'artistName': 'Cody・Lee', 'trackName': '我愛你', 'plainLyrics': '愛してる'}
        with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value=record):
            response = self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': 10})
        self.assertEqual((response.status_code, response.json()['source'], response.json()['text']), (200, 'plain', '愛してる'))
        self.assertEqual(item['viewer_lyrics_source'], 'plain')
        cache_path = Path(self.temp.name) / item['id'] / 'plain_lyrics.json'
        self.assertTrue(cache_path.is_file())
        self.runtime.state.upcoming.remove(item)
        self.assertEqual(self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': 10}).status_code, 404)

    def test_manual_plain_selection_accepts_record_when_auto_parsed_identity_is_wrong(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'SEKAI NO OWARI', 'misparsed promotional title')
        self.runtime.state.upcoming.append(item)
        with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value={
            'id': 12, 'artistName': 'Other Artist', 'trackName': 'Stella', 'plainLyrics': '星の歌詞'}):
            response = self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': 12})
        self.assertEqual((response.status_code, response.json()['source'], response.json()['text']), (200, 'plain', '星の歌詞'))
        cache = json.loads((Path(self.temp.name) / item['id'] / 'plain_lyrics.json').read_text(encoding='utf-8'))
        self.assertEqual((cache['record_id'], cache['origin']), (12, 'manual'))

    def test_manual_plain_selection_still_rejects_missing_or_oversized_text(self):
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        for record in ({'id': 13, 'artistName': 'Artist', 'trackName': 'Song'},
                       {'id': 14, 'plainLyrics': '歌' * 100_001}):
            with patch.object(self.lyrics, 'record', new_callable=AsyncMock, return_value=record):
                response = self.client.post(f"/api/lyrics/plain/{item['key']}", json={'id': record['id']})
            self.assertEqual(response.status_code, 422)
        self.assertFalse((Path(self.temp.name) / item['id'] / 'plain_lyrics.json').exists())

    def test_manual_plain_cache_is_reused_without_automatic_lookup(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Cody・Lee', '我愛你')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        (folder / 'plain_lyrics.json').write_text(json.dumps({'identity': ['codylee', '我愛你'], 'record_id': 55,
            'status': 'ready', 'checked_at': 1, 'text': '手動選取的日本語', 'origin': 'manual'}, ensure_ascii=False), encoding='utf-8')
        with patch.object(self.lyrics, 'plain_record', new_callable=AsyncMock, side_effect=AssertionError('manual cache must win')):
            first = self.client.get(f"/api/lyrics/view/{item['key']}").json()
            second = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((first['record_id'], second['text'], first['source']), (55, '手動選取的日本語', 'plain'))
        self.assertEqual(item['viewer_lyrics_source'], 'plain')

    def test_newer_manual_plain_selection_wins_concurrent_request_race(self):
        import json
        from fastapi import HTTPException
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Cody・Lee', '我愛你')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        release_old = asyncio.Event()
        async def record(record_id):
            if record_id == 1:
                await release_old.wait()
                text = 'older selection'
            else:
                text = 'newer selection'
                release_old.set()
            return {'id': record_id, 'artistName': 'Cody・Lee', 'trackName': '我愛你', 'plainLyrics': text}
        async def run():
            with patch.object(self.lyrics, 'record', record):
                old = asyncio.create_task(self.runtime.lyrics.choose_plain_lyrics(item['key'], self.LyricChoice(id=1)))
                await asyncio.sleep(0)
                new = await self.runtime.lyrics.choose_plain_lyrics(item['key'], self.LyricChoice(id=2))
                try:
                    await old
                except HTTPException as exc:
                    self.assertEqual(exc.status_code, 409)
                else:
                    self.fail('older selection should have been rejected')
                return new
        result = asyncio.run(run())
        cached = json.loads((folder / 'plain_lyrics.json').read_text(encoding='utf-8'))
        self.assertEqual((result['saved'], cached['record_id'], cached['text']), (2, 2, 'newer selection'))

    def test_lyrics_view_prefers_synced_lrc_and_does_not_touch_playback_cache(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', '周杰倫', '晴天')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        raw = '[ti:晴天]\n[00:02.00]天青色等煙雨'
        (folder / 'lyrics.lrc').write_text(raw, encoding='utf-8')
        original = {'artist': '周杰倫', 'title': '晴天', 'duration': 270, 'lyrics_record_id': 12,
                    'lyrics_revision': 3, 'lyrics_source': 'manual', 'lyric_offset': 1.2}
        meta_path = folder / 'meta.json'; meta_path.write_text(json.dumps(original, ensure_ascii=False), encoding='utf-8')
        with patch.object(self.lyrics, 'plain_record', side_effect=AssertionError('plain lookup should not run')):
            response = self.client.get(f"/api/lyrics/view/{item['key']}")
        self.assertEqual((response.json()['status'], response.json()['source'], response.json()['text']), ('ready', 'synced', '天青色等煙雨'))
        self.assertEqual(item['viewer_lyrics_source'], 'synced')
        self.assertEqual(json.loads(meta_path.read_text(encoding='utf-8')), original)
        self.assertFalse((folder / 'plain_lyrics.json').exists())

    def test_marking_lyrics_unavailable_overrides_synced_match_and_persists(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', '周杰倫', '晴天')
        item.update(status='ready', lyrics_status='ready', lyrics=[{'t': 2, 'text': 'Wrong lyrics'}])
        self.runtime.state.current = item
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        (folder / 'lyrics.lrc').write_text('[00:02.00]Wrong lyrics', encoding='utf-8')
        (folder / 'meta.json').write_text(json.dumps({'artist': '周杰倫', 'title': '晴天', 'duration': 270,
            'lyrics_identity': ['周杰倫', '晴天']}), encoding='utf-8')

        response = self.client.post(f"/api/lyrics/unavailable/{item['key']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual((item['lyrics'], item['lyrics_status'], item['viewer_lyrics_source'], item['lyrics_rev']), ([], 'missing', 'missing', 1))
        selection = json.loads((folder / 'viewer_selection.json').read_text(encoding='utf-8'))
        self.assertEqual((selection['format'], selection['record_id'], selection['origin']), ('none', None, 'manual'))
        view = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual(view['status'], 'missing')

    def test_lyrics_view_caches_plain_text_utf8_and_reuses_it(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Cody・Lee', '我愛你')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        metadata = {'artist': 'Cody・Lee', 'title': '我愛你', 'duration': 200, 'lyrics_record_id': 7,
                    'lyrics_revision': 2, 'lyrics_source': 'automatic', 'lyric_offset': -0.4}
        meta_path = folder / 'meta.json'; meta_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        with patch.object(self.lyrics, 'plain_record', new_callable=AsyncMock, return_value={'id': 9, 'text': '日本語と繁體中文 안녕'}) as mocked:
            first = self.client.get(f"/api/lyrics/view/{item['key']}").json()
            second = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((first['source'], first['record_id'], second['text']), ('plain', 9, '日本語と繁體中文 안녕'))
        self.assertEqual(item['viewer_lyrics_source'], 'plain')
        self.assertEqual(mocked.call_count, 1)
        cache = json.loads((folder / 'plain_lyrics.json').read_text(encoding='utf-8'))
        self.assertEqual(cache['identity'], ['codylee', '我愛你'])
        self.assertEqual(json.loads(meta_path.read_text(encoding='utf-8')), metadata)

    def test_lyrics_view_coalesces_requests_and_rechecks_synced_cache(self):
        import asyncio
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        async def lookup(*args):
            await asyncio.sleep(.02)
            async with self.runtime.state.cache_lock(item['id']):
                self.worker.save_lyrics(folder, '[00:03.00]Synced arrived')
            return {'id': 5, 'text': 'A plain fallback'}
        with patch.object(self.lyrics, 'plain_record', new_callable=AsyncMock, side_effect=lookup) as mocked:
            async def concurrent():
                return await asyncio.gather(*(self.runtime.lyrics.lyrics_view(item['key']) for _ in range(3)))
            results = asyncio.run(concurrent())
        self.assertEqual(mocked.call_count, 1)
        self.assertTrue(all((r['source'], r['text']) == ('synced', 'Synced arrived') for r in results))
        self.assertFalse((folder / 'plain_lyrics.json').exists())

    def test_lyrics_view_identity_mismatch_and_network_error_are_isolated(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        cache = folder / 'plain_lyrics.json'
        cache.write_text(json.dumps({'identity': ['old-artist', 'old-song'], 'status': 'ready', 'text': 'stale', 'checked_at': 1}), encoding='utf-8')
        async def fail(*args): raise RuntimeError('offline')
        with patch.object(self.lyrics, 'plain_record', new_callable=AsyncMock, side_effect=fail) as mocked:
            first = self.client.get(f"/api/lyrics/view/{item['key']}").json()
            second = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((first['status'], second['status']), ('error', 'error'))
        self.assertEqual(mocked.call_count, 1)
        saved = json.loads(cache.read_text(encoding='utf-8'))
        self.assertEqual((saved['identity'], saved['text']), (['old-artist', 'old-song'], 'stale'))

    def test_lyrics_view_negative_cache_expires_after_seven_days(self):
        import json, time
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.upcoming.append(item)
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        with patch.object(self.lyrics, 'plain_record', new_callable=AsyncMock, return_value=None) as mocked:
            self.assertEqual(self.client.get(f"/api/lyrics/view/{item['key']}").json()['status'], 'missing')
            self.assertEqual(item['viewer_lyrics_source'], 'missing')
            self.client.get(f"/api/lyrics/view/{item['key']}")
            self.assertEqual(mocked.call_count, 1)
            cache_path = folder / 'plain_lyrics.json'
            cached = json.loads(cache_path.read_text(encoding='utf-8'));cached['checked_at'] = time.time() - self.lyrics.PLAIN_MISSING_TTL - 1
            cache_path.write_text(json.dumps(cached), encoding='utf-8')
            mocked.return_value = {'id': 8, 'text': 'Fresh lyrics'}
            refreshed = self.client.get(f"/api/lyrics/view/{item['key']}").json()
        self.assertEqual((mocked.call_count, refreshed['text']), (2, 'Fresh lyrics'))

    def test_lyrics_view_resolves_promoted_key_and_rejects_removed_key(self):
        import json
        from ktvibes.queue import State
        item = State.entry('aaaaaaaaaaa', 'Artist', 'Song')
        self.runtime.state.current = item
        folder = Path(self.temp.name) / item['id']; folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 100}), encoding='utf-8')
        async def lookup(*args): return None
        with patch.object(self.lyrics, 'plain_record', lookup):
            response = self.client.get(f"/api/lyrics/view/{item['key']}")
            self.assertEqual(response.json()['status'], 'missing')
        async def selected(record_id): return {'id': record_id, 'syncedLyrics': '[00:01.00]New lyrics'}
        with patch.object(self.lyrics, 'record', selected):
            self.assertEqual(self.client.post(f"/api/queue/{item['key']}/lyrics", json={'id': 3}).status_code, 200)
        self.assertEqual(self.client.get(f"/api/lyrics/view/{item['key']}").json()['text'], 'New lyrics')
        self.assertIs(self.runtime.state.current, item)
        self.assertEqual(self.client.get(f"/api/lyrics/view/{item['key']}").json()['status'], 'ready')
        self.runtime.state.current = None
        self.assertEqual(self.client.get(f"/api/lyrics/view/{item['key']}").status_code, 404)

    def test_lyrics_current_uses_record_id_then_legacy_first_match(self):
        import json
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 100,
                                                       'lyrics_record_id': 202}), encoding='utf-8')
        raw = '[00:01.00]Same lyrics'
        (folder / 'lyrics.lrc').write_text(raw, encoding='utf-8')
        records = [
            {'id': 101, 'trackName': 'Song', 'artistName': 'Artist', 'duration': 100, 'syncedLyrics': raw},
            {'id': 202, 'trackName': 'Song', 'artistName': 'Other Artist', 'duration': 100, 'syncedLyrics': raw},
            {'id': 303, 'trackName': 'Song', 'artistName': 'Artist', 'duration': 100, 'syncedLyrics': '[00:02.00]Other lyrics'},
        ]
        async def search(query, duration):
            return records
        with patch.object(self.lyrics, 'search', search):
            options = self.client.get('/api/songs/aaaaaaaaaaa/lyrics', params={'q': 'Artist Song'}).json()
        self.assertEqual([o['id'] for o in options if o['current']], [202])
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 100}), encoding='utf-8')
        with patch.object(self.lyrics, 'search', search):
            options = self.client.get('/api/songs/aaaaaaaaaaa/lyrics', params={'q': 'Artist Song'}).json()
        self.assertEqual([o['id'] for o in options if o['current']], [101])
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 100,
                                                       'lyrics_record_id': 999}), encoding='utf-8')
        with patch.object(self.lyrics, 'search', search):
            options = self.client.get('/api/songs/aaaaaaaaaaa/lyrics', params={'q': 'Artist Song'}).json()
        self.assertEqual([o['id'] for o in options if o['current']], [])

    def test_identical_manual_lyrics_updates_record_id_without_resetting_offset(self):
        import json
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        raw = '[00:01.00]Same lyrics'
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Artist', 'title': 'Song', 'duration': 100,
                                                       'lyric_offset': 1.5, 'lyrics_revision': 4,
                                                       'lyrics_record_id': 101}), encoding='utf-8')
        (folder / 'lyrics.lrc').write_text(raw, encoding='utf-8')
        self.runtime.state.path = Path(self.temp.name) / 'queue.json'
        item = self.runtime.state.entry('aaaaaaaaaaa', 'Artist', 'Song')
        item.update(status='ready', lyrics_status='ready', lyrics=[{'t': 1, 'text': 'Same lyrics'}], offset=1.5)
        self.runtime.state.upcoming.append(item)
        async def record(record_id):
            return {'id': record_id, 'trackName': 'Song', 'artistName': 'Artist', 'duration': 100, 'syncedLyrics': raw}
        with patch.object(self.lyrics, 'record', record), patch.object(self.worker, 'timed_lyrics', side_effect=AssertionError('alignment should be reused')):
            response = self.client.post(f"/api/queue/{item['key']}/lyrics", json={'id': 202})
        self.assertEqual(response.status_code, 200)
        meta = json.loads((folder / 'meta.json').read_text(encoding='utf-8'))
        self.assertEqual((meta['lyrics_record_id'], meta['lyric_offset'], meta['lyrics_revision']), (202, 1.5, 4))

    def test_queued_lyrics_and_absolute_offset_are_song_specific(self):
        import json
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'Simple Plan', 'title': 'Perfect', 'duration': 280,
                                                       'lyric_offset': 1.2}), encoding='utf-8')
        (folder / 'lyrics.lrc').write_text('[00:10.00]Old lyrics', encoding='utf-8')
        self.runtime.state.path = Path(self.temp.name) / 'queue.json'
        item = self.runtime.state.entry('aaaaaaaaaaa', 'Simple Plan', 'Perfect')
        item.update(status='ready', lyrics_status='ready', lyrics=[{'t': 10, 'text': 'Old lyrics'}], offset=1.2)
        self.runtime.state.upcoming.append(item)
        record = {'id': 7, 'trackName': 'Perfect', 'artistName': 'Simple Plan', 'duration': 278,
                  'syncedLyrics': '[00:12.00]New lyrics'}
        async def fetch(record_id):
            return record if record_id == 7 else None
        with patch.object(self.lyrics, 'record', fetch):
            response = self.client.post(f"/api/queue/{item['key']}/lyrics", json={'id': 7})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(item['lyrics'][0]['text'], 'New lyrics')
        self.assertEqual(item['lyrics_status'], 'ready')
        self.assertEqual((folder / 'lyrics.lrc').read_text(encoding='utf-8'), record['syncedLyrics'])
        self.assertNotIn('lyric_offset', json.loads((folder / 'meta.json').read_text(encoding='utf-8')))
        response = self.client.patch(f"/api/queue/{item['key']}/offset", json={'value': -1.5})
        self.assertEqual((response.status_code, response.json()['offset']), (200, -1.5))
        self.assertEqual(json.loads((folder / 'meta.json').read_text(encoding='utf-8'))['lyric_offset'], -1.5)
        preview = self.client.get(f"/api/queue/{item['key']}/lyrics")
        self.assertEqual((preview.status_code, preview.json()['offset']), (200, -1.5))

    def test_queued_lyrics_settings_require_ready_song_and_validate_offset(self):
        import json
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'IU', 'title': 'Song', 'duration': 100}), encoding='utf-8')
        item = self.runtime.state.entry('aaaaaaaaaaa', 'IU', 'Song')
        self.runtime.state.upcoming.append(item)
        self.assertEqual(self.client.get(f"/api/queue/{item['key']}/lyrics").status_code, 409)
        self.assertEqual(self.client.patch(f"/api/queue/{item['key']}/offset", json={'value': 'NaN'}).status_code, 422)

    def test_recent_lists_played_songs_newest_first(self):
        import json
        cache = Path(self.temp.name)
        for index, (video_id, stems) in enumerate([('aaaaaaaaaaa', True), ('bbbbbbbbbbb', True), ('ccccccccccc', False), ('ddddddddddd', True)]):
            folder = cache / video_id
            folder.mkdir()
            (folder / 'meta.json').write_text(json.dumps({'artist': '아이유', 'title': f'Song {index}'}), encoding='utf-8')
            if stems:
                (folder / 'no_vocals.wav').touch()
                (folder / 'vocals.wav').touch()
        # ddd is prepared but never played; ccc was played but its stems are gone.
        self.runtime.state.played = {'aaaaaaaaaaa': 1.0, 'bbbbbbbbbbb': 2.0, 'ccccccccccc': 3.0}
        songs = self.client.get('/api/recent').json()
        self.assertEqual([s['id'] for s in songs], ['bbbbbbbbbbb', 'aaaaaaaaaaa'])
        self.assertEqual(songs[0]['artist'], '아이유')

    def test_songbook_lists_numbered_prepared_songs_in_order(self):
        import json
        cache = Path(self.temp.name)
        for video_id, number in [('aaaaaaaaaaa', 10002), ('bbbbbbbbbbb', 10001), ('ccccccccccc', None)]:
            folder = cache / video_id
            folder.mkdir()
            meta = {'artist': '아이유', 'title': video_id, **({'number': number} if number else {})}
            (folder / 'meta.json').write_text(json.dumps(meta), encoding='utf-8')
            (folder / 'no_vocals.wav').touch()
            (folder / 'vocals.wav').touch()
        songs = self.client.get('/api/songbook').json()
        self.assertEqual([(s['number'], s['id']) for s in songs], [(10001, 'bbbbbbbbbbb'), (10002, 'aaaaaaaaaaa')])
        self.assertIsInstance(songs[0]['prepared'], float)

    def test_delete_song_removes_download_and_history(self):
        import json
        cache = Path(self.temp.name)
        folder = cache / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text(json.dumps({'artist': 'IU', 'title': 'Blueming'}), encoding='utf-8')
        (folder / 'no_vocals.flac').touch()
        (folder / 'vocals.flac').touch()
        self.runtime.state.played = {'aaaaaaaaaaa': 1.0}
        self.assertEqual(len(self.client.get('/api/recent').json()), 1)
        self.assertEqual(self.client.delete('/api/songs/aaaaaaaaaaa').status_code, 200)
        self.assertFalse(folder.exists())
        self.assertEqual(self.runtime.state.played, {})
        self.assertEqual(self.client.get('/api/recent').json(), [])
        self.assertEqual(self.client.delete('/api/songs/aaaaaaaaaaa').status_code, 404)
        self.assertEqual(self.client.delete('/api/songs/..%2F..%2Fetc').status_code, 404)

    def test_delete_refuses_queued_song(self):
        song = {'id': 'abcdefghijk', 'artist': 'IU', 'title': '좋은 날'}
        (Path(self.temp.name) / song['id']).mkdir()
        self.client.post('/api/queue', json=song)
        response = self.client.delete(f"/api/songs/{song['id']}")
        self.assertEqual(response.status_code, 409)
        self.assertTrue((Path(self.temp.name) / song['id']).is_dir())

    def test_ambient_lists_cached_videos(self):
        cache = Path(self.temp.name)
        for video_id in ('bbbbbbbbbbb', 'aaaaaaaaaaa', 'not-an-id'):
            (cache / video_id).mkdir()
            (cache / video_id / 'video.mp4').touch()
            if video_id != 'aaaaaaaaaaa':  # a failed song leaves its video without stems
                for name in ('vocals', 'no_vocals'):
                    (cache / video_id / f'{name}.opus').touch()
        (cache / 'ccccccccccc').mkdir()  # audio only
        self.assertEqual(self.client.get('/api/ambient').json(), ['bbbbbbbbbbb'])

    def test_duplicate_queue_requests_create_separate_entries(self):
        song = {'id': 'abcdefghijk', 'artist': 'IU', 'title': '좋은 날'}
        self.assertEqual(self.client.post('/api/queue', json=song).status_code, 201)
        response = self.client.post('/api/queue', json=song)
        self.assertEqual(response.status_code, 201)
        items = self.runtime.state.upcoming
        self.assertEqual([item['id'] for item in items], [song['id'], song['id']])
        self.assertNotEqual(items[0]['key'], items[1]['key'])

    def test_queue_next_adds_or_prioritizes_without_unneeded_duplicates(self):
        first = {'id': 'abcdefghijk', 'artist': 'IU', 'title': 'First'}
        second = {'id': '12345678901', 'artist': 'Aimer', 'title': 'Second'}
        self.client.post('/api/queue', json=first)
        second_entry = self.client.post('/api/queue', json=second).json()
        moved = self.client.post('/api/queue/next', json=second).json()
        self.assertTrue(moved['moved'])
        self.assertEqual(moved['item']['key'], second_entry['key'])
        self.assertEqual(self.runtime.state.upcoming[0]['key'], second_entry['key'])
        already = self.client.post('/api/queue/next', json=second).json()
        self.assertTrue(already['already_next'])
        self.assertEqual(len(self.runtime.state.upcoming), 2)

    def test_recent_defaults_to_ten_cached_played_songs(self):
        songs = {f'{number:011d}': {'id': f'{number:011d}', 'artist': 'A', 'title': str(number)}
                 for number in range(12)}
        self.runtime.state.played = {video_id: float(number) for number, video_id in enumerate(songs)}
        with patch.object(self.runtime.library, 'prepared_songs', return_value=songs):
            result = self.client.get('/api/recent').json()
            self.assertEqual(len(result), 10)
            self.assertEqual([song['id'] for song in result], list(reversed(list(songs)[-10:])))

    def test_unicode_input_validation_and_static_pages(self):
        for route in ('/', '/tv', '/remote', '/static/tv.js', '/api/qr.svg'):
            self.assertEqual(self.client.get(route).status_code, 200)
        song = {'id': 'abcdefghijk', 'artist': '周杰倫', 'title': '晴天 / 좋은 날'}
        response = self.client.post('/api/queue', json=song)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['title'], song['title'])
        self.assertEqual(self.client.post('/api/queue', json={**song, 'id': '../secret'}).status_code, 422)
        self.assertEqual(self.client.post('/api/queue', json={**song, 'artist': '  '}).status_code, 422)

    def test_media_range_and_allowlist(self):
        folder = Path(self.temp.name) / 'abcdefghijk'
        folder.mkdir()
        (folder / 'video.mp4').write_bytes(b'0123456789')
        response = self.client.get('/media/abcdefghijk/video.mp4', headers={'Range': 'bytes=2-5'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'2345')
        self.assertEqual(response.headers['content-type'], 'video/mp4')
        self.assertEqual(self.client.get('/media/abcdefghijk/meta.json').status_code, 404)
        (folder / 'vocals.flac').write_bytes(b'fLaC')
        self.assertEqual(self.client.get('/media/abcdefghijk/vocals').headers['content-type'], 'audio/flac')
        (folder / 'vocals.opus').write_bytes(b'OggS')
        self.assertEqual(self.client.get('/media/abcdefghijk/vocals').headers['content-type'], 'audio/ogg')
        self.assertEqual(self.client.get('/media/abcdefghijk/vocals.flac').status_code, 404)

    def test_websocket_controls(self):
        with self.client.websocket_connect('/ws?role=tv') as tv:
            first = tv.receive_json()
            self.assertTrue(first['player_connected'])
            self.assertRegex(first['build'], r'^[0-9a-f]{12}$')  # pages reload when this changes
            tv.send_json({'action': 'vocal', 'value': .6})
            self.assertEqual(tv.receive_json()['vocal'], .6)
            tv.send_json({'action': 'offset', 'delta': .5})
            self.assertEqual(tv.receive_json()['offset'], .5)
            tv.send_json({'action': 'pause'})
            self.assertFalse(tv.receive_json()['playing'])
            tv.send_json({'action': 'vocal', 'value': 'NaN'})
            self.assertEqual(tv.receive_json()['type'], 'error')

    def test_reactions_reach_only_the_tv(self):
        with self.client.websocket_connect('/ws?role=tv') as tv:
            tv.receive_json()
            with self.client.websocket_connect('/ws?role=remote') as remote:
                tv.receive_json()
                remote.receive_json()
                revision = self.runtime.state.revision
                remote.send_json({'action': 'react', 'value': '🔥'})
                self.assertEqual(tv.receive_json(), {'type': 'react', 'value': '🔥'})
                self.assertEqual(self.runtime.state.revision, revision)  # no broadcast, nothing saved
                remote.send_json({'action': 'react', 'value': '💩'})
                self.assertEqual(remote.receive_json()['message'], 'Unknown reaction')

    def test_newest_tv_takes_over(self):
        with self.client.websocket_connect('/ws?role=tv') as old:
            self.assertEqual(old.receive_json()['type'], 'state')
            with self.client.websocket_connect('/ws?role=tv') as new:
                self.assertEqual(new.receive_json()['type'], 'state')
                self.assertEqual(old.receive_json()['message'], 'Another device took over playback.')
                self.assertTrue(self.runtime.state.player is not None)

    def test_remote_url_uses_configured_port(self):
        with patch.object(self.runtime, 'port', 9999), patch.dict('os.environ', {'KTVIBES_REMOTE_URL': ''}):
            self.assertTrue(self.runtime.remote_url().endswith(':9999/remote'))
        for configured in ('http://pc:8765', 'http://pc:8765/', 'http://pc:8765/remote'):
            with patch.dict('os.environ', {'KTVIBES_REMOTE_URL': configured}):
                self.assertEqual(self.runtime.remote_url(), 'http://pc:8765/remote')

    def test_search_marks_prepared_songs(self):
        folder = Path(self.temp.name) / 'aaaaaaaaaaa'
        folder.mkdir()
        (folder / 'meta.json').write_text('{"artist": "Joji", "title": "Glimpse of Us"}', encoding='utf-8')
        (folder / 'no_vocals.wav').touch()
        (folder / 'vocals.wav').touch()
        results = [{'id': 'aaaaaaaaaaa'}, {'id': 'bbbbbbbbbbb'}]
        with patch.object(self.youtube, 'search', return_value=results):
            found = self.client.get('/api/search', params={'q': 'joji'}).json()
        self.assertEqual([r['cached'] for r in found], [True, False])

    def test_search_pages(self):
        with patch.object(self.youtube, 'search', return_value=[]) as search:
            self.assertEqual(self.client.get('/api/search', params={'q': '晴天', 'page': 2}).status_code, 200)
            search.assert_called_once_with('晴天', 2)
            self.assertEqual(self.client.get('/api/search', params={'q': 'x', 'page': 10}).status_code, 422)
