/** The merchandise a listener can say they would want. The release page lists them; the interest form sends the keys. */
export const MERCHANDISE = {
	shirts: "Shirts",
	hoodies: "Hoodies",
	stickers: "Stickers",
	"digital-art": "Digital art",
} as const;

/** The keys the form may send, in the order the page lists them. */
export const MERCHANDISE_KEYS = [
	"shirts",
	"hoodies",
	"stickers",
	"digital-art",
] as const;

export type MerchandiseKey = (typeof MERCHANDISE_KEYS)[number];
