const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function setupProjectPlayers() {
  const players = [...document.querySelectorAll<HTMLElement>('[data-project-player]')];
  for (const player of players) {
    const audio = player.querySelector('audio');
    const toggle = player.querySelector<HTMLButtonElement>('[data-player-toggle]');
    const seek = player.querySelector<HTMLInputElement>('[data-player-seek]');
    const time = player.querySelector<HTMLElement>('[data-player-time]');
    const wave = player.querySelector<HTMLElement>('.player-wave');
    if (!audio || !toggle || !seek || !time || !wave) continue;
    const label = toggle.getAttribute('aria-label')?.replace(/^Play /, '') ?? '';
    const problem = player.querySelector<HTMLElement>('[data-player-problem]');
    const status = player.querySelector<HTMLElement>('[data-player-status]');
    // A missing file, an expired session or a revoked file all surface as a failed load or play.
    const unavailable = () => {
      player.classList.remove('playing');
      player.classList.add('unavailable');
      toggle.disabled = true;
      seek.disabled = true;
      if (status) status.textContent = 'This audio could not load. Your sign-in may have expired or the file may have changed.';
      if (problem) problem.hidden = false;
    };
    const available = () => {
      player.classList.remove('unavailable');
      toggle.disabled = false;
      seek.disabled = false;
      if (status) status.textContent = '';
      if (problem) problem.hidden = true;
    };
    audio.addEventListener('error', unavailable);
    player.querySelector('[data-player-retry]')?.addEventListener('click', () => { available(); audio.load(); });
    const render = () => {
      const share = audio.duration ? audio.currentTime / audio.duration : 0;
      wave.style.setProperty('--progress', `${(share * 100).toFixed(2)}%`);
      seek.value = String(Math.round(share * 1000));
      seek.setAttribute('aria-valuetext', `${clock(audio.currentTime)} of ${clock(audio.duration)}`);
      time.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    };
    toggle.addEventListener('click', () => {
      if (!audio.paused) { audio.pause(); return; }
      // AbortError only means a pause or reload interrupted this play; everything else is a real failure.
      audio.play().catch((error: unknown) => { if ((error as { name?: string })?.name !== 'AbortError') unavailable(); });
    });
    audio.addEventListener('play', () => {
      // One song at a time, like a studio monitor.
      for (const other of players) if (other !== player) other.querySelector('audio')?.pause();
      player.classList.add('playing');
      toggle.setAttribute('aria-label', `Pause ${label}`);
    });
    audio.addEventListener('pause', () => { player.classList.remove('playing'); toggle.setAttribute('aria-label', `Play ${label}`); });
    audio.addEventListener('timeupdate', render);
    audio.addEventListener('loadedmetadata', render);
    audio.addEventListener('ended', render);
    seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = Number(seek.value) / 1000 * audio.duration; render(); });
  }
}
