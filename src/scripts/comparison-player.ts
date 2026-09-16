/** One audible native element; both versions share a logical song position. */
export function setupComparisonPlayers() {
  document.querySelectorAll<HTMLElement>('[data-comparison]').forEach(root => {
    const media = [...root.querySelectorAll<HTMLAudioElement>('audio')];
    const play = root.querySelector<HTMLButtonElement>('[data-comparison-play]')!;
    const seek = root.querySelector<HTMLInputElement>('[data-comparison-seek]')!;
    const volume = root.querySelector<HTMLInputElement>('[data-comparison-volume]')!;
    const status = root.querySelector<HTMLElement>('[data-comparison-status]')!;
    const match = root.querySelector<HTMLInputElement>('[data-match-level]');
    const time = root.querySelector<HTMLElement>('[data-comparison-time]')!;
    const switches = [...root.querySelectorAll<HTMLButtonElement>('[data-select-version]')];
    if (root.dataset.initialized) return; root.dataset.initialized = 'true';
    let active = media[0], pending = false, operation = 0;
    const offset = (audio: HTMLAudioElement) => Number(audio.dataset.offset ?? 0);
    const duration = Number(root.dataset.duration);
    const position = () => Math.max(0, active.currentTime - offset(active));
    const format = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
    function applyVolume() {
      const quietest = Math.min(...media.map(audio => Number(audio.dataset.loudness ?? 0)));
      media.forEach(audio => { const gain = match?.checked ? Math.pow(10, (quietest - Number(audio.dataset.loudness ?? 0)) / 20) : 1; audio.volume = Number(volume.value) * gain; });
    }
    match?.addEventListener('change', applyVolume);
    function render() {
      const current = Math.min(position(), duration);
      seek.value = String(current); seek.setAttribute('aria-valuetext', format(current));
      time.textContent = `${format(current)} / ${format(duration)}`; root.style.setProperty('--position', `${current / duration * 100}%`);
      play.dataset.playing = String(!active.paused);
      play.setAttribute('aria-label', `${active.paused ? 'Play' : 'Pause'} comparison`);
      switches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectVersion === active.dataset.version)));
      root.querySelectorAll<HTMLElement>('[data-lane]').forEach(lane => lane.dataset.selected = String(lane.dataset.lane === active.dataset.version));
    }
    async function start() {
      const request = ++operation, target = active;
      pending = true; status.textContent = 'Loading…';
      target.dispatchEvent(new Event('music-request-play'));
      try {
        if (target.error) target.load();
        await target.play();
        if (request !== operation || target !== active) { target.pause(); return; }
        status.textContent = '';
      } catch (error) {
        if (request === operation && !(error instanceof DOMException && error.name === 'AbortError')) status.textContent = 'This version couldn’t play. Please try again.';
      } finally { if (request === operation) pending = false; render(); }
    }
    play.addEventListener('click', () => {
      if (!active.paused || pending) { operation++; pending = false; active.pause(); status.textContent = ''; render(); }
      else void start();
    });
    switches.forEach(button => button.addEventListener('click', () => {
      const next = media.find(audio => audio.dataset.version === button.dataset.selectVersion)!;
      if (next === active) return;
      const current = position(), resume = !active.paused || pending;
      operation++; pending = false; active.pause(); active = next;
      active.currentTime = current + offset(active); applyVolume();
      status.textContent = ''; render(); if (resume) void start();
    }));
    seek.addEventListener('input', () => { active.currentTime = Number(seek.value) + offset(active); render(); });
    volume.addEventListener('input', applyVolume);
    media.forEach(audio => {
      ['play','pause','timeupdate','ended','loadedmetadata'].forEach(event => audio.addEventListener(event, render));
      audio.addEventListener('waiting', () => { if (audio === active && !audio.paused) status.textContent = 'Buffering…'; });
      audio.addEventListener('playing', () => { if (audio === active) status.textContent = ''; });
      audio.addEventListener('error', () => { if (audio === active) status.textContent = 'This version is unavailable. Try the other version or retry Play.'; });
      audio.controls = false; audio.hidden = true;
    });
    root.querySelector<HTMLElement>('.comparison-controls')!.hidden = false;
    root.querySelector<HTMLElement>('.comparison-playhead')!.hidden = false;
    render();
  });
}
