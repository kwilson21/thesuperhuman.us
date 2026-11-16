import type { z } from "astro/zod";
import { expectTypeOf, it } from "vitest";
import type {
	AgreementDetails,
	Contractor,
} from "../../src/lib/agreement-fields";
import type {
	AttachmentQuery,
	OwnerAgreementAction,
} from "../../src/lib/agreement-owner-input";
import type {
	legacyAgreementDetailsSchema,
	legacyAttachmentQuery,
	legacyContractorSchema,
	legacyOwnerAgreementAction,
} from "../fixtures/legacy-validators/agreement-fields";

// The types the Effect readers give are the types the Zod schemas gave (`z.infer` of the frozen copies), so a caller
// sees no change: this is checked by the compiler (`pnpm run check`), and the assertions here are what it checks.
it("keeps the types of the owner agreement schemas", () => {
	expectTypeOf<AgreementDetails>().toEqualTypeOf<
		z.infer<typeof legacyAgreementDetailsSchema>
	>();
	expectTypeOf<Contractor>().toEqualTypeOf<
		z.infer<typeof legacyContractorSchema>
	>();
	expectTypeOf<AttachmentQuery>().toEqualTypeOf<
		z.infer<typeof legacyAttachmentQuery>
	>();
	expectTypeOf<OwnerAgreementAction>().toEqualTypeOf<
		z.infer<typeof legacyOwnerAgreementAction>
	>();
});
