import { ComparisonTransport, type LoopRegion } from "./comparison-transport";
import { ComparisonSignal } from "./comparison-signal";
import { meterLine, meterShare } from "~/lib/loudness-meter";
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

	document
		.querySelectorAll<HTMLElement>("[data-comparison]")
		.forEach((root) => {
			if (root.dataset.initialized) return;
			const media = [...root.querySelectorAll<HTMLAudioElement>("audio")];

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

			// The listening desk, on the full player only: loop a passage from the playhead, flip A/B on each pass.
			const loopToggle = root.querySelector<HTMLButtonElement>("[data-loop]");

			// The DOM typing in use rejects HTMLSelectElement as querySelector's type argument, so it is narrowed instead.
			const loopLengthNode = root.querySelector("[data-loop-length]");

			const loopLength =
				loopLengthNode instanceof HTMLSelectElement ? loopLengthNode : null;

			const loopFlip = root.querySelector<HTMLInputElement>("[data-loop-flip]");

			let context: AudioContext | undefined,
				transport: ComparisonTransport | undefined;

			let loading: Promise<void> | undefined,
				selected = 0,
				operation = 0,
				pending = false,
				frame = 0;

			let position = 0;
			let loop: LoopRegion | undefined;

			const format = (n: number) =>
				`${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

			/** The level a version plays at when it is the one selected: the volume, and the loudness match when it is on. */
			function levelOf(audio: HTMLAudioElement) {
				const quietest = Math.min(
					...media.map((other) => Number(other.dataset.loudness ?? 0)),
				);

				return (
					Number(volume?.value ?? 1) *
					(match?.checked
						? Math.pow(
								10,
								(quietest - Number(audio.dataset.loudness ?? 0)) / 20,
							)
						: 1)
				);
			}

			/**
			 * While flipping, the selection is the version sounding, which the transport changes at each wrap on the audio
			 * clock. Frames can lag a wrap (an input event comes first), so anything that sets levels or pauses reads it from
			 * the transport first.
			 */
			function followFlip() {
				const sounding = transport?.flipped;

				if (sounding === undefined || sounding === selected) return;
				selected = sounding;
				updateCompactWaveform();
			}

			/** Sets the levels for the version sounding now, after reading it from a flip in progress. */
			function applyVolume() {
				followFlip();
				applyLevels();
			}

			/** Sets the levels for the selected version as it stands, as after an A/B press. */
			function applyLevels() {
				// The gains with each version selected.
				const levels = media.map((_, version) =>
					media.map((audio, index) => (index === version ? levelOf(audio) : 0)),
				);

				// With Loop and Flip on, the transport switches versions at each wrap, starting from the one selected now.
				if (loop && loopFlip?.checked) transport?.setFlip({ levels, selected });
				else {
					transport?.setFlip(undefined);
					transport?.setLevels(levels[selected]);
				}
			}

			// The loudness meters, one per version in the same order, on the full player only.
			const meters = [
				...root.querySelectorAll<HTMLElement>("[data-lane-meter]"),
			];

			/**
			 * Shows the loudness each version plays at: with Match loudness on, the louder one comes down to the quieter. The
			 * native players of the fallback play every export at its own level, so there the meters show those levels.
			 */
			function drawMeters() {
				if (meters.length !== media.length) return;

				const loudness = media.map((audio) =>
					Number(audio.dataset.loudness ?? 0),
				);

				const quietest = Math.min(...loudness);

				meters.forEach((meter, index) => {
					const matched =
						match?.checked && root.dataset.audioFallback !== "true";

					const played = matched ? quietest : loudness[index];
					const value = meter.querySelector("[data-lane-meter-value]");

					meter.style.setProperty("--meter", String(meterShare(played)));

					if (value)
						value.textContent = meterLine(played, loudness[index] - played);
				});
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

			/** While synced and looping, the transport flips on the audio clock: its flips are topped up, and the selection follows the version sounding. */
			function followLoop() {
				if (!transport?.playing) return;
				transport.keepFlipping();
				followFlip();
			}

			// Whether the last frame told the page the comparison was playing.
			let signalled = false;

			// A hidden page draws no frames, so a slow timer keeps the flips scheduled.
			let hiddenTimer: number | undefined;

			document.addEventListener("visibilitychange", () => {
				clearInterval(hiddenTimer);
				hiddenTimer = document.hidden
					? window.setInterval(() => {
							if (loop) render();
						}, 1000)
					: undefined;
			});

			function render() {
				cancelAnimationFrame(frame);
				followLoop();

				const duration = transport?.duration ?? Number(root.dataset.duration);
				const current = transport?.position ?? position;
				seek.max = String(duration);
				seek.value = String(current);
				seek.setAttribute("aria-valuetext", format(current));
				seek.setAttribute(
					"aria-label",
					`Seek in ${media[selected].dataset.label ?? "audio"}`,
				);
				time.textContent = `${format(current)} / ${format(duration)}`;
				root.style.setProperty("--position", `${(current / duration) * 100}%`);
				play.dataset.playing = String(Boolean(transport?.playing));
				play.setAttribute(
					"aria-label",
					`${transport?.playing || pending ? "Pause" : "Play"} ${root.dataset.title ?? "comparison"}: ${media[selected].dataset.label ?? "audio"}`,
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

				// The page hears how the comparison sounds at each frame while it plays, and once when it stops, so what
				// moves with it comes to rest.
				const sounding = Boolean(transport?.playing);

				if (sounding || signalled)
					root.dispatchEvent(
						new ComparisonSignal(transport?.level() ?? 0, sounding),
					);
				signalled = sounding;

				if (transport?.playing) frame = requestAnimationFrame(render);
			}

			function pause() {
				operation++;
				pending = false;
				transport?.pause();
				followFlip();
				status.textContent = "";
				render();
			}

			const claimPlayback = registerMusicPlayer(root, { pause });

			async function start() {
				const request = ++operation;
				media.forEach((audio) => {
					audio.pause();
					audio.controls = false;
					audio.hidden = true;
				});
				pending = true;
				claimPlayback();
				status.textContent = "Preparing synchronized audio…";
				// Another try after a load failure hides the native players again, so the fallback goes with them (a failure
				// brings it back), and the desk is offered again.
				delete root.dataset.audioFallback;
				offerDesk(true);
				drawMeters();
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

							// The decoded versions can end a little before the catalog's duration: fit the loop to them.
							if (loop) {
								loop = loopFrom(loop.start);
								drawLoop();
							}

							transport.setLoop(loop, position);
						})
						.catch((error) => {
							loading = undefined;
							throw error;
						});
					await Promise.all([resumed, loading]);

					if (request !== operation) return;
					transport!.seek(position);
					applyVolume();
					transport!.play();
					status.textContent = "";
				} catch {
					if (request === operation) {
						root.dataset.audioFallback = "true";
						media.forEach((audio) => {
							audio.controls = true;
							audio.hidden = false;
						});
						offerDesk(false);
						drawMeters();
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
				if (transport?.playing || pending) {
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

					followFlip();

					if (chosen === selected) return;
					selected = chosen;
					// The version chosen sounds now, and with Flip on the flips go on from it.
					applyLevels();
					updateCompactWaveform();
					render();
				}),
			);

			function seekTo(seconds: number) {
				const duration = transport?.duration ?? Number(root.dataset.duration);
				position = Math.max(0, Math.min(seconds, duration));

				// While looping, a seek moves the loop: it starts again from where the visitor chose.
				if (loop) {
					setLoop(position, true);

					return;
				}

				transport?.seek(position);
				render();
			}

			/** The passage Loop repeats: the chosen length from `from`, inside the song; undefined while Loop is off. */
			function loopFrom(from: number): LoopRegion | undefined {
				if (loopToggle?.getAttribute("aria-pressed") !== "true")
					return undefined;
				const duration = transport?.duration ?? Number(root.dataset.duration);
				const length = Number(loopLength?.value ?? 8);
				const start = Math.max(0, Math.min(from, duration - length));

				return { start, end: Math.min(duration, start + length) };
			}

			/** Shades the loop on the waveforms, and offers Flip only while looping. */
			function drawLoop() {
				const duration = transport?.duration ?? Number(root.dataset.duration);

				if (loopFlip) loopFlip.disabled = !loop;
				root.style.setProperty(
					"--loop-start",
					`${((loop?.start ?? 0) / duration) * 100}%`,
				);
				root.style.setProperty(
					"--loop-width",
					`${(((loop?.end ?? 0) - (loop?.start ?? 0)) / duration) * 100}%`,
				);
				root
					.querySelectorAll<HTMLElement>("[data-loop-region]")
					.forEach((region) => (region.hidden = !loop));
			}

			// The status line a seek that moved the loop is waiting to show.
			let loopNote: ReturnType<typeof setTimeout> | undefined;

			/**
			 * Loops the chosen length from `from` (the playhead by default), or stops looping when Loop is off. Playback
			 * stays where it is, moved to the loop's start if that is outside it; a seek (`seeking`) moves playback to `from`
			 * and says where the loop went once the seeking has settled.
			 */
			function setLoop(from?: number, seeking = false) {
				const now = transport ? transport.position : position;
				const at = seeking ? (from ?? now) : now;
				loop = loopFrom(from ?? now);
				position =
					loop && (at < loop.start || at >= loop.end) ? loop.start : at;
				transport?.setLoop(loop, position);
				applyVolume();
				drawLoop();

				// Written from the loop as it is when the line is shown: the decoded length can refit it before then.
				const note = () =>
					loop
						? `Looping ${format(loop.start)} to ${format(loop.end)}.`
						: "Loop off.";

				// After a seek the line waits until the seeking settles, so a drag is not read out at every step.
				clearTimeout(loopNote);

				// It leaves alone a note that matters more by then: the wait for synced playback, or the load failure.
				if (seeking)
					loopNote = setTimeout(() => {
						if (!pending && root.dataset.audioFallback !== "true")
							status.textContent = note();
					}, 700);
				// Loop pressed while the audio loads leaves the wait's note; the button says whether it is on.
				else if (!pending) status.textContent = note();
				render();
			}

			/**
			 * The native players the fallback shows cannot loop or flip, so there the desk is off and cannot be used; another
			 * try offers it again.
			 */
			function offerDesk(offered: boolean) {
				if (!offered) {
					// A loop line still waiting would describe a loop that is gone.
					clearTimeout(loopNote);

					// Focus on a control about to be disabled (Flip goes with the loop) moves to the native player of the version
					// chosen, rather than to the page.
					const focused = document.activeElement;

					// The length menu is compared as the node it was found as, which the DOM typing in use accepts.
					if (
						focused &&
						(focused === loopToggle ||
							focused === loopLengthNode ||
							focused === loopFlip)
					)
						media[selected].focus();
				}

				if (!offered && loop) {
					loopToggle?.setAttribute("aria-pressed", "false");
					loop = undefined;
					transport?.setLoop(undefined, position);
				}

				if (loopToggle) loopToggle.disabled = !offered;

				if (loopLength) loopLength.disabled = !offered;
				drawLoop();
			}

			loopToggle?.addEventListener("click", () => {
				loopToggle.setAttribute(
					"aria-pressed",
					String(loopToggle.getAttribute("aria-pressed") !== "true"),
				);
				setLoop();
			});
			// A new length applies to a loop that is on; with Loop off it waits, and playback is left alone.
			loopLength?.addEventListener("change", () => {
				if (loop) setLoop(loop.start);
			});
			loopFlip?.addEventListener("change", () => {
				applyVolume();
				render();
			});

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
						if (
							gesture.resume &&
							transport &&
							!transport.playing &&
							position < transport.duration
						) {
							transport.play();
							render();
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
							resume: Boolean(transport?.playing),
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
			match?.addEventListener("change", () => {
				applyVolume();
				drawMeters();
			});
			root.addEventListener("music-pause", pause);
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
			// A reload can bring Match loudness back already checked.
			drawMeters();
			media.forEach((audio) => {
				audio.pause();
				audio.controls = false;
				audio.hidden = true;
			});
			root.dataset.initialized = "true";
		});
}
