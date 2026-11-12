import {$, api} from './shared.js';

// Owns the Remote status label and version popover. Transport only reports events.
export function createRemoteStatus() {
  const button = $('connection');
  const label = $('connection-label');
  const popover = $('update-popover');
  const wrap = document.querySelector('.connection-wrap');
  let state;
  let availableUpdate = null;
  let currentVersion = '';
  let pollTimer;
  let closeTimer;
  let hoverOpenTimer;
  let keyboardFocus = false;

  function renderVersion() {
    const ready = state?.player_connected && state?.player_audio;
    const showUpdate = !!(availableUpdate && ready && button.classList.contains('online'));
    button.classList.toggle('has-update', showUpdate);
    $('current-version').textContent = currentVersion
      ? `v${currentVersion.replace(/^v/, '')}` : 'Version unavailable';
    $('version-heading').textContent = showUpdate ? 'Update available' : 'Current version';
    $('version-arrow').hidden = !showUpdate;
    $('update-link').hidden = !showUpdate;
    if (showUpdate) {
      $('update-link').textContent = availableUpdate.version.startsWith('v')
        ? availableUpdate.version : `v${availableUpdate.version}`;
      $('update-link').href = availableUpdate.url;
    }
  }

  async function refreshVersion() {
    let delay = 60_000;
    try {
      const {version, update, update_check_complete} = await api('/api/config');
      const versionPattern = /^v?\d+(?:\.\d+){1,3}$/;
      currentVersion = typeof version === 'string' && versionPattern.test(version) ? version : '';
      const valid = update && versionPattern.test(update.version || '')
        && update.url?.startsWith('https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/');
      availableUpdate = valid ? update : null;
      renderVersion();
      delay = update_check_complete ? 6 * 60 * 60 * 1000 : 5000;
    } catch {
      // Keep the last known version and retry when the host is reachable again.
    }
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refreshVersion, delay);
  }

  function open() {
    if (!button.classList.contains('online')) return;
    clearTimeout(closeTimer);
    popover.hidden = false;
    popover.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      if (button.getAttribute('aria-expanded') === 'true') popover.classList.add('open');
    });
  }

  function close() {
    if (popover.hidden) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-expanded', 'false');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!popover.classList.contains('open')) popover.hidden = true;
    }, 260);
  }

  button.onclick = event => {
    if (event.detail === 0) {
      open();
      return;
    }
    if (matchMedia('(hover: none), (pointer: coarse)').matches) {
      if (popover.hidden) open();
      else close();
    }
  };
  wrap.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) {
      clearTimeout(closeTimer);
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = setTimeout(open, 300);
    }
  });
  wrap.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') {
      clearTimeout(hoverOpenTimer);
      if (!wrap.contains(document.activeElement)) close();
    }
  });
  wrap.addEventListener('focusin', () => {
    if (keyboardFocus) open();
  });
  wrap.addEventListener('focusout', event => {
    if (!wrap.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => {
    keyboardFocus = false;
    if (!event.target.closest('.connection-wrap')) {
      clearTimeout(hoverOpenTimer);
      close();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') keyboardFocus = true;
    if (event.key === 'Escape' && !popover.hidden) {
      close();
      keyboardFocus = false;
      button.focus();
    }
  });
  refreshVersion();

  return {
    render(next) {
      state = next;
      label.textContent = !state.player_connected ? 'Player offline'
        : state.player_audio ? 'Ready' : 'Sound disabled';
      button.classList.toggle('warn', !state.player_audio);
      button.classList.toggle('off', !state.player_connected);
      renderVersion();
    },
    onOpen() {
      label.textContent = 'Connected';
      button.classList.add('online');
      button.classList.remove('lost');
      renderVersion();
    },
    onClose() {
      label.textContent = 'Disconnected';
      button.classList.remove('online', 'has-update');
      button.classList.add('lost');
      clearTimeout(closeTimer);
      clearTimeout(hoverOpenTimer);
      popover.hidden = true;
      popover.classList.remove('open');
      popover.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-expanded', 'false');
    }
  };
}
