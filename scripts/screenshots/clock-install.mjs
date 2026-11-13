// Pins this process's clock to CLOCK_BASE when the module loads. Import it first in an entry point, before
// anything that reads the time: ES modules evaluate their imports in order, so this runs before the rest.
import { CLOCK_BASE, installClock } from "./clock.mjs";

export const clock = installClock(globalThis, Date.parse(CLOCK_BASE));
