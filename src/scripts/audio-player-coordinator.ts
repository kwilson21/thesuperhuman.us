// Pauses other <audio> elements when one starts playing.
// Loaded as a module via <script type="module"> from the landing page.

const players = Array.from(document.querySelectorAll<HTMLAudioElement>('audio.audio-player'));
for (const player of players) {
  player.addEventListener('play', () => {
    for (const other of players) {
      if (other !== player && !other.paused) {
        other.pause();
      }
    }
  });
}
