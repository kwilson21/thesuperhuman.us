/** @param {string | undefined} configured */
export const siteOrigin = (configured) => new URL(configured ?? 'https://thesuperhuman.us').origin;
