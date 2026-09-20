# Services and guided intake: design review

Approved concepts are direction references. Implementation screenshots were captured from the local combined preview of PRs #44, #47, and #49–52 on September 15, 2026. They are not production screenshots or a new claim of owner acceptance.

## Services

[Approved concept](services-approved.png) · [Actual desktop](services-1440.png) · [Actual mobile](services-390.png)

## Intake Direction

[Approved concept](intake-direction-approved.png) · [Actual desktop](intake-direction-1440.png) · [Actual mobile](intake-direction-390.png)

Intentional differences: real source-derived waveforms and real catalog entries replace placeholders. “Start your song” replaces the earlier conversation CTA. Shared-file links replace direct uploads by owner choice. Creative direction is optional; engineering fundamentals are included. Old News remains draft and is visible in development only. The combined preview includes the prelaunch privacy footer.

Validation: 233 combined automated tests, Astro check (0 errors/warnings), production build, 1440/390/320px browser checks, A/B continuity, native audio/video time transfer, fullscreen controls, and a simulated delayed YouTube player. Actual YouTube service playback and live email delivery remain unverified.
