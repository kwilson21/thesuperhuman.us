import type { ImageMetadata } from 'astro';
import type { Milestone } from '~/lib/project-story';
import designSystem from '~/assets/projects/tally/design-system-annotated.webp';
import home from '~/assets/projects/tally/home-annotated.webp';
import transactionsEdit from '~/assets/projects/tally/transactions-edit-annotated.webp';
import demoDiagram from '~/assets/projects/tally/demo-environment-diagram.webp';
import jevDiagram from '~/assets/projects/tally/jev-categorization-diagram.webp';
import phaseOneHome from '~/assets/projects/tally/phase-1-home-annotated.webp';
import exclusionsEdit from '~/assets/projects/tally/exclusions-edit-annotated.webp';
import settingsEdit from '~/assets/projects/tally/settings-edit-annotated.webp';
import howDiagrams from '~/assets/projects/tally/how-diagrams-annotated.webp';
import designCatalog from '~/assets/projects/tally/design-system-catalog-annotated.webp';
import adjustBudgets from '~/assets/projects/tally/adjust-budgets-annotated.webp';
import homeSafeToSpend from '~/assets/projects/tally/home-safe-to-spend-annotated.webp';
import bankSyncDiagram from '~/assets/projects/tally/bank-sync-diagram.webp';
import accountsPage from '~/assets/projects/tally/accounts-annotated.webp';
import emptyStates from '~/assets/projects/tally/empty-states-annotated.webp';
import formFeedback from '~/assets/projects/tally/form-feedback-annotated.webp';

export const tallyStory = {
  title: 'Tally',
  subtitle: 'Review your transactions, set monthly budgets and see how much remains to spend.',
  description: 'I shape Tally’s product design and architecture. AI coding agents implement the software. I focus on decisions that could cause problems later, and on keeping development sustainable and repeatable.',
  status: 'In development · public demo',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind: string) => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Publicist entries. Each is the owner-approved draft from its private
// review note (same ID), changed only for formatting. Captures use demo data.
export const tallyMilestones: Milestone[] = [
  {
    id: 'tally-phase-0', day: '2026-09-22',
    title: 'Why Tally',
    summary: 'I’m building Tally because nothing replaced Mint for me after it shut down. The goal is a budgeting app so simple that using it teaches you how to budget, and easy enough to come back to on a regular rhythm. It replaces my older Django personal finance app. I set the direction and Claude Code writes the code, under one rule: every part must be explainable in one plain sentence.',
    backfilled: true,
  },
  {
    id: 'tally-design-direction', day: '2026-09-22',
    title: 'Finding the look',
    summary: 'Before writing any UI, I ran four rounds of design studies. The first direction felt sterile on real screens, so I added character: tally marks, serif titles, an icon per category and one line illustration. Status always pairs color with an icon and a word.',
    backfilled: true,
  },
  {
    id: 'tally-design-system', day: '2026-09-22',
    title: 'The building blocks',
    summary: 'Claude Code set up the parts every screen shares, following the look I chose: a color palette, two open-source fonts and Lucide icons served from Tally itself, and the app shell. Its call: serve everything from Tally’s own origin so the security policy can block anything else. The trade-off is no inline styles, so the budget bars are SVG.',
    backfilled: true,
    artifacts: [artifact(designSystem, 'Tally · The building blocks', 'The app shell from PR #37 on demo data, with numbered pointers to each part and the color palette.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-data-and-money', day: '2026-09-22',
    title: 'Decisions that make cents',
    summary: 'Claude Code made the data calls here. Money is stored as whole cents, because SQLite has no exact decimal type, and all budget math lives in small tested functions. Income stays out of spending, so an uncategorized paycheck can’t look like negative spending. The public demo uses a fictional household that resets nightly.',
    backfilled: true,
  },
  {
    id: 'tally-ci-screenshots', day: '2026-09-23',
    title: 'Screenshots on every PR',
    summary: 'Every pull request now gets desktop and phone screenshots of each page, so I can review UI without running the app. They’re captured from demo data and stored in the same repository, with no extra service.',
    backfilled: true,
  },
  {
    id: 'tally-home-screen', day: '2026-09-23',
    title: 'The Home screen',
    summary: 'Home answers the question my family asks most: how much can we still spend this month? Safe to spend leads, and everything below it explains that number. Bills arrive in Phase 3, so for now it doesn’t subtract them.',
    backfilled: true,
    artifacts: [artifact(home, 'Tally · The Home screen', 'The Home screen from PR #41 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-transactions', day: '2026-09-24',
    title: 'Finding and fixing transactions',
    summary: 'Home tells you how many transactions still need a category. This is where you fix them. The Transactions list has search, month and category filters, and a Needs category filter that always matches Home’s count. Tap a row to pick a category, rename the merchant, add a note, or tick one box to always use that category for the merchant. Saving updates the list and Home together. Claude Code built it, including a browser test that goes from Home’s band through one fix. Built and tested on demo data.',
    artifacts: [artifact(transactionsEdit, 'Tally · Finding and fixing transactions', 'The edit panel over the Needs category list, from PR #45 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-demo-environment', day: '2026-09-24',
    title: 'A demo that cleans up after itself',
    summary: 'I wanted to try each change on my phone or laptop without running anything locally. So Tally’s demo is the same code deployed a second time, with its own database, a single public address and only fictional data. Every night it resets to that fictional household. The reset erases every table, so at my request it also checks for bank credentials, which the real app always has, and refuses to run if it finds any. Claude Code built the setup and a test that pins those safety settings. Deploying stays a step I run myself.',
    artifacts: [artifact(demoDiagram, 'Tally · A demo that cleans up after itself', 'The demo deployment, its own database, the nightly reset and the two-part guard.', 'Diagram')],
  },
  {
    id: 'tally-jev-categorization', day: '2026-09-24',
    title: 'AI suggests, people decide',
    summary: 'Tally’s rule is that AI suggests, code calculates and people decide. So each night, after merchant rules run, Tally asks Jev, an AI classifier, about up to 40 transactions that still need a category. Code applies an answer only when Jev is at least 80% sure, and never over a choice a person or a rule already made. The edit panel shows "Picked by Jev · 93% sure" so you can change it. After Jev’s first run on the demo, I added a "None of these fit" answer, because Household had turned into a catch-all. Claude Code built it.',
    artifacts: [artifact(jevDiagram, 'Tally · AI suggests, people decide', 'The nightly order: merchant rules first, then Jev, with the 80% rule and a write that never overrides a person.', 'Diagram')],
  },
  {
    id: 'tally-phase-1-done', day: '2026-09-25',
    title: 'Phase 1 done: a demo that explains itself',
    summary: 'Tally’s first phase is done: the demo loads over HTTPS, every Phase 1 screen works, and there are no console errors. The demo now explains itself. Home has a short Things to try list, and How Tally works shows the system diagram, each rule in plain words, and worked examples computed from the demo’s own live numbers. Claude Code then reviewed what was built against the spec, and I approved its proposals: default categories and excluding transfers move into Phase 2, so the numbers are right from day one. Try it at tally-demo.thesuperhuman.us.',
    artifacts: [artifact(phaseOneHome, 'Tally · Phase 1 done', 'The demo Home with Things to try, from PR #52 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-exclusions', day: '2026-09-25',
    title: 'Leaving transfers out of the budget',
    summary: 'Moving money between your own accounts or getting paid back isn’t spending, so Tally shouldn’t count it. Excluded transactions already stayed out of spending, safe to spend and the Needs category count; now you decide which ones. Any transaction can be excluded, or counted again, with one toggle in its edit panel: "Exclude from budget". Transactions Jev, Tally’s AI classifier, flags as a transfer or reimbursement start excluded, but Jev never overrides a choice a person made. The first panel was too cluttered, so I picked a simpler layout from three mockups. Claude Code built it, including a browser test that excludes a transaction and checks Home. Built and tested on demo data.',
    artifacts: [artifact(exclusionsEdit, 'Tally · Leaving transfers out of the budget', 'The edit panel with the Exclude from budget toggle, from PR #59 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-settings', day: '2026-09-25',
    title: 'Settings for categories and budgets',
    summary: 'A new Tally household starts with no data, so it needs a way to set up categories and monthly budgets before real use. Every new database now starts with 14 default categories, and Settings lets you rename them, set a budget from this month on, reorder them and add new ones. Categories are archived, never deleted, so past transactions keep theirs, and an archived category stays on Home for any month it has spending in. Claude Code built it from design studies I picked. I capped the list at 50 categories so every screen shows them all without paging. Built and tested on demo data.',
    artifacts: [artifact(settingsEdit, 'Tally · Settings for categories and budgets', 'Settings with one category open for editing, from PR #63 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-how-diagrams', day: '2026-09-25',
    title: 'How Tally works, now with pictures',
    summary: 'How Tally works explains each rule with a worked example from the demo’s own numbers. The goal: anyone trying the demo should see how those numbers fit together. So each section now has a small diagram, which Claude Code drew in code from the same numbers as the example beside it; a test checks that they match. Budget, Transactions and Categories are boxes and arrows. Excluding is one bar, with each kind of exclusion a dashed slice. I picked those styles from a mockup of two. The examples now also name each kind of exclusion and the income that needs no category. Built, tested and merged, on demo data.',
    artifacts: [artifact(howDiagrams, 'Tally · How Tally works, now with pictures', 'The Transactions diagram and the Excluding bar with their worked examples, from PR #64 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-design-system-catalog', day: '2026-09-26',
    title: 'A catalog for Tally’s design system',
    summary: 'The money input had drifted from my design, and there was nowhere to see and approve a component on its own. So Tally now has a catalog at /design-system, in the demo and development only. It renders the app’s real components with sample data, so it can’t show a copy that has drifted, and marks each one Visual, Interactive or Flow. Claude Code built it, with tests that fail on colors, radii or shadows outside the design tokens. I then wrote a design brief, and each built screen was audited against it. I decided six proposals by seeing each beside today’s version, and each ships in its own PR, so undoing one is a single revert.',
    artifacts: [artifact(designCatalog, 'Tally · A catalog for the design system', 'The top of the design system catalog, from PR #91 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-adjust-budgets', day: '2026-09-26',
    title: 'Adjust budgets on Home',
    summary: 'Changing a budget in Settings felt odd. My earlier budgeting app and Mint change it where you see the bars, so Tally does too. Tapping a budget on Home opens a sheet with the money input from my earlier app: round ±$1 buttons, cent arrows, and chips to round up or use last month’s spending. For quick changes, "Adjust" puts a − and + on every row, and each tap saves the budget at the next round $10. I picked that from three layouts drawn side by side, because buttons on every row looked cluttered on a phone. It all works without JavaScript. Built and tested on demo data.',
    artifacts: [artifact(adjustBudgets, 'Tally · Adjust budgets on Home', 'Home’s budget list in Adjust mode, from PR #98 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-home-safe-to-spend', day: '2026-09-26',
    title: 'Home leads with safe to spend',
    summary: 'Tally is meant for people who gave up on other budgeting apps, and an audit against its design language found Home burying its one number. On a phone, the demo’s Things to try and a large month title came first, and "Safe to spend" started halfway down the screen. I saw each fix next to today’s Home and picked there. Claude Code built them: the month is now a small heading, the number sits on a phone’s first screen, and Things to try moves below the budget list. "Needs a category" is said once, with its amount. Budget bars are thinner, and an over-budget row says by how much ("$36 over"). Built and tested on demo data.',
    artifacts: [artifact(homeSafeToSpend, 'Tally · Home leads with safe to spend', 'Home on a phone before and after PR #99, on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-bank-sync', day: '2026-09-27',
    title: 'Syncing bank data safely',
    summary: 'I chose automatic bank sync over statement uploads for Tally, and this is the server side of it. A linked bank’s Plaid token is encrypted before it’s stored, and the person who linked it is read from Cloudflare Access’s signed login token, not a header. Plaid’s webhooks count only when Plaid’s signature matches the exact body. A daily job catches up each bank in turn, so one failure doesn’t stop the rest. Each page of transactions is saved with its sync position in one database batch, so a retry never duplicates or skips anything. Codex wrote most of it; Claude Code reviewed it and made some fixes. Built and tested against a faked Plaid.',
    artifacts: [artifact(bankSyncDiagram, 'Tally · Syncing bank data safely', 'How linking, token encryption, webhook checks, the atomic sync and the daily job connect. Drawn from the code; no real bank data.', 'Diagram')],
  },
  {
    id: 'tally-accounts-page', day: '2026-09-28',
    title: 'An Accounts page grouped by bank',
    summary: 'Account balances and net worth are one of the eight features planned for Tally. More → Accounts now shows net worth (what the accounts hold minus what is owed), then each linked bank with its accounts: the last four digits, the balance, and debt as a negative number. A bank whose login needs fixing says so in words with an icon, not color alone, and a bank linked before its first sync still appears. Claude Code built the page’s three pieces in the design system catalog from a design study I picked, and I signed them off there first. Built and tested on demo data with two made-up banks; the net-worth chart comes later.',
    artifacts: [artifact(accountsPage, 'Tally · Accounts grouped by bank', 'The Accounts page on demo data with two made-up banks, from PR #115, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-empty-states', day: '2026-09-27',
    title: 'Empty lists that look finished',
    summary: 'An empty list in Tally was a blank space or one muted line. Claude Code drew three designs on Tally’s proposals page, each showing a search with no results and a list with nothing left to do, and I picked one by seeing them side by side. Codex built my pick as one component: a small line drawing, one sentence, a hint and at most one button. A magnifier means nothing matched and offers Clear filters; a tick means there’s nothing to do, so there’s no button. Transactions, Home’s budget list and Settings use it now. Built and tested on demo data.',
    artifacts: [artifact(emptyStates, 'Tally · Empty lists that look finished', 'Both kinds of empty state in the design system catalog on demo data, from PR #114, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-form-feedback', day: '2026-09-27',
    title: 'Saving, and a shake: form feedback in Tally',
    summary: 'A design review of Tally found that its forms gave no sign a save was under way, nothing stopped a second tap from sending it twice, and an error didn’t draw the eye to the field. Now Save shows a ring and "Saving…" while it works and can’t be pressed again, and a field that comes back with an error shakes once, unless the device asks for reduced motion. Without JavaScript the forms still post normally. Codex built the shared Button and TextInput components and the busy state. I chose that Save stays full colour while saving, and Claude Code fixed two sheets where it still dimmed. Built and tested on demo data.',
    artifacts: [artifact(formFeedback, 'Tally · Form feedback', 'The catalog’s busy Save, disabled Save and a field with an error, on demo data from PR #105, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
];
