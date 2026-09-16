/** Native video remains the accessible fallback and playback source of truth. */
export function setupVideoControls() {
  document.querySelectorAll<HTMLElement>('[data-video-stage]').forEach(stage => {
    const video = stage.querySelector<HTMLVideoElement>('video');
    const controls = stage.querySelector<HTMLElement>('[data-native-video-controls]');
    if (!video || !controls) return;
    const play = controls.querySelector<HTMLButtonElement>('[data-video-play]')!;
    const seek = controls.querySelector<HTMLInputElement>('[data-video-seek]')!;
    const time = controls.querySelector<HTMLElement>('[data-video-time]')!;
    const mute = controls.querySelector<HTMLButtonElement>('[data-video-mute]')!;
    const full = controls.querySelector<HTMLButtonElement>('[data-video-full]')!;
    const status = stage.querySelector<HTMLElement>('[data-video-status]')!;
    const format = (n:number) => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
    const render = () => {
      controls.hidden = video.hidden;
      play.textContent = video.paused ? 'Play' : 'Pause';
      seek.disabled = !Number.isFinite(video.duration);
      if (!seek.disabled) seek.max = String(video.duration);
      seek.value = String(video.currentTime);
      seek.setAttribute('aria-valuetext', format(video.currentTime));
      time.textContent = `${format(video.currentTime)} / ${Number.isFinite(video.duration) ? format(video.duration) : '…'}`;
      mute.textContent = video.muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed',String(video.muted));
    };
    play.addEventListener('click', async () => {
      if (!video.paused) {video.pause();return;}
      video.dispatchEvent(new Event('music-request-play'));
      try {await video.play();} catch {status.textContent = 'The video couldn’t start. Please try again.';}
    });
    seek.addEventListener('input',()=>{video.currentTime=Number(seek.value);});
    mute.addEventListener('click',()=>{video.muted=!video.muted;});
    full.addEventListener('click',async()=>{try {await stage.requestFullscreen();} catch {status.textContent='Fullscreen isn’t available in this browser.';}});
    ['play','pause','timeupdate','loadedmetadata','volumechange','ended'].forEach(event=>video.addEventListener(event,render));
    new MutationObserver(render).observe(video,{attributes:true,attributeFilter:['hidden']});
    video.controls=false; render();
  });
}
