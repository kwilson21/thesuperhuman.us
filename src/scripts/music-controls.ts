/** Native media remains the source of truth for every visible control. */
export function setupAudioControls() {
  document.querySelectorAll<HTMLElement>('[data-player]').forEach(root => {
    const audio = root.querySelector<HTMLAudioElement>('audio')!;
    const controls = root.querySelector<HTMLElement>('.player-controls')!;
    const seek = root.querySelector<HTMLInputElement>('[data-seek]')!;
    const current = root.querySelector<HTMLElement>('[data-current-time]')!;
    const mute = root.querySelector<HTMLButtonElement>('[data-mute]')!;
    const status = root.querySelector<HTMLElement>('[data-media-status]')!;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-audio-toggle]')].filter(b => b.dataset.audioToggle === audio.id);
    let requested = false;
    const format = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
    const sync = () => {
      for (const button of buttons) {
        button.disabled = false;
        button.dataset.playing = String(!audio.paused);
        const label = audio.paused ? button.dataset.playLabel! : button.dataset.pauseLabel!;
        button.setAttribute('aria-label', label);
        const text = button.querySelector('[data-action-label]'); if (text) text.textContent = label;
      }
      if (Number.isFinite(audio.duration)) { seek.max = String(audio.duration); seek.disabled = false; }
      seek.value = String(audio.currentTime); seek.setAttribute('aria-valuetext', format(audio.currentTime)); current.textContent = format(audio.currentTime);
      mute.setAttribute('aria-pressed', String(audio.muted));
      mute.setAttribute('aria-label', `${audio.muted ? 'Unmute' : 'Mute'} ${audio.getAttribute('aria-label')}`);
    };
    buttons.forEach(button => button.addEventListener('click', async () => {
      if (!audio.paused || requested) { requested = false; audio.pause(); status.textContent = ''; return; }
      requested = true; status.textContent = 'Loading the song…';
      audio.dispatchEvent(new Event('music-request-play'));
      try { if (audio.error) audio.load(); await audio.play(); status.textContent = ''; }
      catch (error) { if (requested && !(error instanceof DOMException && error.name === 'AbortError')) status.textContent = 'The song couldn’t start. Please try Play again.'; }
      finally { requested = false; sync(); }
    }));
    seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); sync(); });
    mute.addEventListener('click', () => { audio.muted = !audio.muted; sync(); });
    ['play','pause','ended','timeupdate','loadedmetadata','durationchange','volumechange'].forEach(event => audio.addEventListener(event, sync));
    audio.addEventListener('waiting', () => { if (!audio.paused) status.textContent = 'Buffering…'; });
    audio.addEventListener('playing', () => { status.textContent = ''; });
    audio.addEventListener('pause', () => { requested = false; status.textContent = ''; });
    audio.addEventListener('error', () => { requested = false; status.textContent = 'Audio is unavailable. Please try Play again.'; sync(); });
    controls.hidden = false; audio.controls = false; audio.hidden = true; sync();
  });
}
