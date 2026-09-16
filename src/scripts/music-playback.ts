/** One active player, with engagement separate from playback controls. */
import { setupAudioControls } from "./music-controls";
import { setupVideoControls } from "./video-controls";
interface Playable { pause: () => void }
interface YoutubePlayer { seekTo(seconds: number, allowSeekAhead: boolean): void; playVideo(): void; pauseVideo(): void; getCurrentTime(): number; getPlayerState(): number; isMuted(): boolean; getVolume(): number; getPlaybackRate(): number; getIframe(): HTMLIFrameElement }
interface YoutubeAPI { Player: new (element: HTMLElement, options: Record<string, unknown>) => YoutubePlayer }
const players = new Map<object, Playable>();
let initialized = false;
let youtubeReady: Promise<YoutubeAPI> | undefined;
function pauseOthers(active: object) { players.forEach((player, key) => { if (key !== active) player.pause(); }); }
export function registerMusicPlayer(key: object, player: Playable) {
  players.set(key, player);
  return () => pauseOthers(key);
}
function sessionId() {
  try {
    let id = sessionStorage.getItem('music-session');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('music-session', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
function engagement(element: HTMLElement, medium: 'audio' | 'video') {
  const releaseId = element.dataset.releaseId, recordingId = element.dataset.recordingId;
  const session = sessionId();
  const sent = new Set<string>();
  let listened = 0, lastPosition: number | undefined, lastWall = performance.now();
  function send(event: 'start' | 'listen30') {
    if (!releaseId || !recordingId || sent.has(event)) return;
    sent.add(event);
    const key = `music:${session}:${releaseId}:${recordingId}:${medium}:${event}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* Playback works without storage. */ }
    const payload = { releaseId, recordingId, sessionId: session, medium, event };
    async function submit(attempt: number): Promise<void> {
      try {
        const response = await fetch('/api/music-event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true });
        if (response.ok) { try { sessionStorage.setItem(key, '1'); } catch {} return; }
        if (response.status < 500) return;
      } catch { /* Bounded retry of this same identity; never interrupt listening. */ }
      if (attempt < 2) window.setTimeout(() => { void submit(attempt + 1); }, 2000 * (attempt + 1));
    }
    void submit(0);
  }
  return {
    reset(position: number) { lastPosition = position; lastWall = performance.now(); },
    sample(position: number, audible: boolean, rate = 1) {
      const now = performance.now(); const wall = (now - lastWall) / 1000;
      const delta = lastPosition === undefined ? 0 : position - lastPosition;
      if (audible && delta > 0 && delta <= wall * rate + .2) {
        send('start'); listened += Math.min(delta / rate, wall);
        if (listened >= 30) send('listen30');
      }
      lastPosition = position; lastWall = now;
    },
  };
}
function youtubeAPI(): Promise<YoutubeAPI> {
  if (youtubeReady) return youtubeReady;
  const win = window as Window & { YT?: YoutubeAPI; onYouTubeIframeAPIReady?: () => void };
  youtubeReady = new Promise((resolve, reject) => {
    if (win.YT?.Player) { resolve(win.YT); return; }
    const previous = win.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timeout); script.remove(); youtubeReady = undefined;
      win.onYouTubeIframeAPIReady = previous; reject(new Error('YouTube could not load'));
    };
    const timeout = window.setTimeout(fail, 15_000);
    win.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); previous?.(); if (win.YT) resolve(win.YT); };
    script.src = 'https://www.youtube.com/iframe_api'; script.onerror = fail; document.head.appendChild(script);
  });
  return youtubeReady;
}
export function setupMusicPlayback() {
  if (initialized) return; initialized = true;
  document.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media => {
    players.set(media, { pause: () => media.pause() });
    media.addEventListener('music-request-play', () => pauseOthers(media));
    const meter = engagement(media, media.tagName === 'VIDEO' ? 'video' : 'audio');
    media.addEventListener('play', () => { pauseOthers(media); meter.reset(media.currentTime); });
    media.addEventListener('seeking', () => meter.reset(media.currentTime));
    media.addEventListener('seeked', () => meter.reset(media.currentTime));
    media.addEventListener('pause', () => meter.reset(media.currentTime));
    media.addEventListener('timeupdate', () => meter.sample(media.currentTime, !media.paused && !media.seeking && !media.muted && media.volume > 0, media.playbackRate));
  });
  setupAudioControls();
  setupVideoControls();
  document.querySelectorAll<HTMLElement>('[data-video-stage]').forEach(stage => {
    const poster = stage.querySelector<HTMLElement>('[data-poster]')!;
    const native = stage.querySelector<HTMLVideoElement>('video');
    const youtube = stage.querySelector<HTMLElement>('[data-youtube-id]');
    const status = stage.querySelector<HTMLElement>('[data-video-status]')!;
    const triggers = [...document.querySelectorAll<HTMLButtonElement>('[data-video-trigger]')].filter(b => b.dataset.videoTrigger === stage.id);
    const linkedAudio = stage.querySelector<HTMLAudioElement>('audio');
    let lastMedium: 'audio' | 'video' = 'audio';
    let youtubeStart = 0;
    let youtubePlayer: YoutubePlayer | undefined;
    let youtubeIsReady = false;
    if (linkedAudio) {
      const restoreAudio = () => {
        if (lastMedium === 'video') linkedAudio.currentTime = native?.currentTime ?? (youtubeIsReady ? youtubePlayer?.getCurrentTime() : undefined) ?? linkedAudio.currentTime;
        lastMedium = 'audio';
      };
      linkedAudio.addEventListener('music-request-play', restoreAudio);
      linkedAudio.addEventListener('play', restoreAudio);
      linkedAudio.addEventListener('seeking', () => { lastMedium = 'audio'; });
    }
    let wantsVideo = false;
    let loading = false;
    function showVideo() { poster.hidden = true; if (native) native.hidden = false; if (youtube) youtube.hidden = false; }
    function showPoster() { poster.hidden = false; if (native) native.hidden = true; if (youtube) youtube.hidden = true; }
    const videoState = (playing: boolean) => {
      triggers.forEach(button => {
        button.dataset.playing = String(playing);
        button.setAttribute('aria-label', playing ? 'Pause video' : 'Watch lyric video');
        const label = button.querySelector('[data-action-label]'); if (label) label.textContent = playing ? 'Pause video' : 'Watch lyric video';
      });
    };
    document.querySelectorAll('audio').forEach(audio => ['play', 'music-request-play'].forEach(event => audio.addEventListener(event, () => {
      wantsVideo = false; if (native) native.pause(); if (youtubeIsReady) youtubePlayer?.pauseVideo(); showPoster(); videoState(false); status.textContent = '';
    })));
    if (native) {
      native.addEventListener('play', () => { if (linkedAudio && lastMedium === 'audio') native.currentTime = linkedAudio.currentTime; lastMedium = 'video'; videoState(true); });
      native.addEventListener('seeking', () => { lastMedium = 'video'; });
      native.addEventListener('pause', () => videoState(false));
      native.addEventListener('ended', () => { showPoster(); videoState(false); });
      native.addEventListener('playing', () => { status.textContent = ''; });
      native.addEventListener('error', () => { status.textContent = 'The video couldn’t load. You can try again or listen to the song.'; showPoster(); videoState(false); });
    }
    triggers.forEach(button => {
      button.disabled = false;
      button.addEventListener('click', async () => {
        if ((native && !native.paused) || (youtubeIsReady && youtubePlayer?.getPlayerState() === 1)) {
          native?.pause(); if (youtubeIsReady) youtubePlayer?.pauseVideo(); videoState(false); return;
        }
        if (loading) return;
        youtubeStart = lastMedium === 'audio' ? linkedAudio?.currentTime ?? 0 : native?.currentTime ?? (youtubeIsReady ? youtubePlayer?.getCurrentTime() : undefined) ?? 0;
        wantsVideo = true; loading = true; status.textContent = 'Loading the lyric video…';
        pauseOthers(native ?? youtubePlayer ?? stage);
        showVideo();
        try {
          if (native) { if (native.error) native.load(); await native.play(); status.textContent = ''; }
          else if (youtube) {
            if (youtubePlayer && youtubeIsReady) { youtubePlayer.seekTo(youtubeStart, true); youtubePlayer.playVideo(); lastMedium = 'video'; }
            else {
              if (youtubePlayer) return;
              const api = await youtubeAPI();
              const meter = engagement(youtube, 'video');
              youtubePlayer = new api.Player(youtube.querySelector<HTMLElement>('[data-youtube-mount]')!, {
                videoId: youtube.dataset.youtubeId, host: 'https://www.youtube-nocookie.com', playerVars: { playsinline: 1, origin: location.origin },
                events: {
                  onReady: () => { youtubeIsReady = true; loading = false; youtubePlayer!.getIframe().title = 'Lyric video'; status.textContent = ''; if (wantsVideo) { youtubePlayer!.seekTo(youtubeStart, true); youtubePlayer!.playVideo(); lastMedium = 'video'; } },
                  onStateChange: (event: { data: number }) => { if (event.data === 1) { pauseOthers(youtubePlayer!); status.textContent = ''; } videoState(event.data === 1); meter.reset(youtubePlayer!.getCurrentTime()); },
                  onError: () => { loading = false; status.textContent = 'The video is unavailable here. Try the YouTube link or listen to the song.'; },
                },
              });
              const player = youtubePlayer;
              players.set(player, { pause: () => { if (youtubeIsReady) player.pauseVideo(); } });
              const timer = window.setInterval(() => { if (player.getPlayerState) meter.sample(player.getCurrentTime(), player.getPlayerState() === 1 && !player.isMuted() && player.getVolume() > 0, player.getPlaybackRate()); }, 500);
              window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
            }
          }
          // Keep the selected video visible on short screens without a long page jump.
          if (wantsVideo && stage.getBoundingClientRect().bottom > innerHeight) stage.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        } catch {
          if (wantsVideo) { status.textContent = 'The video couldn’t start. Please try again, or listen to the song.'; showPoster(); }
        } finally { if (!youtube || youtubeIsReady || !youtubePlayer) loading = false; }
      });
    });
  });
}
