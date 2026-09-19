"""HTTP/WebSocket contract checks, runnable once uv sync installs dependencies."""
import asyncio
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

AVAILABLE = all(importlib.util.find_spec(name) for name in ('fastapi', 'httpx', 'soundfile', 'qrcode'))

@unittest.skipUnless(AVAILABLE, 'Run uv sync to install API test dependencies')
class APITests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from ktvibes import main
        from ktvibes.queue import State
        self.main = main
        self.temp = tempfile.TemporaryDirectory()
        async def idle_worker(*args):
            await asyncio.Event().wait()
        self.patches = [patch.object(main, 'state', State()), patch.object(main, 'CACHE', Path(self.temp.name)),
                        patch.object(main.worker, 'run', idle_worker)]
        for item in self.patches:
            item.start()
        self.client_context = TestClient(main.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_recent_lists_prepared_songs_newest_first(self):
        import json, os
        cache = Path(self.temp.name)
        for index, (video_id, stems) in enumerate([('aaaaaaaaaaa', True), ('bbbbbbbbbbb', True), ('ccccccccccc', False)]):
            folder = cache / video_id
            folder.mkdir()
            (folder / 'meta.json').write_text(json.dumps({'artist': '아이유', 'title': f'Song {index}'}), encoding='utf-8')
            os.utime(folder / 'meta.json', (index, index))
            if stems:
                (folder / 'no_vocals.wav').touch()
        songs = self.client.get('/api/recent').json()
        self.assertEqual([s['id'] for s in songs], ['bbbbbbbbbbb', 'aaaaaaaaaaa'])
        self.assertEqual(songs[0]['artist'], '아이유')

    def test_unicode_input_validation_and_static_pages(self):
        for route in ('/', '/tv', '/static/tv.js', '/api/qr.svg'):
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

    def test_websocket_controls(self):
        with self.client.websocket_connect('/ws?role=tv') as tv:
            self.assertTrue(tv.receive_json()['player_connected'])
            tv.send_json({'action': 'vocal', 'value': .6})
            self.assertEqual(tv.receive_json()['vocal'], .6)
            tv.send_json({'action': 'offset', 'delta': .5})
            self.assertEqual(tv.receive_json()['offset'], .5)
            tv.send_json({'action': 'pause'})
            self.assertFalse(tv.receive_json()['playing'])
            tv.send_json({'action': 'vocal', 'value': 'NaN'})
            self.assertEqual(tv.receive_json()['type'], 'error')

    def test_newest_tv_takes_over(self):
        with self.client.websocket_connect('/ws?role=tv') as old:
            self.assertEqual(old.receive_json()['type'], 'state')
            with self.client.websocket_connect('/ws?role=tv') as new:
                self.assertEqual(new.receive_json()['type'], 'state')
                self.assertEqual(old.receive_json()['message'], 'Another TV took over playback.')
                self.assertTrue(self.main.state.player is not None)

    def test_search_pages(self):
        with patch.object(self.main.youtube, 'search', return_value=[]) as search:
            self.assertEqual(self.client.get('/api/search', params={'q': '晴天', 'page': 2}).status_code, 200)
            search.assert_called_once_with('晴天', 2)
            self.assertEqual(self.client.get('/api/search', params={'q': 'x', 'page': 10}).status_code, 422)
