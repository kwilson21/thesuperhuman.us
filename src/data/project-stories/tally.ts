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
import merchantNameSuggestion from '~/assets/projects/tally/merchant-name-suggestion.webp';
import bankConnections from '~/assets/projects/tally/bank-connections-annotated.webp';
import organizeMerchant from '~/assets/projects/tally/organize-annotated.webp';
import feedbackButton from '~/assets/projects/tally/feedback-button-annotated.webp';
import productionSetup from '~/assets/projects/tally/production-setup-diagram.webp';
import proposalsP15 from '~/assets/projects/tally/proposals-p15-annotated.webp';
import billsScreen from '~/assets/projects/tally/bills-annotated.webp';
import transactionTools from '~/assets/projects/tally/transaction-tools-annotated.webp';
import trustworthyNumbers from '~/assets/projects/tally/price-changed-annotated.webp';
import problemSignals from '~/assets/projects/tally/problem-signals-annotated.webp';
import trendsNetWorth from '~/assets/projects/tally/trends-net-worth-annotated.webp';
import aiSwitches from '~/assets/projects/tally/ai-switches-annotated.webp';
import proposalsP41 from '~/assets/projects/tally/proposals-p41-annotated.webp';
import smarterSorting from '~/assets/projects/tally/smarter-sorting-annotated.webp';
import newCategories from '~/assets/projects/tally/new-category-suggestions-annotated.webp';
import transfersBills from '~/assets/projects/tally/transfers-and-bills-annotated.webp';
import everydayTools from '~/assets/projects/tally/everyday-tools-annotated.webp';
import squircles from '~/assets/projects/tally/squircles-annotated.webp';
import codexBuilds from '~/assets/projects/tally/codex-builds-diagram.webp';
import homeMonth from '~/assets/projects/tally/home-month-annotated.webp';
import aiGuesses from '~/assets/projects/tally/ai-guesses-annotated.webp';
import billsSchedules from '~/assets/projects/tally/bills-schedules-annotated.webp';
import transactionControls from '~/assets/projects/tally/transaction-controls-annotated.webp';
import phase3Review from '~/assets/projects/tally/add-cash-before-after-annotated.webp';
import releasesReminders from '~/assets/projects/tally/releases-reminders-diagram.webp';

export const tallyStory = {
  title: 'Tally',
  subtitle: 'Review your transactions, set monthly budgets and see how much remains to spend.',
  description: 'I make Tally’s product and architecture decisions and review every change; Claude Code and Codex help with implementation, and nothing ships without tests. I focus on decisions that could cause problems later, and on keeping development sustainable and repeatable.',
  status: 'In development · public demo',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind: string) => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Publicist entries. Each is the owner-approved draft from its private
// review note (same ID), changed only for formatting. Captures use demo data.
export const tallyDecisionHighlights = [
  {
    entries: [{ entry: 'tally-jev-categorization' }, { entry: 'tally-store-names' }],
    headline: 'AI suggestions, with people in control',
    decision: 'Jev suggests categories, and Workers AI suggests names for bank text with no clean name. A person has the final say on both.',
    relevance: 'You can change the category or reject the suggested name.',
  },
  {
    entries: [{ entry: 'tally-design-system-catalog' }],
    headline: 'Design reviewed on real components',
    decision: 'A catalog renders Tally’s real components with sample data. I wrote the design brief and decided six proposals beside today’s version.',
    relevance: 'Tests catch design-token drift, and each proposal has its own reversible PR.',
  },
  {
    entries: [{ entry: 'tally-demo-environment' }],
    headline: 'A public demo kept apart from real data',
    decision: 'The demo runs the same code with its own database and only fictional data. At my request, its nightly reset refuses to run if it finds bank credentials.',
    relevance: 'People can try Tally without running it locally, while the reset guard protects the real app.',
  },
] as const;

export const tallyMilestones: Milestone[] = [
  {
    id: 'tally-phase-0', day: '2026-09-22',
    title: 'Why Tally',
    summary: 'I’m building Tally because nothing replaced Mint for me after it shut down. The goal is a budgeting app so simple that using it teaches you how to budget, and easy enough to come back to on a regular rhythm. It replaces my older Django personal finance app. I make the design decisions and review every change; Claude Code helps with implementation. One rule applies throughout: every part must be explainable in one plain sentence.',
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
  {
    id: 'tally-bank-connections', day: '2026-09-28',
    title: 'Linking, fixing and disconnecting banks',
    summary: 'Bank sync needs more than linking: a way to repair a broken login, pull in new purchases without waiting, and back out of a bank linked by mistake. On Accounts, Link a bank opens Plaid Link; before any bank it sits in an empty state, not a $0 net worth (the design I picked). Fix connection reopens Link for a bank whose login broke. Sync now fetches new transactions, at most once a minute per bank, and each bank shows when it last synced. I put Disconnect behind Manage, keeping history unless you delete it. Codex wrote the Plaid flows; Claude Code drew the empty state and fixed edge cases. Built and tested; the demo has no Plaid.',
    artifacts: [artifact(bankConnections, 'Tally · Linking, fixing and disconnecting banks', 'The Accounts controls in the design system catalog on sample data, from PR #140, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-organize-and-export', day: '2026-09-28',
    title: 'Organize by merchant, and download your data',
    summary: 'A newly linked bank brings about 90 days of transactions at once, too many to categorize one row at a time. Organize groups the uncategorized ones by merchant and shows one group at a time, largest total first. One category choice applies to the whole group and becomes the rule for that merchant’s later purchases. I picked the one-group-at-a-time layout from drawn options. Settings also gained Your data, so nothing is stuck in Tally: every transaction as CSV, or everything as JSON, never bank logins. Codex wrote the first versions and Claude Code made the follow-up fixes. Built and tested on demo data.',
    artifacts: [artifact(organizeMerchant, 'Tally · Organize by merchant', 'Organize showing one merchant group on demo data, from PR #138, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-feedback-button', day: '2026-09-28',
    title: 'A Feedback button on every page',
    summary: 'I want feedback to be easy to send at the moment something goes wrong, when a link at the bottom of a long page is easy to miss. So Tally now has a small Feedback button fixed at the bottom-right of every page. It opens a short form: what it is, how Tally feels right now, and a message. Tally saves the report with the page it came from and the kind of device, then files it as an issue in a private GitHub repository. A nightly job retries any that didn’t go through. Codex and Claude Code built it from a design I signed off. It is off in the public demo. Built and tested.',
    artifacts: [artifact(feedbackButton, 'Tally · A Feedback button on every page', 'The Feedback button on Home on a phone, beside the form it opens, on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-production-setup', day: '2026-09-28',
    title: 'Keeping the real app apart from the demo',
    summary: 'Tally’s demo erases every table each night, so the real app must never be mistaken for it. Production is a second environment of the same code, with its own database, no demo banner and no reset, and tests fail if it shares the demo’s database or puts a secret in its config. Claude Code built it with a setup script that walks me through each step. Secrets are typed at Wrangler’s own prompt, so they stay out of shell history, and it deploys only once every setting and table is in place, so a skipped step can’t put the app live without its sign-in check. A refused sign-in logs which check failed, never the token. Built and tested.',
    artifacts: [artifact(productionSetup, 'Tally · Keeping the real app apart from the demo', 'The demo and the real app kept apart, the guided setup and what a refused sign-in logs. Outcome level; no settings, steps, addresses or secrets.', 'Diagram')],
  },
  {
    id: 'tally-proposals-p10-p22', day: '2026-09-28',
    title: 'Picking Tally’s next screens by seeing them',
    summary: 'I decide how Tally looks by seeing it, not from a description. Before building 13 new screens and flows, Claude Code drew them as phone screens on Tally’s proposals page, usually two options each, from the real components on demo data, each option with what it costs and, for the later eight, a recommendation and its reason. I picked from the drawings. For feedback I chose neither option and asked for a button that’s always visible; for suggested bills I asked for a banner that stands out more and picked from two new drawings. These are design choices, not finished features: the Bills and splits screens aren’t built yet.',
    artifacts: [artifact(proposalsP15, 'Tally · Picking the next screens by seeing them', 'The proposals page after PR #146 with P15’s two options side by side and the recommendation, on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-bills', day: '2026-10-04',
    title: 'Bills: what’s due, what’s paid, and what might be a bill',
    summary: 'Safe to spend should hold back money for bills due, so Tally now has Bills: each one overdue, due in the next 7 days, upcoming or paid, and Home sets aside those due or overdue. My rule: a missed bill stays overdue until it’s paid or the next one is due. Tally matches each bill to one payment from the same merchant, within 10% of the amount and 5 days of the due date. On a bill’s page you can link one by hand, pick its month, or reject a wrong match. Tally also suggests bills from repeat charges for you to add. Claude Code and Codex built it from drawings I picked. Built and tested on demo data.',
    artifacts: [artifact(billsScreen, 'Tally · Bills', 'The Bills screen on demo data after PR #161, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-transaction-tools', day: '2026-10-04',
    title: 'Four tools for the transaction list',
    summary: 'These four features from my earlier app are now in Tally’s transaction list. Codex and Claude Code built them from the drawings I picked. A purchase can be split across categories, and the parts must add up exactly; if the bank later changes the amount, the split is removed and the purchase asks for a category again. Cash spending can be added by hand, into one Cash account kept out of net worth. A refund belongs with what it refunds, so linking it makes it count in the purchase’s month and category. Select ticks several rows to set a category or exclude them at once. Built and tested on demo data.',
    artifacts: [artifact(transactionTools, 'Tally · Four tools for the transaction list', 'Transactions on demo data after PR #166, with Select, Add cash and a split purchase marked.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-trustworthy-numbers', day: '2026-10-05',
    title: 'Numbers you can trust',
    summary: 'A review against my earlier app found ways Tally’s safe to spend could be wrong: paychecks counted as negative spending, pending charges missing, and the month turning over at midnight UTC. Trust in that number is the point, so I put these fixes ahead of new features. Pending transactions now count, marked "Pending"; income comes from the bank’s category or a "Count as income" choice; and unreviewed credits stay out of spending until checked. "Today" follows the household’s time zone. Merchant rules run after every sync, a refund can’t exceed its purchase, and Bills offers to update a bill whose price changed. Claude Code built it, with Codex on income. Built and tested.',
    artifacts: [artifact(trustworthyNumbers, 'Tally · Numbers you can trust', 'Bills on demo data after PR #228, with “Price changed?” and the payment on offer marked.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-problem-signals', day: '2026-10-05',
    title: 'When something’s wrong, Tally says so',
    summary: 'A review against my earlier budgeting app found places where Tally stayed quiet: a bank that stopped syncing, a save lost to a bad connection, a missing page, and a first empty list that read like a failed search. Home now says when a bank needs signing in or hasn’t synced for 3 days, since Safe to spend may be too high. A failed save shows an error toast and keeps what was typed. Tally has its own 404 and 500 pages, and the first empty list says "Link a bank" or "Importing". How Tally works now explains a household’s own numbers too. I picked each design from options Claude Code drew. Built and tested, with sample data.',
    artifacts: [artifact(problemSignals, 'Tally · When something’s wrong, Tally says so', 'The stale-bank line on Home beside the new 404 and 500 pages, from the design system catalog on sample data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-trends-net-worth', day: '2026-10-05',
    title: 'Trends and a net-worth line',
    summary: 'I wanted Trends to make budgeting feel worth it. It shows what’s spent so far this month against the same days last month, then each category’s change. Money with no category gets its own row, so the rows add up. Below that, "Going well" lists categories under budget three months running and "Worth a look" lists ones rising three months running. Accounts now draws net worth over six months from one balance per account per day. The line waits until every account has a balance, so linking a bank never looks like growth. Code writes every sentence, not AI. Claude Code built both from designs I picked. Built and tested on demo data.',
    artifacts: [artifact(trendsNetWorth, 'Tally · Trends and a net-worth line', 'Trends from PR #229 and Accounts from PR #230 on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-ai-switches', day: '2026-10-05',
    title: 'Switches to turn Tally’s AI off',
    summary: 'I want every AI feature in Tally to have its own off switch, so people choose what it does rather than take it on trust. Settings now has an AI suggestions group with two switches: one for category guesses and the transfer and reimbursement flags that leave a transaction out of the budget, one for spotting income. Off means Tally works from your rules and choices alone, and nothing already decided changes. The nightly run checks the switches before each question and again before using each answer, so turning one off mid-run counts at once. Switches for planned AI features come when those ship. I picked the layout; Claude Code built it. Built and tested on demo data.',
    artifacts: [artifact(aiSwitches, 'Tally · Switches to turn the AI off', 'Settings with the AI suggestions group, PR #231 on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-proposals-p23-p75', day: '2026-10-05',
    title: 'Fifty-three more design choices, made by seeing them',
    summary: 'After Bills and splits, Tally had 53 more design questions: Trends, net worth, fixes that keep Safe to spend honest, a switch for every AI feature, eight more features, forms, motion and corners. Claude Code drew each on the proposals page and recommended one option, and I picked from the pictures. Usually I agreed; I didn’t for the AI switches, the error pages, the reconnect email and the type filter. I asked for Trends to make budgeting feel worth it, so Claude Code redrew it to lead with good news. I later dropped one pick, storing documents, as I couldn’t see a use for them. Trends and the AI switches are built since; most picks aren’t yet.',
    artifacts: [artifact(proposalsP41, 'Tally · Fifty-three more design choices', 'P41 on the proposals page: the recommended option and the one I picked, on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-smarter-sorting', day: '2026-10-06',
    title: 'Tally’s AI sorts sooner and learns from people',
    summary: 'I want Tally’s AI to earn trust: quick, taught by the right people, and easy to check. Jev now sorts a bank sync’s new transactions right after the sync, not only overnight, inside the same daily limit and with its own off switch. Before each guess, it is told how that store’s last five trips were sorted, counting only choices a person or a merchant rule made, so a wrong AI guess can’t teach itself. For the demo, two links switch the list between what Tally made of it and what the bank sent. I picked these rules; Claude Code and Codex built them. Built and tested; not on the public demo yet.',
    artifacts: [artifact(smarterSorting, 'Tally · The AI sorts sooner and learns from people', 'Transactions in Tally’s view and straight from the bank, side by side, from PR #270 on demo data (2026-10-06), with numbered pointers. One raw bank row is blurred.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-new-category-suggestions', day: '2026-10-06',
    title: 'Tally suggests new categories; people create them',
    summary: 'When Tally’s AI says none of a household’s categories fit, that shouldn’t be a dead end, and the AI should never make categories itself. Now, when three or more such purchases look alike, Workers AI proposes a name, like Pet Care, and Settings shows it as a dashed card with its purchases ticked. A person creates the category with the ticked ones or dismisses the idea, and a dismissed name is never suggested again. Unticked purchases are sorted again right away, with an optional note. The AI sees store and category names, never amounts or dates. I picked how it looks and behaves; Claude Code and Codex built it. Built and tested; not on the public demo yet.',
    artifacts: [artifact(newCategories, 'Tally · Suggested new categories', 'Settings with a suggested Pet Care category on demo data, with numbered pointers.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-transfers-and-bills', day: '2026-10-06',
    title: 'Transfers out, bill payments in',
    summary: 'Moving money between your own accounts or paying a card isn’t spending, but Tally left those out only after its nightly AI run, and a card payment could be counted twice. Now the bank’s transfer and loan-payment categories leave a transaction out as soon as it syncs, unless a person decided otherwise. A payment linked to a bill always counts, and it takes its bill’s category, so fewer transactions wait for one. Bills now shows what bills cost a month and what’s still to pay this month. I picked the Bills layouts and which category wins. Claude Code built the transfer rule; Codex built the Bills changes. Built and tested on demo data.',
    artifacts: [artifact(transfersBills, 'Tally · Transfers out, bill payments in', 'Bills and Transactions side by side on demo data from PR #287, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-everyday-tools', day: '2026-10-06',
    title: 'Everyday controls in Tally',
    summary: 'Each of these closes a gap I found against my earlier app or follows a choice I made after seeing it drawn. Settings now lets a household pick its time zone, which decides when the month and each bill’s status turn over. Transactions can be filtered by account and by type: spending, income, refunds or excluded. A budget’s sheet offers a 3-month average beside last month’s spending; code works it out, and the person decides. Deleting a cash entry asks first, then offers Undo for ten seconds, a safety net under the question, not a replacement. Claude Code built the time zone and filters; Codex built the average and Undo. Built and tested on demo data.',
    artifacts: [artifact(everydayTools, 'Tally · Everyday controls', 'The time zone setting, the account and type filters, and the 3-month average, on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-polish-and-motion', day: '2026-10-06',
    title: 'Quiet motion, calmer corners and a phone that fits',
    summary: 'I asked to adopt what helps from micro-interaction libraries I’d shared, without adding any. Tally’s motion is plain CSS: sheets rise, toasts fade and pages cross-fade in 200 ms or less, and nothing moves under reduced motion. I picked squircle corners for buttons, fields and sheets after seeing them drawn five times larger; chips stay pills, and browsers without support keep round corners. A polish pass over the Phase 3.5 pages fixed tap targets, headings and copy. On phones, focused items and a list’s last rows scroll clear of the tab bar, and a long store name no longer widens the page. Claude Code built most of it; Codex built the phone fixes. Built and tested on demo data.',
    artifacts: [artifact(squircles, 'Tally · Calmer corners', 'The budget sheet after PR #257 on demo data, with a magnified before and after of a button’s corner.', 'Annotated screen capture, demo data')],
  },
  {
    id: 'tally-codex-builds', day: '2026-10-06',
    title: 'Codex builds, Claude Code delivers',
    summary: 'Work that never reaches GitHub is lost, and Codex’s work on three Tally issues was lost that way when it was trusted to push. So on October 6 I changed how Tally is built. Codex builds each issue from a brief, tests first, in a worktree on my machine; a fresh Codex run verifies it. Claude Code only delivers: it pushes only the verified commit, opens the PR, confirms both on GitHub, answers every review and checks changed pages in a browser. Design and product choices stay mine. By that night 16 more code PRs had merged, each built or verified by Codex. That morning, the last of Phase 3.5’s fixes to the rules behind Tally’s numbers merged.',
    artifacts: [artifact(codexBuilds, 'Tally · Codex builds, Claude Code delivers', 'The build, verify and deliver steps, and the decisions that led to them.', 'Diagram')],
  },
  {
    id: 'tally-home-month', day: '2026-10-11',
    title: 'Home tells you about the month',
    summary: 'A review against my earlier budgeting app found Tally missing things that app had: past months, a savings goal, a nearly-spent warning, and a plain "Over budget this month" instead of a bare negative. Tally has them now, each picked from pictures. Arrows and month dots open a finished month, stamped Under or Over, with one bar per category. From day 7, Home forecasts where the month ends at its current pace. A savings goal comes off Safe to spend from the 1st. Bars turn amber at 80% spent, older uncategorized transactions get their own chip, and a budget links to its transactions. Codex and Claude Code built it. Built and tested on demo data.',
    artifacts: [artifact(homeMonth, 'Tally · Home tells you about the month', 'This month on a phone, a finished month, budget rows and a budget sheet, from CI captures of PRs #330 and #386 on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-ai-guesses', day: '2026-10-12',
    title: 'Tally’s AI guesses, shown as guesses',
    summary: 'I want Tally’s AI guesses to read as guesses, and its work to be easy to check. An income answer Tally is unsure about shows as a dashed "Maybe income". Tally fills in what a purchase was, its kind and who it was for, dashed until someone keeps them, and writes "what it was" only when it can say more than the store’s name. Settings shows what the AI did this month and how many of its picks people changed, and lists each always-use rule with Remove. After a person’s third matching pick, Tally asks before making a rule; Organize doesn’t ask yet. I picked the designs; Claude Code and Codex built them. Built and tested on demo data.',
    artifacts: [artifact(aiGuesses, 'Tally · AI guesses, shown as guesses', 'Maybe income, the dashed detail rows and the rule question, from the design system catalog on sample data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-bills-schedules', day: '2026-10-12',
    title: 'Bills that fit real schedules and prices',
    summary: 'My earlier budgeting app handled bills that don’t come monthly, so Tally now does too: weekly, every two weeks and quarterly, each judged on its own due date. Changing a bill’s amount used to change past months, so each bill now keeps an amount history, like a budget: a new price applies from its month on, and earlier months keep theirs. A review of Bills led to fixes: a bill added after its due date isn’t counted as missed, typed bank text now matches, and a refund can’t pay a bill. Status headings gained a Why?, and Possible bills suggests steady loan payments. I chose the designs and rules; Claude Code built it. Built and tested on demo data.',
    artifacts: [artifact(billsSchedules, 'Tally · Bills that fit real schedules and prices', 'Bills on demo data after PR #441, beside the catalog\'s amount history and inactive bill examples, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-transaction-controls', day: '2026-10-12',
    title: 'Working through many transactions',
    summary: 'Feedback on my earlier app said people search by category or amount, and that being stuck mid-sort with no way to add a category frustrated them most. Now Tally’s search finds amounts and category names in every month, and the count says what matched. A New category chip sits beside the others. Select ticks a whole page with one link, then every match in the month, and ticks stay across pages and filters. A transaction can be renamed alone or with every one from its store. A cash entry’s date and amount can be edited; a bank entry keeps the bank’s. I picked each design from drawings, and Claude Code built them. Built and tested on demo data.',
    artifacts: [artifact(transactionControls, 'Tally · Working through many transactions', 'The Select bar\'s states, search counts, the Rename list and the New category chip, from the design system catalog on sample data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-phase-3-review', day: '2026-10-11',
    title: 'Checking Phase 3, then fixing what it found',
    summary: 'Each Tally phase ends with a review against its spec. For Phase 3 (bills, splits, refunds and cash), Claude Code ran nine read-only audits, and a second reader challenged each finding before it was kept. The biggest of the 22: the public demo was still running a build from before Phase 3, so I had it deployed. Where behavior was a choice, I picked from pictures of the screen beside the options; clear bugs became issues. Claude Code then fixed them, including: Add cash opens with an empty amount, removing a split says which bill is no longer paid, and a linked credit marked as income counts on its own. Built and tested on demo data.',
    artifacts: [artifact(phase3Review, 'Tally · Checking Phase 3, then fixing what it found', 'Add cash before and after one of the review\'s fixes, on demo data, with numbered pointers.', 'Annotated screen captures, demo data')],
  },
  {
    id: 'tally-releases-reminders', day: '2026-10-11',
    title: 'Bank sign-in reminders and dated releases',
    summary: 'When a bank needs signing in again, Tally stops syncing it, and nobody may notice. Now a nightly run emails everyone who signed in lately, then again every three days until the bank is fixed. The email names the bank and its account endings and never shows amounts. It can be turned off in Settings. Before this, nobody could say which build of Tally was running. I chose to name each production deploy by its date, as a tagged release, and feedback reports now keep that name. Claude Code built both. Built and tested; the demo never sends email.',
    artifacts: [artifact(releasesReminders, 'Tally · Sign-in reminders and dated releases', 'How the reminder run picks banks, and how a release name reaches a feedback report. Drawn from the code.', 'Diagram')],
  },
  {
    id: 'tally-store-names', day: '2026-10-06',
    title: 'Names for bank text, chosen by a person',
    summary: 'Some bank text comes without a clean store name. Plaid’s merchant name comes first. When Plaid sends none, Workers AI suggests up to three names. A suggestion can appear provisionally in the list, dashed, but it becomes the saved name only when a person accepts it. A suggestion a person turns down isn’t offered again for that merchant record. Merchant-name suggestions are optional, with their own switch in Settings. Implemented and tested locally.',
    artifacts: [artifact(merchantNameSuggestion, 'Tally · Names for bank text, chosen by a person', 'A suggested store name, shown dashed until a person chooses it. From a local demo run on fictional data.', 'Screen capture, demo data')],
  },
];
