// The campaign tag rule: does a playback count for one of the owner's campaigns. The player sends a campaign, a channel
// and a creative from the link the listener followed; the tag counts only when all three are named, the owner defined
// that exact combination, and the campaign is active. It reads the one stored row the three name (the combination and its
// campaign's status) and decides here; the store's query no longer asks for `status='active'`. The tag is a label on the
// row that is stored next, with no guard: a campaign that ends in between still labels the one playback, as before.
import { rule, term } from "../terms";

/** What the player sent: any of the three may be missing. */
export type CampaignAttribution = {
	readonly campaignId?: string;
	readonly channel?: string;
	readonly creative?: string;
};

/** A tag that counts: all three, as the owner defined them. */
export type CampaignTag = Required<CampaignAttribution>;

/** The stored combination the three name, with its campaign's status, or null when the owner defined none. */
export type StoredCampaignTag = CampaignTag & { readonly status: string };

type Given = {
	readonly attribution: CampaignAttribution;
	readonly stored: StoredCampaignTag | null;
};

export const tagPlayback = rule({
	name: "Tag a playback with its campaign",
	given: (
		attribution: CampaignAttribution,
		stored: StoredCampaignTag | null,
	): Given => ({ attribution, stored }),
	nothingToDoIf: term<Given>(
		"the playback does not name a campaign, channel and creative the owner defined for an active campaign",
		(g) =>
			!g.attribution.campaignId ||
			!g.attribution.channel ||
			!g.attribution.creative ||
			g.stored === null ||
			g.stored.status !== "active",
	),
	refusals: [],
	writes: (g): CampaignTag => {
		// `nothingToDoIf` has already answered for a combination that is not stored, so a stored one is here.
		if (g.stored === null)
			throw new Error("A campaign tag with no stored row.");

		return {
			campaignId: g.stored.campaignId,
			channel: g.stored.channel,
			creative: g.stored.creative,
		};
	},
	writesText: "the campaign, channel and creative",
});
