import time
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


def test_corner_up_next_shows_only_first_request(remote, page, remote_url):
    remote.state['upcoming'][0].update(title='A very long title ' * 10, requester=person('A very long identity name ' * 3))
    page.route_web_socket('**/ws?role=tv', remote.websocket)
    page.goto(remote_url.replace('/remote', '/tv'))
    rows = page.locator('#on-deck li')
    expect(rows).to_have_count(1)
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
