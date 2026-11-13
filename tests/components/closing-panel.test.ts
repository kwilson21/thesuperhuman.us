import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const footer = read("src/components/Footer.astro");
const global = read("src/styles/global.css");

it("keeps the footer landmark, class names and nav label", () => {
	expect(footer).toContain('<footer class="compact-footer site-shell">');
	expect(footer).toContain('<nav aria-label="Elsewhere">');
	expect(footer).toContain(".footer-name { font-size: 1.5rem;");
});

it("defaults to the invitation with one Get in touch button to the contact section", () => {
	expect(footer).toContain('variant = "invitation"');
	expect(footer).toContain('buttonLabel = "Get in touch"');
	expect(footer).toContain('buttonPath = "/#contact"');
	expect(footer).not.toMatch(/compact\?: boolean/);
});

it("has no heading or line in the panel", () => {
	expect(footer).not.toContain("heading");
	expect(footer).not.toContain("closing-line");
	expect(footer).not.toContain("closing-heading");
});

it("shows the name mark only in the quiet panel", () => {
	expect(footer).toContain("{variant === 'quiet' && <a class=\"footer-name\"");
});

it("shows the panel button only in the invitation, before the nav", () => {
	expect(footer).toContain(
		"{variant === 'invitation' && <a class=\"site-button site-button-large\" href={mainHref(buttonPath)} data-closing-button>",
	);
	expect(footer.indexOf("data-closing-button")).toBeLessThan(
		footer.indexOf('<nav aria-label="Elsewhere">'),
	);
});

it("puts the legal line after the nav", () => {
	expect(footer.indexOf('<p class="closing-legal">')).toBeGreaterThan(
		footer.indexOf('<nav aria-label="Elsewhere">'),
	);
});

it("balances the legal line when it wraps, with markup unchanged", () => {
	expect(footer).toMatch(/\.closing-legal \{[^}]*text-wrap: balance;[^}]*\}/);
	expect(footer.split('<p class="closing-legal">').length - 1).toBe(1);
	expect(footer).toContain(
		'<p class="closing-legal">The Superhuman Group LLC · {year}</p>',
	);
});

it("keeps Work with me in the links in both variants", () => {
	expect(footer).toContain("<a href={hireHref}>Work with me</a>");
	expect(footer).not.toContain("variant === 'quiet' && <a href={hireHref}>");
});

it("mutes the footer nav links", () => {
	expect(footer).toMatch(
		/\.compact-footer nav a \{[^}]*color: var\(--muted\);/,
	);
});

it("draws the panel from tokens with no border, shadow or motion", () => {
	expect(footer).toMatch(
		/\.closing-panel \{[^}]*background: var\(--panel\);[^}]*border-radius: var\(--radius-panel\);/,
	);
	expect(footer).toMatch(/\.closing-panel \{[^}]*padding: 3rem 2rem 2\.25rem;/);
	expect(footer).not.toContain(".closing-panel--quiet { padding-top");
	expect(footer).toMatch(
		/@media \(max-width: 600px\) \{[^@]*\.closing-panel \{[^}]*border-radius: 28px;[^}]*padding: 3rem 1\.25rem 1\.75rem;/,
	);
	expect(footer).not.toMatch(
		/border-top|box-shadow|data-reveal|animation|#[0-9a-fA-F]{3,6}\b/,
	);
});

it("sets the space above and below the panel", () => {
	expect(footer).toMatch(
		/\.compact-footer \{[^}]*margin-top: var\(--site-section-space\);[^}]*padding-bottom: var\(--space-8\);/,
	);
});

it("keeps the nav gap above the links on the invitation only", () => {
	expect(footer).toMatch(/nav \{[^}]*margin-top: 3\.25rem;/);
	expect(footer).toMatch(/\.closing-panel--quiet nav \{ margin-top: 0; \}/);
});

it("keeps the global pill button used by the closing panel", () => {
	expect(global).toMatch(
		/\.site-button \{[^}]*border-radius: var\(--radius-button\);/,
	);
});

const quiet = [
	"src/pages/index.astro",
	"src/pages/privacy.astro",
	"src/pages/404.astro",
	"src/pages/software/start.astro",
	"src/components/audio/AudioFooter.astro",
];

const invitation = [
	"src/pages/building.astro",
	"src/pages/writing/ai-gives-you-speed.astro",
	"src/layouts/ProjectLayout.astro",
];

it("gives quiet pages the quiet panel", () => {
	for (const path of quiet)
		expect(read(path), path).toMatch(
			/<Footer variant="quiet"( slot="footer")? \/>/,
		);
});

it("gives invitation pages the default panel", () => {
	for (const path of invitation)
		expect(read(path), path).toContain('<Footer slot="footer" />');
});

it("gives Work, About and Writing the default panel with no per-page copy", () => {
	const work = read("src/pages/work.astro");
	const about = read("src/pages/about.astro");
	const writing = read("src/pages/writing/index.astro");
	expect(work).toContain('<Footer slot="footer" />');
	expect(about).toContain('<Footer id="contact" slot="footer" />');
	expect(writing).toContain('<Footer slot="footer" />');

	for (const page of [work, about, writing]) {
		expect(page).not.toContain("heading=");
		expect(page).not.toContain("buttonLabel=");
	}
});

it("keeps the Writing index invitation block, not a heading in the footer", () => {
	const writing = read("src/pages/writing/index.astro");
	expect(writing.match(/class="writing-invitation"/g)).toHaveLength(1);
	expect(writing).not.toContain("<h2>Have something to discuss?</h2>");
});

it("removes page-connect and the compact prop everywhere", () => {
	expect(global).not.toContain("page-connect");

	for (const path of [
		...quiet,
		...invitation,
		"src/pages/work.astro",
		"src/pages/about.astro",
	]) {
		expect(read(path), path).not.toContain("page-connect");
		expect(read(path), path).not.toMatch(/<Footer[^>]* compact/);
	}
});

it("keeps Home’s contact section and About’s resume request", () => {
	expect(read("src/pages/index.astro")).toContain(
		'<section id="contact" class="site-section contact-section"',
	);
	expect(read("src/pages/about.astro")).toContain(
		'<details id="resumes" class="resume-section context-disclosure">',
	);
});

it("does not stack bottom padding above the panel on Privacy", () => {
	const privacy = read("src/pages/privacy.astro");
	expect(privacy).toContain('<article class="site-shell pt-16">');
	expect(privacy).not.toContain("py-16");
});

it("drops the essay close bottom padding so the footer owns the space", () => {
	expect(read("src/pages/writing/ai-gives-you-speed.astro")).toContain(
		".essay-close { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1.5rem; padding-block: 2rem 0;",
	);
	expect(read("src/pages/writing/index.astro")).toContain(
		".writing-invitation { padding-block: 2.5rem; border-top: 1px solid var(--rule); }\n  .writing-invitation:last-of-type { padding-bottom: 0; }",
	);
});

it("keeps the link and large button arrows still under reduced motion", () => {
	expect(global).toContain(
		".site-link span, .site-link:hover span { transition: none; transform: none; }",
	);
	expect(global).toContain(
		".site-button-large span, .site-button-large:hover span { transition: none; transform: none; }",
	);
	expect(global).not.toContain(".site-link span { transform: none; }");
});

it("uses ink for readable footer link hover text on the panel", () => {
	expect(footer).toMatch(
		/\.compact-footer nav a:hover \{ color: var\(--ink\); \}/,
	);
	expect(footer).not.toMatch(/nav a:hover \{ color: var\(--accent\)/);
});

it("renders the pinned button only on invitation pages, hidden until the script shows it", () => {
	expect(footer).toContain(
		"{variant === 'invitation' && <div class=\"pinned-contact\" data-pinned-contact hidden>",
	);
	expect(footer).toContain(
		"<script>\n  import { setupPinnedContact } from '~/scripts/pinned-contact';",
	);
	expect(footer).toContain("setupPinnedContact();\n</script>");
});

it("hides the pinned button by default and shows it only on phones", () => {
	expect(footer).toContain(".pinned-contact { display: none; }");

	const mobileStart = footer.indexOf(
		"@media (max-width: 600px) {",
		footer.indexOf(".pinned-contact { display: none; }"),
	);

	expect(mobileStart).toBeGreaterThan(-1);
	const mobile = footer.slice(mobileStart, footer.indexOf("@media print"));
	expect(mobile).toContain(".pinned-contact:not([hidden])");
	expect(mobile).toContain("position: fixed");
	expect(mobile).toContain(".pinned-contact[data-at-end] { display: none; }");
	expect(mobile).toContain(
		":global(body:has(.mobile-menu[open])) .pinned-contact",
	);
	expect(mobile).toContain(
		":global(body:has(main :is(input, textarea, select):focus)) .pinned-contact",
	);
	expect(mobile).toContain(
		":global(html:has([data-pinned-contact]:not([hidden]))) { scroll-padding-bottom: 5.5rem; }",
	);
});

it("hides the pinned button in print", () => {
	expect(footer).toContain(
		"@media print { .pinned-contact { display: none !important; } }",
	);
});

it("leaves the essay with one invitation, the panel button", () => {
	const essay = read("src/pages/writing/ai-gives-you-speed.astro");
	expect(essay).toContain(
		'<nav class="essay-close" aria-label="Continue exploring"><a class="site-link" href="/writing">Back to Writing <span aria-hidden="true">←</span></a></nav>',
	);
	expect(essay).not.toContain("Get in touch");
});
