// Fictional website brief from the first path choice to the owner's readback, at both widths.
import { stubTurnstile } from '../turnstile-stub.mjs';

const VIEWPORTS = ['desktop', 'phone'];
const BRIEF_ID = 'screenshot-website';
const BRIEF_PATH = '/software/start?path=website';
const brief = {
  name: 'Jordan Example', email: 'jordan@example.com', company: 'Jordan Clay Studio',
  purpose: 'A site for my pottery studio. People should see upcoming classes and sign up without messaging me first.',
  currentUrl: 'https://jordanclay.example',
  existing: 'A logo and about 30 class photos. The About and Pricing pages are still accurate.',
  timingDate: '2026-12-01',
};
const receiptFirstStep = "I’ll look at what you have and reply with a fixed-price first milestone, or a question or two.";
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

// The screens after the path, in the order the website path shows them (data-step values). Each screen
// fills its own answers, so reaching one replays every answer before it.
const screens = [
  { step: 1, fill: page => page.locator('[data-step="1"] textarea').fill(brief.purpose) },
  { step: 7, fill: async page => {
    await page.locator('[name=currentUrl]').fill(brief.currentUrl);
    await page.locator('[name=existing]').fill(brief.existing);
  } },
  { step: 8, fill: page => page.locator('[name=updates][value=self]').check() },
  { step: 3, fill: async page => {
    await page.locator('[name=timing][value=date]').check();
    await page.locator('[name=timingDate]').fill(brief.timingDate);
  } },
  { step: 4 },
  { step: 5, fill: async page => {
    await page.locator('[name=name]').fill(brief.name);
    await page.locator('[name=email]').fill(brief.email);
    await page.locator('[name=company]').fill(brief.company);
  } },
  { step: 6 },
];

// Routes, the fake Turnstile API and an empty draft are set up, then the page loads `path` so its script reads them.
// The capture opens /software/start first, so the real Turnstile script never runs on a page that asks for a question.
// The init script runs on every load, so each capture starts with no answers from an earlier one.
async function mockBrief(page, path) {
  await stubTurnstile(page);
  await page.route('**/api/software/brief/pass', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/software/brief/suggest', route => route.fulfill({ json: { suggestion: '' } }));
  await page.addInitScript(() => {
    localStorage.removeItem('software-brief-draft'); localStorage.removeItem('software-suggestions');
  });
  await page.goto(new URL(path, page.url()).href);
  await page.waitForFunction(() => !!window.turnstile);
}

// Runs one step's actions. On failure, logs the page's console output and where the form stopped, then rethrows.
async function guard(page, label, action) {
  const messages = [];
  page.on('console', message => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', error => messages.push(`pageerror: ${error.message}`));
  try {
    return await action();
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.href,
      visibleStep: document.querySelector('#software-inquiry [data-step]:not([hidden])')?.dataset.step ?? null,
      status: document.querySelector('[data-form-status]')?.textContent ?? '',
    })).catch(failure => ({ lastError: String(failure) }));
    console.error(`Website brief ${label} failure:`, JSON.stringify({ console: messages, state, error: String(error) }, null, 2));
    throw error;
  }
}

// Clicks Next through the screens before `last` (an index into `screens`), filling each one.
// The last screen is filled and shown, but not continued.
async function reachScreen(page, last) {
  for (let index = 0; index <= last; index++) {
    const screen = screens[index];
    await page.locator(`[data-step="${screen.step}"]:visible`).waitFor();
    await screen.fill?.(page);
    if (index < last) await page.locator('[data-next]').click();
  }
}

// Checking a path moves on to its first question. Back keeps the choice, so the path screen shows it checked.
async function chooseWebsitePath(page) {
  await mockBrief(page, '/software/start');
  await page.locator('[name=path][value=website]').check();
  await page.locator('[data-step="1"]:visible').waitFor();
  await page.locator('[data-back]').click();
  // Move the pointer off Next, so its hover style is not captured on a phone.
  await page.mouse.move(0, 0);
  await page.locator('[data-step="0"]:visible').waitFor();
  if (!await page.locator('[name=path][value=website]').isChecked()) throw new Error('The website path was not kept after Back.');
}

async function assertReview(page) {
  const review = await page.locator('[data-review]').textContent() ?? '';
  for (const text of ['Website design', 'Me or someone on my team', 'What you already have']) {
    if (!review.includes(text)) throw new Error(`The review is missing "${text}": ${review}`);
  }
  if (review.includes('What they already have')) throw new Error('The review uses the owner label "What they already have".');
}

// The delivery is mocked: the route answers as if the brief was saved and the copy was sent. No email call is made.
async function sendBrief(page) {
  await page.route('**/api/software-inquiry', async route => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, brief: { name: input.name, email: input.email }, clientCopyStatus: 'sent' } });
  });
  await page.waitForFunction(() => !!document.querySelector('[name=cf-turnstile-response]')?.value, null, { timeout: 30_000 });
  await page.locator('[type=submit]').click();
  await page.locator('#software-success:visible').waitFor({ timeout: 30_000 });
  const first = (await page.locator('[data-receipt-first-step]').textContent())?.trim();
  if (first !== receiptFirstStep) throw new Error(`The first next step reads "${first}".`);
}

const prepareAt = (label, last, extra = async () => {}) => page => guard(page, label, async () => {
  await mockBrief(page, BRIEF_PATH);
  await reachScreen(page, last);
  await extra(page);
});

const clientShots = [
  { name: 'choose-path', title: 'Choose a path', caption: 'Three starting points, with Website design checked', path: '/software/start',
    prepare: page => guard(page, 'choose a path', () => chooseWebsitePath(page)) },
  { name: 'purpose', title: 'What the website is for', caption: 'Fictional purpose of the website', path: '/software/start', prepare: prepareAt('purpose', 0) },
  { name: 'today', title: 'What you have today', caption: 'Fictional current site and existing material, both optional', path: '/software/start', prepare: prepareAt('today', 1) },
  { name: 'keeps-up-to-date', title: 'Who keeps it up to date', caption: 'Fictional answer: the client keeps the site up to date', path: '/software/start', prepare: prepareAt('keeps up to date', 2) },
  { name: 'timing', title: 'Timing', caption: 'Fictional needed-by date with the website hint', path: '/software/start', prepare: prepareAt('timing', 3, page => page.locator('[name=timingDate]').blur()) },
  { name: 'budget', title: 'Budget', caption: 'Budget left empty, which is optional', path: '/software/start', prepare: prepareAt('budget', 4) },
  { name: 'contact', title: 'Contact', caption: 'Fictional name, email and company', path: '/software/start', prepare: prepareAt('contact', 5) },
  { name: 'review', title: 'Review', caption: 'Fictional answers ready to send, including the website questions', path: '/software/start', prepare: prepareAt('review', 6, assertReview) },
  { name: 'receipt', title: 'Receipt', caption: 'Fictional receipt with mocked delivery and no email call', path: '/software/start', prepare: prepareAt('receipt', 6, sendBrief) },
];

export default {
  title: 'Website brief journey',
  async run({ capture, sql }) {
    // The brief is the website request the owner reads; a fresh UUID keeps it clear of the other scenarios.
    const details = { path: 'website', purpose: brief.purpose, currentUrl: brief.currentUrl, existing: brief.existing, updates: 'self',
      company: brief.company, timing: 'date', timingDate: brief.timingDate, timingReason: '', budgetStatus: '', budgetNote: '',
      approver: '', approverRole: '', clientCopyStatus: 'sent' };
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES (${quote(BRIEF_ID)},'software','website',${quote(brief.name)},${quote(brief.email)},'A site for my pottery studio.',${quote(JSON.stringify(details))},
      'new','','2026-10-19T12:00:00.000Z','2026-10-19T12:00:00.000Z','00000000-0000-4000-8000-000000000019')`);

    const shots = [
      ...clientShots,
      { name: 'owner-brief', title: 'Owner reads the website brief', owner: true, caption: "Seeded fictional website brief as the owner reads it, with the fit review and the empty offer editor's website prompts",
        path: `/owner/requests/${BRIEF_ID}`, prepare: page => page.getByRole('heading', { name: 'Their brief' }).waitFor() },
      { name: 'owner-list', title: 'Owner request list', owner: true, caption: 'Seeded fictional software requests, with the website brief listed',
        path: '/owner/requests?kind=software', prepare: page => page.getByText('A site for my pottery studio.').first().waitFor() },
    ];
    const steps = [];
    for (const shot of shots) {
      const images = [];
      for (const viewport of VIEWPORTS) {
        images.push({
          file: await capture({ file: `website-brief-${shot.name}-${viewport}.png`, path: shot.path, viewport, owner: shot.owner, prepare: shot.prepare }),
          caption: `${shot.caption} (${viewport})`,
        });
      }
      steps.push({ title: shot.title, images });
    }
    return steps;
  },
};
