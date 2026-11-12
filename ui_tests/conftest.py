"""Serve the shipped Remote assets with deterministic HTTP/WebSocket fixtures.

No KTVibes backend, external network, media downloads or model inference is used.
"""
from copy import deepcopy
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse
import json
import time

import pytest
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]


def song(key, title, video_id="aaaaaaaaaaa"):
    return dict(key=key, id=video_id, title=title, artist="Test Artist", duration=240,
                status="ready", lyrics_status="ready", viewer_lyrics_source="synced",
                thumbnail="/static/favicon-48.png", cached=True)


@pytest.fixture(scope="session")
def remote_url():
    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            self.path = {"/remote": "/remote.html", "/tv": "/tv.html"}.get(self.path, self.path.removeprefix("/static"))
            super().do_GET()

        def log_message(self, *args):
            pass

    class AssetServer(ThreadingHTTPServer):
        # Page navigation loads the app's JS/CSS module graph concurrently.
        request_queue_size = 64

    server = AssetServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT / "static")))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/remote"
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture(params=["desktop", "mobile"])
def browser_context_args(browser_context_args, request):
    mobile = request.param == "mobile"
    return {**browser_context_args, "viewport": {"width": 390 if mobile else 1440,
            "height": 844 if mobile else 1000}, "is_mobile": mobile, "has_touch": mobile,
            "reduced_motion": "reduce", "service_workers": "block"}


class Remote:
    def __init__(self, page):
        self.page = page
        self.socket = None
        self.commands = []
        self.requests = []
        self.unhandled = []
        self.errors = []
        self.recent = [song("recent", "Recent Song", "ddddddddddd")]
        self.search_queries = []
        self.search_error = None
        self.empty_results = False
        self.selection = None
        self.update = None
        self.identities = [dict(id='a'*32, name='Alex', avatar='avatar-01'), dict(id='b'*32, name='Bea', avatar='avatar-02')]
        self.identity_failure = False
        self.state = dict(type="state", current=song("current", "Current Song"),
                          upcoming=[song("one", "First Song"), song("two", "Second Song", "bbbbbbbbbbb"),
                                    song("three", "Third Song", "ccccccccccc")],
                          playing=False, position=60, seek_id=0, offset=0, vocal=.5, music=.5,
                          speed=1, key=0, lyric_scale=1.5, lyric_mode="two", video_mode="show",
                          guide="off", guides=["off", "kana"], theme="default", room_ends=None,
                          time_up=False, player_connected=True, player_audio=True,
                          revision=1, build="ui-fixture", transition_until=0, server_time=0)

    def wait_command(self, action, **fields):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            matches = [m for m in self.commands if m["action"] == action
                       and all(m.get(key) == pytest.approx(value) for key, value in fields.items())]
            if matches:
                return matches[-1]
            self.page.wait_for_timeout(10)
        pytest.fail(f"Missing command {action} {fields}; received {self.commands}")

    def push(self):
        self.socket.send(json.dumps(self.state))

    def websocket(self, ws):
        self.socket = ws
        ws.on_message(self.command)
        self.push()

    def command(self, raw):
        message = json.loads(raw)
        self.commands.append(message)
        action = message["action"]
        if action == "reorder":
            items = {item["key"]: item for item in self.state["upcoming"]}
            self.state["upcoming"] = [items[key] for key in message["keys"]]
        elif action == "remove":
            self.state["upcoming"] = [i for i in self.state["upcoming"] if i["key"] != message["key"]]
        elif action == "seek":
            # Simulate a delayed TV acknowledgement: the UI must keep its preview.
            return
        elif "value" in message:
            self.state[action] = message["value"]
        self.push()

    def api(self, route):
        request = route.request
        path = urlparse(request.url).path
        method = request.method
        body = request.post_data_json if request.post_data else None
        self.requests.append((method, path, body))
        data = {}
        if path == '/api/qr.svg':
            route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>')
            return
        elif path == '/api/identities' and method == 'GET':
            data = dict(identities=self.identities, avatars=[f'avatar-{i:02}' for i in range(1, 11)])
        elif path.startswith('/api/identities'):
            if self.identity_failure:
                route.fulfill(status=503, json={'detail': 'Could not save identity'})
                return
            if path.endswith('/order'):
                by_id = {item['id']: item for item in self.identities}
                self.identities = [by_id[key] for key in body['ids']]
                data = self.identities
            elif method == 'POST':
                data = dict(id='c'*32, **body)
                self.identities.append(data)
            elif method == 'DELETE':
                self.identities = [item for item in self.identities if item['id'] != path.split('/')[-1]]
                route.fulfill(status=204)
                return
            else:
                data = next(item for item in self.identities if item['id'] == path.split('/')[-1])
                data.update(body)
        elif path == "/api/config":
            data = {"remote_url": "http://127.0.0.1/remote", "version": "0.7.1", "update": self.update, "update_check_complete": True}
        elif path == "/api/recent":
            data = self.recent
        elif path in ("/api/suggest", "/api/songbook"):
            data = []
        elif path == '/api/ambient':
            data = []
        elif path == "/api/search":
            data = [{**self.recent[0], "channel": "Test Artist", "parsed": {"artist": "Test Artist", "title": "Recent Song"}}]
            # Real search responses keep the enqueue artist inside parsed.
            data[0].pop("artist", None)
        elif path in ("/api/queue", "/api/queue/next") and method == "POST":
            queue = self.state["upcoming"]
            existing = next((item for item in queue if item["id"] == body["id"]), None)
            if path.endswith("next") and existing:
                index = queue.index(existing)
                queue.insert(0, queue.pop(index))
                data = dict(added=False, moved=index > 0, already_next=index == 0, item=existing)
            else:
                item = song(f"added-{len(self.requests)}", body["title"], body["id"])
                queue.insert(0 if path.endswith("next") else len(queue), item)
                data = dict(added=True, moved=False, already_next=False, item=item) if path.endswith("next") else item
        elif path.startswith("/api/lyrics/view/"):
            data = dict(status="missing") if self.selection == "none" else dict(status="ready", source=self.selection or "synced", text="風が呼んでいる\nJapanese lyrics\n第三行")
        elif path.startswith("/api/lyrics/choices/"):
            self.search_queries.append(parse_qs(urlparse(request.url).query).get("q", [""])[0])
            if self.search_error:
                status, seconds = self.search_error
                route.fulfill(status=status, json={"detail": "Temporary lookup error"}, headers={"Retry-After": str(seconds)})
                return
            data = dict(selection_format=self.selection, results=[] if self.empty_results else [dict(
                id=42, track="Fixture Lyrics", artist="Test Artist", difference=0,
                formats={kind: dict(available=True, current=False, selected=False, active=False,
                                    preview=["風が呼んでいる"], lines=3) for kind in ("synced", "plain")})])
        elif method == "POST" and path.startswith("/api/lyrics/unavailable/"):
            self.selection = "none"
        elif method == "POST" and (path.startswith("/api/lyrics/plain/") or path.endswith("/lyrics")):
            self.selection = "plain" if "/plain/" in path else "synced"
            data = dict(source=self.selection)
        elif method == "GET" and path.startswith("/api/queue/") and path.endswith("/lyrics"):
            data = dict(lyrics=[])
        else:
            self.unhandled.append((method, path))
            route.fulfill(status=500, json={"detail": f"Unhandled test request: {method} {path}"})
            return
        route.fulfill(json=deepcopy(data))


@pytest.fixture
def remote(page, remote_url):
    fixture = Remote(page)
    page.on("pageerror", lambda error: fixture.errors.append(str(error)))
    page.route("**/api/**", fixture.api)
    def reject_external(route):
        fixture.unhandled.append((route.request.method, route.request.url))
        route.abort()

    page.route("https://**/*", reject_external)
    # Use system fonts consistently offline; these tests do not compare font pixels.
    page.route("https://fonts.googleapis.com/**", lambda route: route.fulfill(content_type="text/css", body=""))
    page.route("https://i.ytimg.com/**", lambda route: route.fulfill(status=200, content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>'))
    page.route_web_socket("**/ws?role=remote", fixture.websocket)
    page.goto(remote_url)
    expect(page.locator("#connection-label")).to_have_text("Ready")
    expect(page.locator("#queue .queue-swipe")).to_have_count(3)
    yield fixture
    assert not fixture.errors, fixture.errors
    assert not fixture.unhandled, fixture.unhandled
