// FROZEN REFERENCE COPY. This is the Zod 3 body schema of POST /api/owner/requests/[id]/brief-copy exactly as it ran before
// the Effect Schema conversion (branch claude/effect-16-brief-copy), kept only so tests/server/brief-copy-input.test.ts can
// require the Effect reader to accept and refuse every input as this one does. It is not product code: nothing under src/
// may import it (tests/architecture/legacy-validators.test.ts), and the Effect stack's final layer deletes this directory.
import { z } from "zod";

export const legacyBriefCopySchema = z.object({
	action: z.literal("send"),
	confirmedNotSent: z.boolean().optional(),
});
