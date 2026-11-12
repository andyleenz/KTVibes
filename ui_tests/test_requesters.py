import time
import re
from playwright.sync_api import expect


def person(name='Alex', avatar='avatar-01'):
    return dict(id='a'*32, name=name, avatar=avatar)


def test_remote_current_snapshot_and_duplicate_requests(remote, page):
    remote.state['current']['requester'] = person('Original name')
    remote.state['upcoming'][0]['requester'] = person('Bea', 'avatar-02')
    remote.state['upcoming'][1]['requester'] = person('Guest', None)
    remote.state['upcoming'][1]['id'] = remote.state['upcoming'][0]['id']
    remote.push()
    expect(page.locator('#hero-requester')).to_have_text('Original name')
    expect(page.locator('#dock-requester')).to_have_attribute('aria-label', 'Requested by Original name')
    expect(page.locator('#dock-requester span')).to_have_count(0)
    expect(page.locator('#queue .song-requester').nth(0)).to_have_text('Bea')
    expect(page.locator('#queue .song-requester').nth(1)).to_have_text('Guest')
    expect(page.locator('#queue .song-requester').nth(1).locator('img')).to_have_attribute('src', '/static/favicon-48.png')
    remote.state['current'] = remote.state['upcoming'].pop(0)
    remote.push()
    expect(page.locator('#hero-requester')).to_have_text('Bea')
    remote.state['current'].pop('requester')
    remote.push()
    expect(page.locator('#hero-requester')).to_be_hidden()
    expect(page.locator('#dock-requester')).to_be_hidden()


def test_tv_snapshot_surfaces_and_preparation(remote, page, remote_url):
    remote.state['current']['requester'] = person('A long requester name for the TV')
    remote.state['upcoming'][0]['requester'] = person('Next person', 'avatar-02')
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    for name in ('song', 'card', 'next'):
        expect(page.locator(f'#{name}-requester')).to_have_text('A long requester name for the TV')
    expect(page.locator('#on-deck .song-requester').nth(0)).to_have_text('Next person')
    expect(page.locator('#peek-1 .song-requester')).to_have_text('Next person')
    remote.state['current'] = remote.state['upcoming'].pop(0)
    remote.state['transition_until'] = time.time() + 30
    remote.state['server_time'] = time.time()
    remote.push()
    expect(page.locator('#next-requester')).to_have_text('Next person')
    remote.state['current'] = None
    remote.state['upcoming'][0].update(status='downloading', requester=person('Guest', None))
    remote.push()
    expect(page.locator('#prep-requester')).to_have_text('Guest')
    expect(page.locator('#prep-requester img')).to_have_attribute('src', '/static/favicon-48.png')
    expect(page.locator('#song-requester')).to_be_hidden()
    remote.state['upcoming'][0].pop('requester')
    remote.push()
    expect(page.locator('#prep-requester')).to_be_hidden()


def test_corner_up_next_shows_five_requests(remote, page, remote_url):
    remote.state['upcoming'][0].update(title='A very long title ' * 10, requester=person('A very long identity name ' * 3))
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    rows = page.locator('#on-deck li')
    expect(rows).to_have_count(3)
    expect(rows.first).to_have_attribute('data-key', 'one')
    expect(rows.first.locator('.on-deck-song')).to_have_text('A very long title ' * 10)
    expect(rows.first).not_to_contain_text('Test Artist')
    expect(rows.first.locator('.song-requester')).to_have_text('A very long identity name ' * 3)
    assert rows.first.locator('.on-deck-song').evaluate("el => getComputedStyle(el).textOverflow") == 'ellipsis'
    remote.state['upcoming'][0], remote.state['upcoming'][1] = remote.state['upcoming'][1], remote.state['upcoming'][0]
    remote.push()
    expect(rows.first).to_have_attribute('data-key', 'two')
    expect(rows.first.locator('.song-requester')).to_be_hidden()
    remote.state['current'] = remote.state['upcoming'].pop(0)
    remote.push()
    expect(rows.first).to_have_attribute('data-key', 'one')
    remote.state['upcoming'][0]['status'] = 'error'
    remote.push()
    expect(rows.first).to_have_attribute('data-key', 'three')
    remote.state['upcoming'] = []
    remote.push()
    expect(rows).to_have_count(1)
    expect(rows.first).to_have_text('Nothing queued')
    remote.state['upcoming'] = [dict(remote.state['current'], key=f'queued-{i}') for i in range(7)]
    remote.push()
    expect(rows).to_have_count(5)


def test_tv_brand_qr_and_empty_layout(remote, page, remote_url):
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    expect(page.locator('#player-join')).to_be_visible()
    expect(page.locator('#player-join img')).to_have_attribute('src', re.compile(r'^/api/qr.svg\?branded=true(?:&address=.*)?$'))
    expect(page.locator('.player-brand > .brand')).to_have_css('opacity', '0')
    expect(page.locator('#corner-join')).to_be_hidden()
    remote.state.update(current=None, upcoming=[])
    remote.push()
    expect(page.locator('.player-brand > .brand')).to_be_visible()
    expect(page.locator('#player-join')).to_be_hidden()
    expect(page.locator('.top-queue')).to_be_hidden()
    expect(page.locator('.join')).to_be_visible()
    expect(page.locator('.join img')).to_have_attribute('src', re.compile(r'^/api/qr.svg\?branded=true(?:&address=.*)?$'))
    expect(page.locator('#remote-url')).not_to_be_empty()
    expect(page.locator('.join small')).to_be_hidden()
    remote.state['theme'] = 'classic'
    remote.push()
    expect(page.locator('.join img')).to_have_attribute('src', re.compile(r'^/api/qr.svg(?:\?address=.*)?$'))
    expect(page.locator('#player-join')).to_be_hidden()


def test_tv_brand_rotation_keeps_header_aligned(remote, page, remote_url):
    page.set_viewport_size({'width': 1920, 'height': 1080})
    page.clock.install()
    remote.state['current']['requester'] = person('Fox')
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    qr = page.locator('#player-join img')
    brand = page.locator('.player-brand > .brand')
    card = page.locator('#now-card')
    expect(qr).to_be_visible()
    initial = card.bounding_box()
    qr_box = qr.bounding_box()
    brand_box = brand.bounding_box()
    assert abs(qr_box['x'] + qr_box['width']/2 - brand_box['x'] - brand_box['width']/2) < 1
    assert abs(qr_box['y'] - brand_box['y']) < 1
    assert abs(qr_box['y'] - initial['y']) < 1
    assert abs(initial['x'] - (qr_box['x'] + qr_box['width']) - 24) < 1
    stage = page.locator('.stage').bounding_box()
    page.clock.run_for(7500)
    expect(brand).to_have_css('opacity', '1')
    assert card.bounding_box() == initial
    assert page.locator('.stage').bounding_box() == stage
    page.clock.run_for(6600)
    expect(brand).to_have_css('opacity', '0')
    assert card.bounding_box() == initial


def test_tv_refreshes_qr_when_network_address_changes(remote, page, remote_url):
    config = {'remote_url': 'http://192.168.1.10:8765/remote'}
    page.route('**/api/config', lambda route: route.fulfill(json=config))
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    expect(page.locator('#remote-url')).to_have_text(config['remote_url'])
    config['remote_url'] = 'http://192.168.2.10:8765/remote'
    expect(page.locator('#remote-url')).to_have_text(config['remote_url'], timeout=8000)
    expect(page.locator('#player-join img')).to_have_attribute('src', re.compile('address=http%3A%2F%2F192.168.2.10'))
