import { ComparisonTransport } from "./comparison-transport";
import { registerMusicPlayer } from "./music-playback";
import {
	isWaveformScrub,
	waveformGeometry,
	waveformSeekSeconds,
} from "~/lib/waveform";

export {
	isWaveformScrub,
	waveformGeometry,
	waveformSeekSeconds,
} from "~/lib/waveform";

/** Load the comparison pair on demand; A/B and loudness never restart playback. */
type AudioContextConstructor = new () => AudioContext;

export function getAudioContextConstructor(scope: {
	AudioContext?: AudioContextConstructor;
	webkitAudioContext?: AudioContextConstructor;
}) {
	return scope.AudioContext ?? scope.webkitAudioContext;
}

// navigator exposes audioSession only where the browser provides it; tests pass a stand-in with the same member.
type AudioSessionScope = { audioSession?: { type: string } };

export function setPlaybackAudioSession(scope: Navigator | AudioSessionScope) {
	// SAFETY: scope is navigator or a stand-in with the same optional audioSession member; reading audioSession through AudioSessionScope is valid for both.
	const audioSession = (scope as AudioSessionScope).audioSession;

	if (!audioSession) return false;

	try {
		audioSession.type = "playback";

		return true;
	} catch {
		return false;
	}
}

/** Whether this browser lets a page set an audio element's volume. iOS Safari does not: it always reads 1. */
function canSetVolume() {
	const probe = new Audio();
	probe.volume = 0.5;

	return probe.volume === 0.5;
}

export function setupComparisonPlayers() {
	const AudioContextConstructor = getAudioContextConstructor(window);

	if (!AudioContextConstructor) {
		document
			.querySelectorAll<HTMLElement>(
				".comparison-player--compact[data-comparison]",
			)
			.forEach((root) => {
				root.dataset.audioFallback = "true";

				const status = root.querySelector<HTMLElement>(
					"[data-comparison-status]",
				);

				if (status)
					status.textContent =
						"Synchronized playback isn’t supported here. Use either audio player below.";
			});

		return;
	}

	const fixedVolume = !canSetVolume();

	document
		.querySelectorAll<HTMLElement>("[data-comparison]")
		.forEach((root) => {
			if (root.dataset.initialized) return;
			const media = [...root.querySelectorAll<HTMLAudioElement>("audio")];
			const files = media.map((audio) => audio.getAttribute("src") ?? "");

			const play = root.querySelector<HTMLButtonElement>(
				"[data-comparison-play]",
			)!;

			const seek = root.querySelector<HTMLInputElement>(
				"[data-comparison-seek]",
			)!;

			const volume = root.querySelector<HTMLInputElement>(
				"[data-comparison-volume]",
			);

			const status = root.querySelector<HTMLElement>(
				"[data-comparison-status]",
			)!;

			const match = root.querySelector<HTMLInputElement>("[data-match-level]");
			const time = root.querySelector<HTMLElement>("[data-comparison-time]")!;

			const compactWaveform = root.querySelector<SVGSVGElement>(
				"[data-compact-waveform]",
			);

			const compactVersionLabel = root.querySelector<HTMLElement>(
				"[data-compact-version-label]",
			);

			const switches = [
				...root.querySelectorAll<HTMLButtonElement>("[data-select-version]"),
			];

			let context: AudioContext | undefined,
				transport: ComparisonTransport | undefined;

			let loading: Promise<void> | undefined,
				selected = 0,
				operation = 0,
				pending = false,
				frame = 0;

			let position = 0;

			// Until both versions are decoded, the chosen one plays from its own stream, so sound starts at once. Each
			// stream started or stopped takes a new number, so a refusal from an earlier one is not taken for this one.
			let streaming: HTMLAudioElement | undefined,
				streamId = 0;

			const format = (n: number) =>
				`${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

			const offsetOf = (audio: HTMLAudioElement) =>
				Number(audio.dataset.offset ?? 0);

			/**
			 * The level a version plays at when it is the one selected: the volume, and the loudness match when it is on. In
			 * the fallback the native players share the volume alone, as a visitor switching between them expects.
			 */
			function levelOf(audio: HTMLAudioElement) {
				const quietest = Math.min(
					...media.map((other) => Number(other.dataset.loudness ?? 0)),
				);

				return (
					Number(volume?.value ?? 1) *
					(match?.checked && root.dataset.audioFallback !== "true"
						? Math.pow(
								10,
								(quietest - Number(audio.dataset.loudness ?? 0)) / 20,
							)
						: 1)
				);
			}

			function applyVolume() {
				transport?.setLevels(
					media.map((audio, index) =>
						index !== selected ? 0 : levelOf(audio),
					),
				);

				if (!streaming) return;

				// On iOS a stream cannot be turned down, so one that should now play quieter waits for synced playback.
				if (streamable(streaming))
					streaming.volume = Math.min(1, levelOf(streaming));
				else {
					stopStream();
					waitForTransport();
				}
			}

			/** Where the stream has reached, in the song's time, or the stored position when nothing streams. */
			const streamPosition = () =>
				streaming
					? Math.max(0, streaming.currentTime - offsetOf(streaming))
					: position;

			/**
			 * Whether a version may stream at the level it should play at. Where the page cannot set an element's volume
			 * (iOS), only a version meant to play at full level may; the others wait for synced playback, so the comparison
			 * never plays a version louder than it should. In the fallback, the native players play at their own level.
			 */
			const streamable = (audio: HTMLAudioElement) =>
				root.dataset.audioFallback === "true" ||
				!fixedVolume ||
				levelOf(audio) >= 0.999;

			/** Waits for synced playback with nothing sounding, as the button's busy state and the status say. */
			function waitForTransport() {
				pending = true;
				status.textContent = "Preparing synchronized audio…";
				render();
			}

			function streamFrom(seconds: number) {
				const audio = media[selected];

				if (!streamable(audio)) {
					position = seconds;
					waitForTransport();

					return;
				}

				const id = ++streamId;
				audio.currentTime = seconds + offsetOf(audio);
				audio.volume = Math.min(1, levelOf(audio));
				streaming = audio;

				// A stream that takes over from a wait (iOS, back on a version that may stream) sounds again.
				if (pending && !transport) {
					pending = false;
					status.textContent = "";
				}

				// A browser that refuses the stream leaves the comparison waiting for synced playback instead.
				void audio.play().catch(() => {
					if (id !== streamId || streaming !== audio) return;
					position = seconds;
					streaming = undefined;
					waitForTransport();
				});
			}

			function stopStream() {
				if (!streaming) return;
				streamId++;
				position = streamPosition();
				streaming.pause();
				streaming = undefined;
			}

			function updateCompactWaveform() {
				if (!compactWaveform) return;

				const side =
					media[selected].dataset.version === "after" ? "after" : "before";

				// SAFETY: data-waveform-before and data-waveform-after are JSON.stringify of example.waveforms (src/components/audio/ComparisonPlayer.astro, line 55), and the schema in src/lib/music-catalog.ts (line 145) validates both as number arrays.
				const amplitudes = JSON.parse(
					compactWaveform.dataset[
						`waveform${side === "before" ? "Before" : "After"}`
					] ?? "[]",
				) as number[];

				root
					.querySelectorAll<SVGSVGElement>(".compact-waveform")
					.forEach((svg) => {
						svg
							.querySelectorAll<SVGLineElement>("[data-compact-wave-line]")
							.forEach((line, index) => {
								const coordinates = waveformGeometry([
									amplitudes[index] ?? 0,
								])[0];

								line.setAttribute("y1", String(coordinates.y1));
								line.setAttribute("y2", String(coordinates.y2));
							});
					});

				if (compactVersionLabel)
					compactVersionLabel.textContent =
						media[selected].dataset.label ?? "Audio version";
			}

			function render() {
				cancelAnimationFrame(frame);
				const duration = transport?.duration ?? Number(root.dataset.duration);

				// A stream still playing leads, even once the transport exists (a stream left to finish on its own).
				const current = streaming
					? streamPosition()
					: (transport?.position ?? position);

				const sounding = Boolean(
					transport?.playing || (streaming && !streaming.paused),
				);

				seek.max = String(duration);
				seek.value = String(current);
				seek.setAttribute("aria-valuetext", format(current));
				seek.setAttribute(
					"aria-label",
					`Seek in ${media[selected].dataset.label ?? "audio"}`,
				);
				time.textContent = `${format(current)} / ${format(duration)}`;
				root.style.setProperty("--position", `${(current / duration) * 100}%`);
				play.dataset.playing = String(sounding);
				play.setAttribute(
					"aria-label",
					`${sounding || pending ? "Pause" : "Play"} ${root.dataset.title ?? "comparison"}: ${media[selected].dataset.label ?? "audio"}`,
				);
				play.setAttribute("aria-busy", String(pending));
				switches.forEach((button) =>
					button.setAttribute(
						"aria-pressed",
						String(
							button.dataset.selectVersion === media[selected].dataset.version,
						),
					),
				);
				root
					.querySelectorAll<HTMLElement>("[data-lane]")
					.forEach(
						(lane) =>
							(lane.dataset.selected = String(
								lane.dataset.lane === media[selected].dataset.version,
							)),
					);

				if (sounding) frame = requestAnimationFrame(render);
			}

			function pause() {
				operation++;
				pending = false;
				const streamed = Boolean(streaming);
				stopStream();
				transport?.pause();

				// A stream stopped after the transport was made but before it took over: the transport waits at its place.
				if (streamed) transport?.seek(position);

				// The fallback's note about the players below stays.
				if (root.dataset.audioFallback !== "true") status.textContent = "";
				render();
			}

			const claimPlayback = registerMusicPlayer(root, { pause });

			async function start() {
				const request = ++operation;

				// Another try after a load failure hides the native players again, and their note goes with them.
				if (root.dataset.audioFallback === "true") {
					delete root.dataset.audioFallback;
					status.textContent = "";
				}

				// Play at the end starts the song again, as the transport does.
				if (!transport && position >= Number(root.dataset.duration) - 0.05)
					position = 0;
				media.forEach((audio) => {
					audio.pause();
					audio.controls = false;
					audio.hidden = true;
				});
				claimPlayback();

				// Before both versions are decoded, the chosen one plays from its own stream while they load.
				if (transport) waitForTransport();
				else streamFrom(position);

				render();

				try {
					setPlaybackAudioSession(navigator);
					context ??= new AudioContextConstructor!();
					// Resume during the click gesture, before network work (mobile autoplay rules).
					const resumed = context.resume();
					loading ??= Promise.all(
						media.map(async (audio) => {
							const response = await fetch(audio.currentSrc || audio.src);

							if (!response.ok) throw new Error("Audio unavailable");

							return context!.decodeAudioData(await response.arrayBuffer());
						}),
					)
						.then((buffers) => {
							transport = new ComparisonTransport(
								context!,
								buffers,
								media.map((audio) => Number(audio.dataset.offset ?? 0)),
								Number(root.dataset.duration),
								render,
							);
							// A stream paused before both versions loaded left its place in position; start the transport there.
							transport.seek(position);
						})
						.catch((error) => {
							loading = undefined;
							throw error;
						});
					await Promise.all([resumed, loading]);

					if (request !== operation) return;

					// Hand over from the stream at the point it has reached. The transport starts 30 ms ahead, so it starts
					// that much later in the song, and the stream stops as it takes over.
					const handed = streaming;

					if (handed) {
						const at = streamPosition() + 0.03;

						// A stream that has stopped, or is about to end, is left to its pause and ended handlers, which park
						// the comparison where it stopped; the transport would start the song again from the top.
						if (handed.paused || at >= transport!.duration) return;
						position = at;
						streaming = undefined;
					}

					transport!.seek(position);
					applyVolume();
					transport!.play();
					// The versions' own players are let go once synced playback has taken over, as they were before the
					// stream: a media key or the lock screen keeps the controls of the last element that played, and would
					// otherwise start it alongside synced playback. The fallback gives them their files back.
					setTimeout(() => {
						handed?.pause();
						media.forEach((audio) => {
							if (!audio.getAttribute("src")) return;
							audio.removeAttribute("src");
							audio.load();
						});
					}, 30);
					delete root.dataset.audioFallback;
					status.textContent = "";
				} catch {
					if (request === operation) {
						// A stream that is playing keeps playing, now in the native player the fallback shows, and the
						// controls above keep following it. Both players share the volume.
						root.dataset.audioFallback = "true";
						media.forEach((audio, index) => {
							if (!audio.getAttribute("src"))
								audio.setAttribute("src", files[index]);
							audio.volume = Math.min(1, levelOf(audio));
							audio.controls = true;
							audio.hidden = false;
						});
						status.textContent =
							"The comparison couldn’t load. Use either audio player below.";
					}
				} finally {
					if (request === operation) {
						pending = false;
						render();
					}
				}
			}

			play.addEventListener("click", () => {
				if (transport?.playing || pending || streaming) {
					position = transport?.position ?? position;
					pause();
				} else {
					position = transport?.position ?? position;
					void start();
				}
			});
			switches.forEach((button) =>
				button.addEventListener("click", () => {
					const chosen = media.findIndex(
						(audio) => audio.dataset.version === button.dataset.selectVersion,
					);

					if (chosen === selected) return;
					selected = chosen;

					// Before the synced handover, switching restarts the other version's stream at the same point, or starts
					// it after a wait for a version that could not stream (iOS).
					if (streaming || (pending && !transport)) {
						const at = streamPosition();
						stopStream();
						streamFrom(at);
					}

					applyVolume();
					updateCompactWaveform();
					render();
				}),
			);

			function seekTo(seconds: number) {
				const duration = transport?.duration ?? Number(root.dataset.duration);
				position = Math.max(0, Math.min(seconds, duration));
				transport?.seek(position);

				if (streaming) streaming.currentTime = position + offsetOf(streaming);
				render();
			}

			seek.addEventListener("input", () => seekTo(Number(seek.value)));
			root
				.querySelectorAll<HTMLElement>(
					".comparison-waveform-stage, .compact-waveform-frame",
				)
				.forEach((stage) => {
					let gesture:
						| {
								startX: number;
								startY: number;
								scrubbing: boolean;
								resume: boolean;
								lastSeconds?: number;
						  }
						| undefined;

					const seekFromPointer = (event: PointerEvent) => {
						const bounds = stage.getBoundingClientRect();

						if (!bounds.width || !gesture) return;

						const seconds = waveformSeekSeconds(
							event.clientX,
							bounds.left,
							bounds.width,
							transport?.duration ?? Number(root.dataset.duration),
						);

						// Pen pressure and drags held past an edge repeat a target time; re-seeking it would restart the audio.
						if (seconds === gesture.lastSeconds) return;
						seekTo(seconds);
						gesture.lastSeconds = seconds;

						// A drag past the end parks the transport at its end without resuming, so play again once the pointer is back inside the track.
						const duration =
							transport?.duration ?? Number(root.dataset.duration);

						if (gesture.resume && position < duration) {
							if (transport && !transport.playing && !streaming && !pending) {
								transport.play();
								render();
							}
							// Before the handover, a stream held past the end has ended, which paused the comparison.
							else if (!transport && !streaming && !pending) void start();
						}
					};

					stage.addEventListener("pointerdown", (event) => {
						if (
							root.dataset.audioFallback === "true" ||
							!event.isPrimary ||
							event.button !== 0
						)
							return;
						stage.setPointerCapture(event.pointerId);
						gesture = {
							startX: event.clientX,
							startY: event.clientY,
							scrubbing: isWaveformScrub(event.pointerType, 0, 0),
							resume: Boolean(
								transport?.playing || (streaming && !streaming.paused),
							),
						};

						if (gesture.scrubbing) seekFromPointer(event);
					});
					stage.addEventListener("pointermove", (event) => {
						if (!gesture || !stage.hasPointerCapture(event.pointerId)) return;

						// Once a touch has moved sideways it stays a scrub until the gesture ends.
						if (!gesture.scrubbing) {
							if (
								!isWaveformScrub(
									event.pointerType,
									event.clientX - gesture.startX,
									event.clientY - gesture.startY,
								)
							)
								return;
							gesture.scrubbing = true;
						}

						seekFromPointer(event);
					});
					stage.addEventListener("pointerup", (event) => {
						if (!gesture || !stage.hasPointerCapture(event.pointerId)) return;
						seekFromPointer(event);
					});
				});

			// The volume track fills to its value in the accent, like the seek track.
			const showVolume = () =>
				volume?.style.setProperty("--fill", `${Number(volume.value) * 100}%`);

			volume?.addEventListener("input", () => {
				showVolume();
				applyVolume();
			});
			showVolume();
			match?.addEventListener("change", applyVolume);
			root.addEventListener("music-pause", pause);
			media.forEach((audio, index) => {
				// A stream ends or is paused from outside the page (a media key, the lock screen, headphones coming out):
				// the comparison pauses with it, so it does not start again by itself once both versions are decoded. The
				// comparison's own pauses clear `streaming` first, and a stream it restarted is playing again.
				audio.addEventListener("pause", () => {
					if (streaming === audio && audio.paused && !audio.ended) pause();
				});
				audio.addEventListener("ended", () => {
					if (streaming !== audio) return;
					streaming = undefined;
					position = Number(root.dataset.duration);
					transport?.seek(position);
					pause();
				});
				// A version starts that the comparison did not start. In the fallback a visitor started it from its native
				// player, and the controls above follow it. Otherwise it is hidden and something outside the page started
				// it (a media key or the lock screen, whose controls it kept from its stream), so it stops, and the
				// comparison takes it as a press of its own button: it pauses if it is playing, and plays if it is not.
				audio.addEventListener("play", () => {
					if (streaming === audio || audio.paused) return;

					if (root.dataset.audioFallback === "true") {
						audio.volume = Math.min(1, levelOf(audio));
						streaming = audio;
						selected = index;
						updateCompactWaveform();
						render();

						return;
					}

					audio.pause();

					if (transport?.playing || pending || streaming) {
						position = transport?.position ?? streamPosition();
						pause();
					} else void start();
				});
			});
			window.addEventListener("pagehide", pause);

			const standardControls = root.querySelector<HTMLElement>(
				".comparison-controls",
			);

			if (standardControls) standardControls.hidden = false;
			root
				.querySelectorAll<HTMLElement>(".comparison-playhead")
				.forEach((playhead) => (playhead.hidden = false));
			updateCompactWaveform();
			render();
			media.forEach((audio) => {
				audio.pause();
				audio.controls = false;
				audio.hidden = true;
			});
			root.dataset.initialized = "true";
		});
}
