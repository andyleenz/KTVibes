from playwright.sync_api import expect


def open_picker(page):
    page.locator('#profile-button').click()
    expect(page.locator('#identity-pop')).to_be_visible()


def test_identity_modes_autosave_and_inline_delete(remote, page):
    expect(page.locator('#identity-pop')).not_to_be_visible()
    open_picker(page)
    expect(page.locator('.identity-add')).not_to_be_visible()
    alex = page.locator('[data-id="' + 'a'*32 + '"]')
    alex.locator('.identity-choice').click()
    expect(page.locator('#identity-form')).not_to_have_class('identity-form open')
    expect(page.locator('#profile-button')).to_have_attribute('aria-label', 'Identity')
    expect(page.locator('#profile-button')).not_to_have_attribute('title', 'Identity')
    page.locator('#identity-pencil').click()
    expect(page.locator('.identity-add')).to_be_visible()
    expect(page.locator('[data-id="guest"] .identity-remove')).to_have_count(0)
    expect(page.locator('#identity-form')).to_have_class('identity-form open')
    expect(page.locator('#identity-name')).to_have_value('Alex')
    expect(page.locator('#identity-name')).to_have_attribute('maxlength', '12')
    page.locator('#identity-name').fill('Alex updated')
    page.locator('#identity-pencil').click()
    expect(page.locator('#identity-form')).not_to_have_class('identity-form open')
    expect(alex.locator('span')).to_have_text('Alex updated')
    page.locator('#identity-pencil').click()
    expect(page.locator('#identity-name')).to_have_value('Alex updated')
    page.locator('#identity-avatars button').nth(4).click()
    expect(alex.locator('img')).to_have_attribute('src', '/static/avatars/avatar-05.png')
    expect(page.locator('#identity-save')).to_have_count(0)
    alex.locator('.identity-remove').click()
    expect(page.locator('#identity-delete-confirm')).to_be_visible()
    expect(page.locator('#identity-form')).not_to_have_class('identity-form open')
    expect(page.locator('#identity-delete-label')).to_have_text('Delete Alex updated ?')
    expect(page.locator('#identity-delete-label em')).to_have_text('Alex updated')
    expect(page.locator('#identity-delete-yes')).to_have_text('Confirm')
    expect(page.locator('#identity-delete-confirm button')).to_have_count(1)
    expect(page.locator('#identity-delete-cancel')).to_have_count(0)
    page.locator('#identity-delete-yes').click()
    expect(alex).to_have_count(0)
    expect(page.locator('#profile-button')).to_have_attribute('aria-label', 'Identity')


def test_identity_picker_opens_on_mouse_hover_and_closes_after_leaving(remote, page):
    import pytest
    if page.evaluate('navigator.maxTouchPoints'):
        pytest.skip('Mouse hover behavior is desktop-only')
    button = page.locator('#profile-button')
    box = button.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.wait_for_timeout(100)
    expect(page.locator('#identity-pop')).not_to_be_visible()
    page.wait_for_timeout(250)
    expect(page.locator('#identity-pop')).to_be_visible()
    page.locator('.identity-head').hover()
    expect(page.locator('#identity-pop')).to_be_visible()
    page.mouse.move(800, 500)
    expect(page.locator('#identity-pop')).not_to_be_visible()


def test_identity_creation_and_close_save_failure(remote, page):
    open_picker(page)
    page.locator('#identity-pencil').click()
    page.locator('.identity-add').click()
    page.locator('#identity-name').fill('New singer')
    page.locator('.identity-head strong').click()
    expect(page.locator('#identity-grid')).to_contain_text('New singer')
    remote.identity_failure = True
    page.locator('#identity-name').fill('Unsent name')
    page.mouse.click(2, 2)
    expect(page.locator('#identity-error')).to_contain_text('Could not save identity')
    expect(page.locator('#identity-pop')).to_be_visible()
    expect(page.locator('#identity-name')).to_have_value('Unsent name')
    remote.identity_failure = False
    page.locator('#identity-name').press('Enter')
    expect(page.locator('#identity-grid')).to_contain_text('Unsent name')
    page.mouse.click(2, 2)
    expect(page.locator('#identity-pop')).not_to_be_visible()


def test_long_press_identity_reorder(remote, page):
    page.emulate_media(reduced_motion='no-preference')
    open_picker(page)
    page.locator('#identity-pencil').click()
    a = page.locator('[data-id="' + 'a'*32 + '"] .identity-choice')
    b = page.locator('[data-id="' + 'b'*32 + '"] .identity-choice')
    start, end = a.bounding_box(), b.bounding_box()
    page.mouse.move(start['x'] + start['width']/2, start['y'] + start['height']/2)
    page.mouse.down()
    expect(page.locator('.identity-drag-ghost')).to_have_count(1)
    page.mouse.move(end['x'] + end['width']/2, end['y'] + end['height']/2, steps=5)
    # Let the neighbours animate past the pointer while it jitters over the drop slot.
    for offset in (0, 1, -1, 2, -2, 0):
        page.mouse.move(end['x'] + end['width']/2 + offset, end['y'] + end['height']/2)
        expect(page.locator('#identity-grid .identity-tile').nth(1)).to_have_attribute('data-id', 'b'*32)
        page.wait_for_timeout(60)
    page.mouse.up()
    expect(page.locator('#identity-grid .identity-tile').nth(1)).to_have_attribute('data-id', 'b'*32)
    expect(page.locator('.identity-drag-ghost')).to_have_count(0)
    assert remote.identities[0]['id'] == 'b'*32


def test_touch_hold_reorder_and_cancel(remote, page):
    import pytest
    if not page.evaluate('navigator.maxTouchPoints'):
        pytest.skip('Touch gestures only apply to the mobile context')
    open_picker(page)
    page.locator('#identity-pencil').click()
    a = page.locator('[data-id="' + 'a'*32 + '"] .identity-choice').bounding_box()
    b = page.locator('[data-id="' + 'b'*32 + '"] .identity-choice').bounding_box()
    session = page.context.new_cdp_session(page)
    x, y = a['x'] + a['width']/2, a['y'] + a['height']/2
    session.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':x, 'y':y}]})
    expect(page.locator('.identity-drag-ghost')).to_have_count(1)
    session.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':[{'x':b['x']+b['width']/2, 'y':b['y']+b['height']/2}]})
    session.send('Input.dispatchTouchEvent', {'type':'touchCancel', 'touchPoints':[]})
    expect(page.locator('.identity-drag-ghost')).to_have_count(0)
    expect(page.locator('#identity-grid .identity-tile').nth(1)).to_have_attribute('data-id', 'a'*32)
    session.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':x, 'y':y}]})
    expect(page.locator('.identity-drag-ghost')).to_have_count(1)
    session.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':[{'x':b['x']+b['width']/2, 'y':b['y']+b['height']/2}]})
    session.send('Input.dispatchTouchEvent', {'type':'touchEnd', 'touchPoints':[]})
    expect(page.locator('#identity-grid .identity-tile').nth(1)).to_have_attribute('data-id', 'b'*32)
    expect(page.locator('#identity-form')).not_to_have_class('identity-form open')
