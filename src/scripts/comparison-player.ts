import { ComparisonTransport } from './comparison-transport';
import { registerMusicPlayer } from './music-playback';
import { waveformGeometry } from '~/lib/waveform';

export { waveformGeometry } from '~/lib/waveform';

/** Load the comparison pair on demand; A/B and loudness never restart playback. */
type AudioContextConstructor = new () => AudioContext;

export function getAudioContextConstructor(scope: { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }) {
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export function setPlaybackAudioSession(scope: object) {
  const audioSession = (scope as { audioSession?: { type: string } }).audioSession;
  if (!audioSession) return false;
  try {
    audioSession.type = 'playback';
    return true;
  } catch {
    return false;
  }
}

export function setupComparisonPlayers() {
  const AudioContextConstructor = getAudioContextConstructor(window);
  if (!AudioContextConstructor) {
    document.querySelectorAll<HTMLElement>('.comparison-player--compact[data-comparison]').forEach(root => {
      root.dataset.audioFallback = 'true';
      const status = root.querySelector<HTMLElement>('[data-comparison-status]');
      if (status) status.textContent = 'Synchronized playback isn’t supported here. Use either audio player below.';
    });
    return;
  }
  document.querySelectorAll<HTMLElement>('[data-comparison]').forEach(root => {
    if (root.dataset.initialized) return;
    const media = [...root.querySelectorAll<HTMLAudioElement>('audio')];
    const play = root.querySelector<HTMLButtonElement>('[data-comparison-play]')!;
    const seek = root.querySelector<HTMLInputElement>('[data-comparison-seek]')!;
    const volume = root.querySelector<HTMLInputElement>('[data-comparison-volume]');
    const status = root.querySelector<HTMLElement>('[data-comparison-status]')!;
    const match = root.querySelector<HTMLInputElement>('[data-match-level]');
    const time = root.querySelector<HTMLElement>('[data-comparison-time]')!;
    const compactWaveform = root.querySelector<SVGSVGElement>('[data-compact-waveform]');
    const compactVersionLabel = root.querySelector<HTMLElement>('[data-compact-version-label]');
    const switches = [...root.querySelectorAll<HTMLButtonElement>('[data-select-version]')];
    let context: AudioContext | undefined, transport: ComparisonTransport | undefined;
    let loading: Promise<void> | undefined, selected = 0, operation = 0, pending = false, frame = 0;
    let position = 0;
    const format = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
    function applyVolume() {
      const quietest = Math.min(...media.map(audio => Number(audio.dataset.loudness ?? 0)));
      transport?.setLevels(media.map((audio, index) => index !== selected ? 0 : Number(volume?.value ?? 1) * (match?.checked ? Math.pow(10, (quietest - Number(audio.dataset.loudness ?? 0)) / 20) : 1)));
    }
    function updateCompactWaveform() {
      if (!compactWaveform) return;
      const side = media[selected].dataset.version === 'after' ? 'after' : 'before';
      const amplitudes = JSON.parse(compactWaveform.dataset[`waveform${side === 'before' ? 'Before' : 'After'}`] ?? '[]') as number[];
      compactWaveform.querySelectorAll<SVGLineElement>('[data-compact-wave-line]').forEach((line, index) => {
        const coordinates = waveformGeometry([amplitudes[index] ?? 0])[0];
        line.setAttribute('y1', String(coordinates.y1));
        line.setAttribute('y2', String(coordinates.y2));
      });
      compactWaveform.dataset.version = side;
      if (compactVersionLabel) compactVersionLabel.textContent = media[selected].dataset.label ?? 'Audio version';
    }
    function render() {
      cancelAnimationFrame(frame);
      const duration = transport?.duration ?? Number(root.dataset.duration);
      const current = transport?.position ?? position;
      seek.max = String(duration); seek.value = String(current); seek.setAttribute('aria-valuetext', format(current));
      seek.setAttribute('aria-label', `Seek in ${media[selected].dataset.label ?? 'audio'}`);
      time.textContent = `${format(current)} / ${format(duration)}`; root.style.setProperty('--position', `${current / duration * 100}%`);
      play.dataset.playing = String(Boolean(transport?.playing));
      play.setAttribute('aria-label', `${transport?.playing || pending ? 'Pause' : 'Play'} ${root.dataset.title ?? 'comparison'}: ${media[selected].dataset.label ?? 'audio'}`);
      play.setAttribute('aria-busy', String(pending));
      switches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectVersion === media[selected].dataset.version)));
      root.querySelectorAll<HTMLElement>('[data-lane]').forEach(lane => lane.dataset.selected = String(lane.dataset.lane === media[selected].dataset.version));
      if (transport?.playing) frame = requestAnimationFrame(render);
    }
    function pause() {
      operation++; pending = false; transport?.pause(); status.textContent = ''; render();
    }
    const claimPlayback = registerMusicPlayer(root, { pause });
    async function start() {
      const request = ++operation;
      media.forEach(audio => { audio.pause(); audio.controls = false; audio.hidden = true; });
      pending = true; claimPlayback(); status.textContent = 'Preparing synchronized audio…'; render();
      try {
        setPlaybackAudioSession(navigator);
        context ??= new AudioContextConstructor!();
        // Resume during the click gesture, before network work (mobile autoplay rules).
        const resumed = context.resume();
        loading ??= Promise.all(media.map(async audio => {
          const response = await fetch(audio.currentSrc || audio.src);
          if (!response.ok) throw new Error('Audio unavailable');
          return context!.decodeAudioData(await response.arrayBuffer());
        })).then(buffers => {
          transport = new ComparisonTransport(context!, buffers, media.map(audio => Number(audio.dataset.offset ?? 0)), Number(root.dataset.duration), render);
        }).catch(error => { loading = undefined; throw error; });
        await Promise.all([resumed, loading]);
        if (request !== operation) return;
        transport!.seek(position); applyVolume(); transport!.play(); status.textContent = '';
      } catch {
        if (request === operation) {
          root.dataset.audioFallback = 'true';
          media.forEach(audio => { audio.controls = true; audio.hidden = false; });
          status.textContent = 'The comparison couldn’t load. Use either audio player below.';
        }
      } finally { if (request === operation) { pending = false; render(); } }
    }
    play.addEventListener('click', () => {
      if (transport?.playing || pending) { position = transport?.position ?? position; pause(); }
      else { position = transport?.position ?? position; void start(); }
    });
    switches.forEach(button => button.addEventListener('click', () => {
      selected = media.findIndex(audio => audio.dataset.version === button.dataset.selectVersion);
      applyVolume(); updateCompactWaveform(); render();
    }));
    function seekTo(seconds: number) {
      const duration = transport?.duration ?? Number(root.dataset.duration);
      position = Math.max(0, Math.min(seconds, duration));
      transport?.seek(position); render();
    }
    seek.addEventListener('input', () => seekTo(Number(seek.value)));
    root.querySelectorAll<SVGSVGElement>('.comparison-waveform').forEach(waveform => {
      waveform.addEventListener('click', event => {
        const bounds = waveform.getBoundingClientRect();
        if (!bounds.width) return;
        seekTo((event.clientX - bounds.left) / bounds.width * (transport?.duration ?? Number(root.dataset.duration)));
      });
    });
    volume?.addEventListener('input', applyVolume);
    match?.addEventListener('change', applyVolume);
    root.addEventListener('music-pause', pause);
    window.addEventListener('pagehide', pause);
    const standardControls = root.querySelector<HTMLElement>('.comparison-controls');
    if (standardControls) standardControls.hidden = false;
    root.querySelectorAll<HTMLElement>('.comparison-playhead').forEach(playhead => playhead.hidden = false);
    updateCompactWaveform();
    render();
    media.forEach(audio => { audio.pause(); audio.controls = false; audio.hidden = true; });
    root.dataset.initialized = 'true';
  });
}
