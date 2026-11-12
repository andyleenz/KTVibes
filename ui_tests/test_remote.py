from datetime import datetime, timedelta, timezone
import math
import re

import pytest
from playwright.sync_api import expect


def center(locator):
    box = locator.bounding_box()
    assert box
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag(page, start, end):
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=12)
    page.mouse.up()


def touch_scroll(page, start, end):
    """Chromium input, including native gesture arbitration and scrolling."""
    session = page.context.new_cdp_session(page)
    session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1]}]})
    for step in range(1, 13):
        x = start[0] + (end[0] - start[0]) * step / 12
        y = start[1] + (end[1] - start[1]) * step / 12
        session.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    session.detach()


def open_settings(page):
    page.get_by_role("button", name="Settings", exact=True).click()
    page.wait_for_function("document.querySelector('#sheet').getBoundingClientRect().bottom <= innerHeight + 1")


@pytest.mark.parametrize("control,action", [("vocal", "vocal"), ("music", "music"), ("speed", "speed"), ("lyric-scale", "lyric_scale")])
def test_sliders_require_thumb_drag(remote, page, control, action):
    open_settings(page)
    slider = page.locator(f"#{control}")
    slider.scroll_into_view_if_needed()
    original = slider.input_value()
    box = slider.bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.click(box["x"] + box["width"] * .08, y)
    expect(slider).to_have_value(original)
    assert not [m for m in remote.commands if m["action"] == action]
    ratio = slider.evaluate("e => (e.value-e.min)/(e.max-e.min)")
    x = box["x"] + 2 + ratio * (box["width"] - 4)
    drag(page, (x, y), (x + 55, y))
    expect(slider).not_to_have_value(original)
    page.wait_for_function("document.querySelector('#connection-label').textContent === 'Ready'")
    remote.wait_command(action, value=float(slider.input_value()))
    updates = [m for m in remote.commands if m["action"] == action]
    assert updates and updates[-1]["value"] == pytest.approx(float(slider.input_value()))


def test_mobile_scroll_across_thumb_does_not_adjust_volume(remote, page):
    if not page.context.browser or page.viewport_size["width"] > 600:
        pytest.skip("Native touch scrolling applies to the mobile profile")
    open_settings(page)
    slider = page.locator("#vocal")
    box = slider.bounding_box()
    start = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    touch_scroll(page, start, (start[0], start[1] - 150))
    page.wait_for_function("document.querySelector('#sheet').scrollTop > 30")
    expect(slider).to_have_value("0.5")
    assert not [m for m in remote.commands if m["action"] == "vocal"]
    sheet = page.get_by_role("dialog", name="Settings")
    for _ in range(4):
        touch_scroll(page, (195, 700), (195, 300))
        page.wait_for_timeout(80)  # Let native scrolling commit between gestures.
    theme = sheet.get_by_role("button", name="Default", exact=True)
    expect(theme).to_be_in_viewport()
    theme.click()
    assert "sheet-open" in page.locator("body").get_attribute("class")
    page.locator("#sheet").evaluate("e => e.scrollTop = 0")
    start = center(page.locator("#sheet-handle"))
    drag(page, start, (start[0], start[1] + 130))
    expect(page.locator("body")).not_to_have_class("sheet-open")


def test_seek_preview_follows_drag_and_survives_stale_update(remote, page):
    bar = page.get_by_role("slider", name="Song position")
    box = bar.bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.click(box["x"] + box["width"] * .8, y)
    expect(bar).to_have_attribute("aria-valuenow", "60")
    assert not remote.commands
    page.mouse.move(box["x"] + box["width"] * .25, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * .65, y, steps=10)
    expected = float(bar.get_attribute("aria-valuenow"))
    assert math.isclose(expected, 156, abs_tol=2)
    assert not [m for m in remote.commands if m["action"] == "seek"]
    page.mouse.up()
    expect(bar).to_have_attribute("aria-valuenow", str(expected))
    remote.push()  # TV still reports its old 60-second position.
    expect(bar).to_have_attribute("aria-valuenow", str(expected))
    remote.wait_command("seek", position=expected)
    assert remote.commands[-1]["action"] == "seek"
    assert remote.commands[-1]["position"] == pytest.approx(expected)
    remote.state.update(position=expected, seek_id=1)
    remote.push()
    expect(bar).to_have_attribute("aria-valuenow", str(expected))


def queue_keys(page):
    return page.locator("#queue .queue-swipe").evaluate_all("rows => rows.map(e => e.dataset.key)")


def test_queue_drag_preserves_rows_during_state_updates(remote, page):
    page.locator("#queue").scroll_into_view_if_needed()
    first = page.locator('#queue [data-key="one"]')
    first.evaluate("e => e.dataset.testIdentity = 'original'")
    start = center(first.locator("h3"))
    last = center(page.locator('#queue [data-key="three"] h3'))
    page.mouse.move(*start)
    page.mouse.down()
    expect(first).to_have_class("swipe queue-swipe lifted")
    remote.state["upcoming"][1].update(status="downloading", progress=.4)
    remote.push()
    expect(first).to_have_attribute("data-test-identity", "original")
    page.mouse.move(last[0], last[1] + 15, steps=10)
    page.mouse.up()
    expect(page.locator("#queue .queue-swipe").first).to_have_attribute("data-key", "two")
    assert queue_keys(page) == ["two", "three", "one"]
    assert {"action": "reorder", "keys": ["two", "three", "one"]} in remote.commands


def test_queue_swipe_next_and_remove(remote, page):
    page.locator("#queue").scroll_into_view_if_needed()
    row = page.locator('#queue [data-key="three"]')
    start = center(row.locator("h3"))
    drag(page, start, (start[0] + 110, start[1]))
    expect(page.locator("#queue .queue-swipe").first).to_have_attribute("data-key", "three")
    row = page.locator('#queue [data-key="two"]')
    start = center(row.locator("h3"))
    drag(page, start, (start[0] - 110, start[1]))
    row.get_by_role("button", name="Remove Second Song from the queue").click()
    expect(row).to_have_count(0)
    assert {"action": "remove", "key": "two"} in remote.commands


def test_search_add_duplicate_and_insert_next(remote, page):
    page.get_by_role("combobox", name="Search songs").fill("Recent Song")
    page.locator("#search-button").click()
    result = page.locator("#results .result")
    result.locator("strong").click()
    assert not [r for r in remote.requests if r[0] == "POST"]
    add = result.locator(".result-add")
    add.click()
    expect(page.locator("#queue-count")).to_have_text("4")
    add.click()  # Existing copy requires confirmation.
    expect(result).to_have_attribute("data-confirm", "1")
    add.click()
    expect(page.locator("#queue-count")).to_have_text("5")
    keys = queue_keys(page)
    assert len(keys) == len(set(keys)) == 5
    result.get_by_role("button", name="Add Recent Song to play next", exact=True).click()
    expect(page.locator("#queue .queue-swipe h3").first).to_have_text("Recent Song")
    expect(page.locator("#queue-count")).to_have_text("5")
    posts = [path for method, path, _ in remote.requests if method == "POST"]
    assert posts.count("/api/queue") == 2
    assert posts[-1] == "/api/queue/next"
    body = next(body for method, path, body in reversed(remote.requests)
                if method == "POST" and path == "/api/queue/next")
    assert body["artist"] == "Test Artist"
    assert body["title"] == "Recent Song"
    for selector in ("#results .result", "#recent .result"):
        row = page.locator(selector).first
        bounds = row.bounding_box()
        action = row.locator(".recent-next").bounding_box()
        assert 0 <= bounds["x"] + bounds["width"] - action["x"] - action["width"] <= 12
        assert row.locator(".result-info").bounding_box()["width"] > 100


def test_recent_swipe_reveals_delete_without_adding_song(remote, page):
    recent = page.locator("#recent .swipe").first
    recent.scroll_into_view_if_needed()
    start = center(recent.locator(".result strong"))
    drag(page, start, (start[0] - 110, start[1]))
    expect(recent).to_have_class("swipe open")
    expect(recent.get_by_role("button", name="Delete Recent Song from this device")).to_be_in_viewport()
    assert not [r for r in remote.requests if r[0] == "POST"]


def test_recent_song_only_queues_from_explicit_actions(remote, page):
    result = page.locator("#recent .result").first
    result.locator("strong").click()
    assert not [r for r in remote.requests if r[0] == "POST"]
    result.locator(".result-add").click()
    expect(page.locator("#queue-count")).to_have_text("4")
    result.get_by_role("button", name="Add Recent Song to play next").click()
    expect(page.locator("#queue-count")).to_have_text("4")
    assert [path for method, path, _ in remote.requests if method == "POST"] == ["/api/queue", "/api/queue/next"]


@pytest.mark.parametrize("kind", ["Synced", "Plain"])
def test_lyrics_view_search_and_selection(remote, page, kind):
    page.locator("#hero-lyrics").click()
    expect(page.locator(".lyric-reader")).to_contain_text("風が呼んでいる")
    original = page.locator(".lyric-reader").evaluate("e => getComputedStyle(e).fontSize")
    page.get_by_role("button", name="Increase lyrics font size").click()
    expect(page.locator(".lyric-reader")).to_have_css("font-size", f"{int(float(original[:-2])) + 1}px")
    page.get_by_role("button", name="Select Lyrics", exact=True).click()
    expect(page.locator(".lyric-option")).to_contain_text("Fixture Lyrics")
    term = page.locator(".lyric-search-term").first
    expect(term).to_have_attribute("aria-pressed", "true")
    term.click()
    expect(term).to_have_attribute("aria-pressed", "false")
    page.get_by_role("searchbox", name="Search lyrics").fill("custom Japanese query")
    page.locator(".lyric-search button").click()
    page.get_by_role("button", name=f"Use {kind}", exact=True).click()
    expect(page.locator(".lyric-view-status")).to_have_text(f"{kind} lyrics")
    posts = [(path, body) for method, path, body in remote.requests if method == "POST"]
    expected_path = "/api/lyrics/plain/current" if kind == "Plain" else "/api/songs/aaaaaaaaaaa/lyrics"
    assert posts[-1] == (expected_path, {"id": 42})
    assert remote.search_queries[-1] == "custom Japanese query"


def test_empty_lyrics_results_allow_marking_unavailable(remote, page):
    remote.empty_results = True
    page.locator("#hero-lyrics").click()
    page.get_by_role("button", name="Select Lyrics", exact=True).click()
    expect(page.locator(".lyric-none")).to_be_visible()
    page.get_by_role("button", name="No suitable lyrics", exact=True).click()
    expect(page.get_by_role("button", name="Marked as unavailable")).to_be_disabled()
    assert ("POST", "/api/lyrics/unavailable/current", None) in remote.requests


@pytest.mark.parametrize("status,seconds", [(503, 1), (429, 5)])
def test_lyrics_error_disables_search_until_cooldown(remote, page, status, seconds):
    page.clock.install()
    page.clock.pause_at(datetime.now(timezone.utc) + timedelta(seconds=1))
    remote.search_error = (status, seconds)
    page.locator("#hero-lyrics").click()
    page.get_by_role("button", name="Select Lyrics", exact=True).click()
    search = page.locator(".lyric-search button")
    expect(search).to_be_disabled()
    expect(page.locator(".lyric-options .error")).to_contain_text(f"wait {seconds} second")
    expect(page.get_by_role("button", name="Retry", exact=True)).to_have_count(0)
    before = len(remote.requests)
    page.clock.run_for(seconds * 1000 - 1)
    expect(search).to_be_disabled()
    assert len(remote.requests) == before
    page.clock.run_for(1)
    expect(search).to_be_enabled()
    remote.search_error = None
    search.click()
    expect(page.locator(".lyric-option")).to_be_visible()


@pytest.mark.parametrize("source,label", [("processing", "Checking…"), ("synced", "Synced"), ("plain", "Plain"), ("missing", "No lyrics"), ("error", "Issue")])
def test_queue_lyrics_status_targets_the_correct_song(remote, page, source, label):
    remote.state["upcoming"][1]["viewer_lyrics_source"] = source
    remote.push()
    button = page.locator('#queue [data-key="two"] .lyrics-button')
    expect(button).to_have_text(label)
    button.click()
    expect(page.locator(".lyric-reader")).to_be_visible()
    assert any(path == "/api/lyrics/view/two" for _, path, _ in remote.requests)


def test_layout_switches_at_wide_screen_breakpoint(remote, page):
    if page.viewport_size["width"] < 600:
        pytest.skip("Breakpoint resizing is covered by the desktop profile")
    for width, wide in [(959, False), (960, True), (1440, True), (390, False)]:
        page.set_viewport_size({"width": width, "height": 1000})
        browse = page.locator("#search-form").bounding_box()
        hero = page.locator("#hero").bounding_box()
        if wide:
            assert hero["x"] >= browse["x"] + browse["width"]
        else:
            assert hero["y"] >= browse["y"] + browse["height"]
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")


def test_mobile_recent_vertical_scroll_does_not_queue_or_reveal(remote, page):
    if page.viewport_size["width"] > 600:
        pytest.skip("Native touch scrolling applies to the mobile profile")
    remote.recent = [{**remote.recent[0], "id": f"{i:011d}", "title": f"Recent {i}"} for i in range(12)]
    page.reload()
    expect(page.locator("#recent .swipe")).to_have_count(12)
    page.locator("#recent").evaluate("e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 400)")
    row = page.locator("#recent .result").first
    start = center(row.locator("strong"))
    before = page.evaluate("scrollY")
    touch_scroll(page, start, (start[0] - 5, start[1] - 180))
    page.wait_for_function("before => scrollY > before + 30", arg=before)
    expect(page.locator("#recent .swipe.open")).to_have_count(0)
    assert not [r for r in remote.requests if r[0] == "POST"]


def test_update_notice_opens_release_popover(remote, page):
    remote.update = {"version": "v0.7.2", "url": "https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/v0.7.2"}
    page.reload()
    button = page.locator("#connection")
    expect(button).to_be_visible()
    expect(page.locator("#connection")).to_have_class(re.compile("has-update"))
    expect(page.locator("#connection-label")).to_have_text("Ready")
    assert button.evaluate("e => getComputedStyle(e).borderRadius") == "999px"
    assert button.evaluate("e => getComputedStyle(e).cursor") == "default"
    assert button.evaluate("e => getComputedStyle(e).transform") == "none"
    page.emulate_media(reduced_motion="no-preference")
    assert button.locator("svg").evaluate("e => getComputedStyle(e).animationName") == "update-icon-breathe"
    assert button.locator("svg").evaluate("e => getComputedStyle(e).animationDuration") == "3.6s"
    assert button.locator("svg").evaluate("e => Math.abs(e.getBoundingClientRect().width-e.parentElement.getBoundingClientRect().width) < 0.1")
    page.emulate_media(reduced_motion="reduce")
    assert button.locator("svg").evaluate("e => getComputedStyle(e).animationName") == "none"
    if page.viewport_size["width"] <= 600:
        button.click()
    else:
        box = button.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(100)
        expect(page.locator("#update-popover")).to_be_hidden()
        page.wait_for_timeout(250)
    expect(page.locator("#update-popover")).to_be_visible()
    expect(page.locator("#current-version")).to_have_text("v0.7.1")
    expect(page.locator("#version-arrow")).to_have_text("→")
    expect(page.locator("#update-link")).to_have_text("v0.7.2")
    expect(page.locator("#update-link")).to_have_attribute("href", remote.update["url"])
    page.keyboard.press("Escape")
    expect(page.locator("#update-popover")).to_be_hidden()
    if page.viewport_size["width"] > 600:
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        expect(button).to_be_focused()
        expect(page.locator("#update-popover")).to_be_visible()


def test_current_version_popover_without_update(remote, page):
    expect(page.locator("#connection")).to_be_visible()
    expect(page.locator("#connection")).not_to_have_class(re.compile("has-update"))
    if page.viewport_size["width"] <= 600:
        page.locator("#connection").click()
    else:
        button = page.locator("#connection")
        box = button.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(100)
        expect(page.locator("#update-popover")).to_be_hidden()
        page.wait_for_timeout(250)
    expect(page.locator("#update-popover")).to_be_visible()
    expect(page.locator("#version-heading")).to_have_text("Current version")
    expect(page.locator("#current-version")).to_have_text("v0.7.1")
    expect(page.locator("#version-arrow")).to_be_hidden()
    expect(page.locator("#update-link")).to_be_hidden()


def test_update_notice_requires_ready_device(remote, page):
    remote.update = {"version": "v0.7.2", "url": "https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/v0.7.2"}
    remote.state["player_audio"] = False
    page.reload()
    expect(page.locator("#connection-label")).to_have_text("Sound disabled")
    expect(page.locator("#connection")).not_to_have_class(re.compile("has-update"))


def test_version_popover_cannot_reopen_while_disconnected(remote, page):
    remote.update = {"version": "v0.7.2", "url": "https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/v0.7.2"}
    page.reload()
    button = page.locator("#connection")
    if page.viewport_size["width"] <= 600:
        button.click()
    else:
        button.hover()
    expect(page.locator("#update-popover")).to_be_visible()

    remote.socket.close(code=4001, reason="test disconnect")
    expect(page.locator("#connection-label")).to_have_text("Disconnected")
    expect(page.locator("#update-popover")).to_be_hidden()

    if page.viewport_size["width"] <= 600:
        button.click()
    else:
        page.mouse.move(0, 0)
        button.hover()
        page.keyboard.press("Tab")
        page.keyboard.press("Tab")
    expect(page.locator("#update-popover")).to_be_hidden()


def test_lyrics_panel_follows_current_song_changes(remote, page):
    page.locator('#hero-lyrics').click()
    expect(page.locator('.lyric-reader')).to_contain_text('風が呼んでいる')
    remote.state['current'] = remote.state['upcoming'].pop(0)
    with page.expect_request('**/api/lyrics/view/one'):
        remote.push()
    expect(page.locator('.lyric-view-status')).to_have_text('Synced lyrics')
    remote.state['current'] = None
    remote.push()
    expect(page.locator('.lyric-view-status')).to_contain_text('Open Lyrics from the current song')


def test_tv_reports_connection_changes(remote, page, remote_url):
    remote.state.update(current=None, upcoming=[])
    page.route('**/api/ambient', lambda route: route.fulfill(json=[]))
    page.route('**/api/qr.svg', lambda route: route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg"/>'))
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.rsplit('/remote', 1)[0] + '/static/tv.html')
    expect(page.locator('#connection')).to_have_text('Connected')
    remote.socket.close(code=4001, reason='test disconnect')
    expect(page.locator('#connection')).to_have_text('Disconnected')
