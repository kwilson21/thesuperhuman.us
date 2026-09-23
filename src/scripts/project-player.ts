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
    const render = () => {
      const share = audio.duration ? audio.currentTime / audio.duration : 0;
      wave.style.setProperty('--progress', `${(share * 100).toFixed(2)}%`);
      seek.value = String(Math.round(share * 1000));
      seek.setAttribute('aria-valuetext', `${clock(audio.currentTime)} of ${clock(audio.duration)}`);
      time.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    };
    toggle.addEventListener('click', () => { if (audio.paused) void audio.play(); else audio.pause(); });
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
