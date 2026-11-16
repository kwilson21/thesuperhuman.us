import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `metaUrl` (pass `import.meta.url`) is the script being run, and not imported. Real paths are
 * compared, so a script run through a symlinked folder (a temporary directory on macOS, for one) still counts.
 */
export function ranDirectly(metaUrl) {
	try {
		return (
			realpathSync(process.argv[1] ?? "") ===
			realpathSync(fileURLToPath(metaUrl))
		);
	} catch {
		return false;
	}
}
