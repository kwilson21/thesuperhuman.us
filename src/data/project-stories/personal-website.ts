import type { ImageMetadata } from 'astro';
import type { Milestone } from '~/lib/project-story';
import a from '~/assets/site/redesign-studies/a-quiet-studio.webp';
import b from '~/assets/site/redesign-studies/b-living-editorial.webp';
import c from '~/assets/site/redesign-studies/c-project-gallery.webp';
import d from '~/assets/site/redesign-studies/d-open-landscape.webp';
import home from '~/assets/site/redesign-studies/home-quiet-studio-v2.webp';
import about from '~/assets/site/redesign-studies/about-personal-path-v1.webp';
import mobile1 from '~/assets/site/redesign-studies/home-mobile-v1.webp';
import mobile2 from '~/assets/site/redesign-studies/home-mobile-v2.webp';
import work from '~/assets/site/redesign-studies/work-v1.webp';
import building from '~/assets/site/redesign-studies/building-v1.webp';
import writing from '~/assets/site/redesign-studies/writing-v1.webp';
import daily from '~/assets/site/redesign-studies/daily-detail-v1.webp';
import threadline from '~/assets/site/redesign-studies/threadline-detail-v2.webp';
import lyft1 from '~/assets/site/redesign-studies/lyft-work-story-v1.webp';
import lyft2 from '~/assets/site/redesign-studies/lyft-work-story-v2.webp';
import audio1 from '~/assets/site/redesign-studies/audio-page-v1.webp';
import audio2 from '~/assets/site/redesign-studies/audio-page-v2.webp';
import audio3 from '~/assets/site/redesign-studies/audio-page-v3.webp';
import resume1 from '~/assets/site/redesign-studies/resume-flow-v1.webp';
import resume2 from '~/assets/site/redesign-studies/resume-flow-v2.webp';
import readerPaths from '~/assets/projects/website/reader-paths.svg';
import softwareSheet from '~/assets/projects/website/software-sheet.webp';
import audioSheet from '~/assets/projects/website/audio-sheet.webp';
import currentWork from '~/assets/projects/website/work-after.png';
import oldNewsPremiere from '~/assets/site/old-news-premiere.webp';
import oldNewsMerchConcepts from '~/assets/site/old-news-merch-concepts.webp';
import musicSkyline from '~/assets/site/music-skyline.webp';
import playbackBefore from '~/assets/projects/website/bugfixes/playback-before.png';
import playbackAfter from '~/assets/projects/website/bugfixes/playback-after.png';
import comparisonLayoutBefore from '~/assets/projects/website/bugfixes/comparison-layout-before.png';
import comparisonLayoutAfter from '~/assets/projects/website/bugfixes/comparison-layout-after.png';
import ownerTooltipBefore from '~/assets/projects/website/bugfixes/owner-tooltip-before.png';
import ownerTooltipAfter from '~/assets/projects/website/bugfixes/owner-tooltip-after.png';
import motionHomeWorlds from '~/assets/projects/website/motion-home-worlds-annotated.webp';
import pagesRefreshBuilding from '~/assets/projects/website/pages-refresh-building-annotated.webp';
import copyCheckDiagram from '~/assets/projects/website/copy-check-diagram.webp';
import audioIntake from '~/assets/projects/website/audio-intake-annotated.webp';
import softwareServices from '~/assets/projects/website/software-services-annotated.webp';
import plainExplanations from '~/assets/projects/website/plain-explanations-building-annotated.webp';
import homepageSpeed from '~/assets/projects/website/homepage-speed-phone-annotated.webp';
import libronType from '~/assets/projects/website/libron-typography-annotated.webp';
import homepageReading from '~/assets/projects/website/homepage-reading-annotated.webp';
import tallyStory from '~/assets/projects/website/tally-story-annotated.webp';
import briefConversation from '~/assets/projects/website/brief-conversation-annotated.webp';
import abWaveforms from '~/assets/projects/website/ab-waveforms-annotated.webp';
import hallmarkDesign from '~/assets/projects/website/hallmark-services-404-annotated.webp';
import briefPaths from '~/assets/projects/website/brief-paths-annotated.webp';
import linkPreviews from '~/assets/projects/website/link-preview-frames-annotated.webp';

export const websiteStory = {
  title: 'Personal website',
  subtitle: 'Finding a clearer way to share the work.',
  description: 'From the original pages to the directions we explored and the choices that shaped the site you’re reading.',
  essayTitle: 'Showing the work, finding the words.',
  essayDescription: 'A visual account of this redesign: what felt wrong, the alternatives we explored, and the choices that brought it together.',
  status: 'Live · evolving',
};

const artifact = (image: ImageMetadata, title: string, caption: string, kind = 'Generated design study') => ({
  src: image.src, width: image.width, height: image.height, title, caption, kind,
  alt: `${title}. ${caption}`,
});

// Curated retrospectively from recorded feedback and saved studies. Dates identify
// the work described, not publication-feed receipts. Summaries express the
// intent behind each step without reproducing conversation excerpts.
export const websiteMilestones: Milestone[] = [
  {
    id: 'website-mobile-ab-playback', day: '2026-09-21',
    title: 'Let the A/B player keep playing on iPhone.', status: 'Mobile reliability',
    summary: 'The A/B player now initializes more reliably on phones and requests iOS playback audio when the device ringer is silent.',
    detailLabel: 'What changed',
    detail: 'The player keeps a browser-compatible Web Audio initialization path, then uses the optional playback audio-session category when iOS exposes it. The change preserves fallback behavior for browsers without that API.',
    visualProof: {
      label: 'A/B player mobile playback context',
      before: artifact(playbackBefore, 'Before · mobile A/B player', 'The player’s visible controls did not reveal the iPhone silent-mode failure. The problem was the browser audio category, not the layout.', 'Browser capture'),
      after: artifact(playbackAfter, 'After · mobile A/B player', 'The same player after the repair. Still images cannot prove silent-mode audio, so the behavior is also covered by the player regression checks.', 'Browser capture'),
    },
  },
  {
    id: 'website-mobile-comparison-layout', day: '2026-09-21',
    title: 'Make the A/B controls fit the song.', status: 'Mobile layout repair',
    summary: 'The compact A/B selector no longer stretches to match the loudness controls, and each playback line now follows only its own waveform.',
    detailLabel: 'What changed',
    detail: 'The selector is sized to its content rather than a shared grid column. Each playhead lives inside its own waveform stage, so it stops at the waveform it represents.',
    visualProof: {
      label: 'A/B player layout before and after',
      before: artifact(comparisonLayoutBefore, 'Before · shared playback line', 'At phone width, one playhead crossed both waveforms and the selector was governed by the wider control grid.', 'Browser capture'),
      after: artifact(comparisonLayoutAfter, 'After · waveform-bounded playback line', 'Each line now ends with its own waveform, and the A/B selector keeps only the width its controls need.', 'Browser capture'),
    },
  },
  {
    id: 'website-owner-mobile-tooltips', day: '2026-09-21',
    title: 'Keep owner-page explanations inside the screen.', status: 'Mobile layout repair',
    summary: 'The owner dashboard’s metric explanations now open inward on a phone instead of being clipped off-screen.',
    detailLabel: 'What changed',
    detail: 'Left-anchored metric explanations open to the right. Right-anchored supporting-evidence explanations open to the left. The private owner dashboard is not shown in this public timeline.',
    visualProof: {
      label: 'Owner-tooltip placement before and after',
      before: artifact(ownerTooltipBefore, 'Before · clipped explanation', 'A data-free browser fixture showing the original placement: each explanation could run outside a phone viewport. No owner metrics are shown.', 'Browser capture'),
      after: artifact(ownerTooltipAfter, 'After · inward explanation', 'The same data-free fixture after the repair: left and right explanations each open toward readable space.', 'Browser capture'),
    },
  },
  {
    id: 'website-old-news-release-experience', day: '2026-09-15',
    title: 'Give Old News a place to be heard.', status: 'Release experience',
    summary: 'I turned Old News from a catalog entry into a release page built for listening: a player, lyric-video viewing, credits, lyrics, and a way to ask for more all live together.',
    detailLabel: 'What the release page needed to hold',
    detail: 'The page needed to support the song without overstating the work. Its credits describe two-track vocal mixing and mastering, while the producer credit remains with Lexi Banks. The release design followed the existing music collections and streaming conventions instead of creating a separate system.',
    artifacts: [artifact(oldNewsPremiere, 'Old News · Release-page visual', 'Reviewed premiere artwork used to give the release its own place on the site.', 'Reviewed release artwork')],
  },
  {
    id: 'website-old-news-listening-comparison', day: '2026-09-15',
    title: 'Let the mastering change be heard.', status: 'Listening design',
    summary: 'The release experience added an A/B comparison so people can switch between the earlier version and the final master without losing their place.',
    detailLabel: 'How the comparison fits the release',
    detail: 'The comparison uses source-derived waveforms and coordinated playback rather than a static explanation. It sits beside the release details so the listening decision stays connected to the song and its credits.',
    artifacts: [artifact(musicSkyline, 'Audio · Releases collection', 'The reviewed releases-hub skyline carries the listening work into the wider Audio section.', 'Reviewed collection artwork')],
  },
  {
    id: 'website-old-news-interest-and-merch', day: '2026-09-15',
    title: 'Make room for the next signal of interest.', status: 'Release follow-through',
    summary: 'The release page also makes space for people who want more (future music, a purchase, or merchandise) without pretending those ideas are already for sale.',
    detailLabel: 'What remains deliberately provisional',
    detail: 'The merchandise image is a reviewed concept, not a product listing. The page uses an interest flow so future release decisions can be informed by explicit, consented requests.',
    artifacts: [artifact(oldNewsMerchConcepts, 'Old News · Merchandise concepts', 'A reviewed concept sheet shown as a direction for interest, not as a storefront.', 'Reviewed concept artwork')],
  },
  {
    id: 'website-start-with-the-reader', day: '2026-09-09', placement: 'story',
    title: 'Start with the person visiting.', status: 'The brief',
    summary: 'I wanted visitors to understand who I am, what I do and what I am building, with visuals that make complex work easier to grasp.',
    detailLabel: 'What I wanted visitors to leave with',
    detail: 'A curious visitor should understand who I am and what I am making. A recruiter should have enough evidence to describe me accurately. Someone considering working together should be able to judge the fit. Home, Work, Building, Writing and About would each take responsibility for part of that picture.',
    artifacts: [artifact(readerPaths, 'Give each question a place to go', 'A map of the intended reader paths. The short services pages support direct conversations.', 'Content map')],
  },
  {
    id: 'website-four-directions', day: '2026-09-09', placement: 'story',
    title: 'Four ways the same palette could feel.', status: 'Alternatives',
    summary: 'I wanted a peaceful introduction that invites curiosity. Keeping the existing palette let us explore how composition could express that feeling.',
    artifacts: [
      artifact(a, 'A · Quiet studio', 'Chosen for Home. A workspace brings software, audio and play together.'),
      artifact(b, 'B · Living editorial', 'Explored, not selected. Typography, notes and a connecting line lead the page.'),
      artifact(c, 'C · Project gallery', 'Explored, not selected. A collection of artifacts puts projects first.'),
      artifact(d, 'D · Open landscape', 'Redirected toward About. The winding path suggested a way to explore my background.'),
    ],
  },
  {
    id: 'website-keep-the-feeling', day: '2026-09-09', placement: 'story',
    title: 'A studio for Home. A path for About.', status: 'Selected direction',
    summary: 'Home needed to introduce my interests at a glance. About could take a slower path through the experiences that connect them.',
    artifacts: [artifact(home, 'Home · Selected refinement', 'The quiet studio leads into current projects, professional work and writing.'), artifact(about, 'About · Selected adaptation', 'Audio, software and play follow a path, with room for what comes next.')],
  },
  {
    id: 'website-mobile-continuity', day: '2026-09-09', placement: 'story',
    title: 'Mobile needed the same sense of flow.', status: 'Revision',
    summary: 'I wanted mobile to feel as smooth as desktop. The revision replaced disjointed image blocks with a continuous paper surface.',
    visualProof: {
      label: 'Mobile continuity before and after',
      before: artifact(mobile1, 'Mobile v1 · Not selected', 'The separate image blocks felt disjointed. Each sheet shows the page in two successive slices, not two mobile columns.'),
      after: artifact(mobile2, 'Mobile v2 · Selected', 'A more continuous composition. The left slice begins the page; the right continues it.'),
    },
  },
  {
    id: 'website-page-responsibilities', day: '2026-09-09', placement: 'story',
    title: 'Give each destination something to do.', status: 'Page studies',
    summary: 'Each destination needed a clear purpose: assess my experience in Work, explore projects in Building, and follow ideas in Writing.',
    artifacts: [artifact(work, 'Work · Initial study', 'Professional evidence and career history. The backend/data headline was later changed as my current direction became clearer.'), artifact(building, 'Building · Selected study', 'Projects lead into their own demonstrations and development histories.'), artifact(writing, 'Writing · Selected study', 'One existing essay gets room to breathe. There is no need to invent a library of posts.')],
  },
  {
    id: 'website-show-the-point', day: '2026-09-09', placement: 'story',
    title: 'Share the structure, customize the explanation.', status: 'Project details',
    summary: 'I wanted project pages to be consistent to navigate, with explanations shaped around each idea: a lesson for Daily, a return-to-work sequence for Threadline.',
    artifacts: [artifact(daily, 'Daily · Selected study', 'The composition uses a lesson preview. Implementation uses the actual lesson screenshot, not this generated reinterpretation.'), artifact(threadline, 'Threadline · Selected second study', 'The second version was preferred. Its return-to-work sequence is illustrative; the journal preserves the reviewed inspect-before-sending example.')],
  },
  {
    id: 'website-remove-repetition', day: '2026-09-09', placement: 'story',
    title: 'Let the diagram carry the explanation.', status: 'Work story revision',
    summary: 'The diagram already explained the contribution. Removing the repeated text let readers see the change and its outcome without reading the same point twice.',
    artifacts: [artifact(lyft1, 'Lyft v1 · Repeated explanation', 'The What I changed section repeated information already visible above.'), artifact(lyft2, 'Lyft v2 · Selected', 'The before/after and capacity comparison remain; additional source context can be opened when needed.')],
  },
  {
    id: 'website-audio-restraint', day: '2026-09-10', placement: 'story',
    title: 'Keep the character. Remove the strange equipment.', status: 'Audio revisions',
    summary: 'I wanted the audio page to feel inviting and credible. Keeping the headphones and using simple service icons preserved its character without distracting, implausible equipment.',
    detailLabel: 'A quality standard for future images',
    detail: 'That review became a rule for future imagery: check proportions, use real-world references when needed, and inspect the physical logic. Cables should connect to electronics, not notebooks. Review the final asset in the page, including on a small screen.',
    artifacts: [artifact(audio1, 'Audio v1 · Rejected equipment treatment', 'The interface, knobs and extra equipment distracted from the page. Shown as the rejected study, not a reference for real equipment.'), artifact(audio2, 'Audio v2 · Simpler scene', 'Headphones and a notebook remain; the service imagery is removed.'), artifact(audio3, 'Audio v3 · Selected icons', 'Small line icons distinguish the services without inventing more equipment.')],
  },
  {
    id: 'website-current-direction', day: '2026-09-10', placement: 'story',
    title: 'Make the words fit the work I want to do.', status: 'Positioning',
    summary: 'I wanted the site to reflect the work I enjoy now: shaping and building useful software. My production engineering history provides evidence of what I bring to that work.',
    detailLabel: 'What clarified in the conversation',
    detail: 'I enjoy shaping and building the solution; I do not need to originate the idea. I work independently, through contracts and projects, and I am selective about full-time roles. Work keeps the engineering history as evidence. The introduction describes where I want to go.',
    artifacts: [artifact(work, 'Earlier positioning', 'The initial Work study led with backend and data engineering.'), artifact(currentWork, 'The current direction', 'On September 10 the introduction led with building with AI. It was revised on October 20 to lead with owning useful software end to end.', 'Local implementation capture')],
  },
  {
    id: 'website-general-resume', day: '2026-09-10', placement: 'story',
    title: 'One resume, an easier next step.', status: 'Contact and resume',
    summary: 'One general resume gives people a clear professional profile and an easier next step, whether that leads to a contract, a project or a well-matched full-time role.',
    artifacts: [artifact(resume1, 'Resume v1 · Earlier choice', 'The first study offered general and DoD-focused variants. This is a historical design, not the current form.'), artifact(resume2, 'Resume v2 · Selected', 'A single request form. The lower part of the sheet explores submission and error states.')],
  },
  {
    id: 'website-make-change-repeatable', day: '2026-09-10', placement: 'story',
    title: 'Make the next conversation easier.', status: 'Pre-launch review',
    summary: 'After an in-person conversation, I wanted a short page someone could read or share immediately. Separate software and audio overviews help them understand how we might work together.',
    detailLabel: 'How the short pages fit',
    detail: 'Each overview explains what I can help with, the experience I bring, how a project starts, and where to get in touch. Both use one shared layout and print on a single page. Audio is part of the personal site, with its existing subdomain kept as another entry point.',
    artifacts: [artifact(softwareSheet, 'Software · A short overview to share', 'A later review added a concise services page for conversations that start in person. Shown in its one-page print layout.', 'Local implementation capture'), artifact(audioSheet, 'Audio · The same useful format', 'Audio belongs within the personal site, with its own services overview and a direct route into the inquiry form.', 'Local implementation capture')],
  },
  {
    id: 'website-motion', day: '2026-09-27',
    title: 'Let Home change worlds as you scroll',
    summary: 'I wanted Home to feel alive and change worlds as you scroll, without changing what it says. It follows the tagline: the studio plays a short scene, my current projects sit on a dark screen where the Lyft figure counts up, a waveform leads back to paper, and a sun rises over the contact section. Claude Code built it to my design as one shared motion layer that About, Audio, Building, Work and Writing also use, sized to each page’s job, and I reviewed it. Every page is complete without it: with reduced motion, without JavaScript or in print you see the finished frame, and anything that plays on its own rests within five seconds.',
    artifacts: [artifact(motionHomeWorlds, 'Home · Four worlds as you scroll', 'Home’s resting frame from the last CI run on PR #132, with numbered pointers to each world.', 'Annotated screen capture')],
  },
  {
    id: 'website-pages-refresh', day: '2026-09-27',
    title: 'Fewer choices, real work first',
    summary: 'An audit on September 26 found the site was already short, but asked visitors to choose too much before showing any work: jump links on every page, closing blocks that repeated the menu, and prototypes on Home. I set the goal and approved the cuts. Home now features Tally and Kaillera Next, two projects you can open, and drops "Beyond the code". Building is one list with a status on every row. This site’s journal shows the latest five updates, with the redesign story and older entries on their own pages. Claude Code built each step, which I reviewed, then moved every project’s status into one place, so the finished redesign no longer reads as ongoing.',
    artifacts: [artifact(pagesRefreshBuilding, 'Building · One list with a status on every row', 'The Building page from the last CI run on PR #135, with numbered pointers.', 'Annotated screen capture')],
  },
  {
    id: 'website-copy-check', day: '2026-09-28',
    title: 'Let the build check the copy rules',
    summary: 'My site has a few firm copy rules: no em dashes, no buzzwords, no hourly rates, and nothing that implies a current security clearance. They were written down for the coding agents I work with, yet two em dashes had still made it into a journal summary. Claude Code wrote a check that reads the site’s pages, data and public files on every build and stops the build with the file and line of each match. It still passes wording I do use, like "No active security clearance, but open to pursuing one." It matches words and characters, not tone or truth. Built and tested; it now runs on every build of the site.', // copy-check: allow (the entry names the rule itself; approved text, reviewed exception)
    artifacts: [artifact(copyCheckDiagram, 'Copy check · Rules the build enforces', 'The four rules, what the check reads and skips, and where it runs in the build.', 'Diagram')],
  },
  {
    id: 'website-audio-intake', day: '2026-09-27',
    title: 'One way to start a song',
    summary: 'The Audio page had two different forms for the same request: a booking form on the landing page and a three-step intake on the services pages. I kept the intake, since it’s the flow most likely to bring paid work. Before retiring the old form, Claude Code tested the intake on a local preview and found it never emailed me about a new request; the old form did. I chose to add that notice and delete the old form in the same change. The landing page now leads with what you can hire me for and something to hear, and the old Audio About page redirects to the services page, where its process notes now live.',
    artifacts: [artifact(audioIntake, 'Audio · One way to start a song', 'The Audio landing page after PR #125, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-software-services', day: '2026-09-29',
    title: 'A way to start a software project',
    summary: 'Software visitors used to reach only my general contact form, while audio had its own path. Now the software section of Work with me mirrors the audio page: work from Lyft, Skupos and Tally, two starting points ("Make a workflow easier" or "Bring an idea to life"), and a short brief whose questions change with the path. Behind it, I can review a brief, ask a question or decline, and send a versioned fixed-price offer through a private link. Once work starts, the client gets a private project page with updates, reviews and messages. Codex built each part from designs I chose; Claude Code reviewed them. Built and tested; the public pages are live.',
    artifacts: [artifact(softwareServices, 'Services · A way to start a software project', 'The software section of the services page from PR #152, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-plain-explanations', day: '2026-09-30',
    title: 'Saying what each thing does',
    summary: 'Visitors could see my service categories without knowing what they would send, what I would do, or what the work would change. So I rewrote the site’s descriptions as plain actions. Home now says I build software, design websites, and mix and master music, and that I turn an idea into a first version people can try or make a repeated task easier. Work says what I built at Skupos and Lyft. The Building page now shows each project with a drawn illustration, three things you can do with it, and how it is built. The Engineer’s Daily and Threadline moved to an Earlier prototypes section, still linked. Built and tested; both changes are live.',
    artifacts: [artifact(plainExplanations, 'Building · Saying what each thing does', 'The Building page after PR #159, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-homepage-speed', day: '2026-10-02',
    title: 'A faster first read of Home',
    summary: 'I wanted Home to say who I am and what you can do here more quickly. The opening is now one sentence: I build software, design websites, and mix and master music. Beside it, a "Work with me" button goes straight to the contact section, next to the link to what I’m building. My Lyft result (5,000 to 100,000+ rows per batch) now comes right after the opening instead of further down the page. A follow-up removed a duplicate "Start your song" button, so each action appears once. Built and tested; live on the site.',
    artifacts: [artifact(homepageSpeed, 'Home · A faster first read', 'Home on a phone before PR #161 and after PR #162, with numbered pointers.', 'Annotated page captures')],
  },
  {
    id: 'website-libron-typography', day: '2026-10-04',
    title: 'Moving the site’s serif to Libron',
    summary: 'The site’s headings and serif text now use Libron v0.25, an open-source typeface under the SIL Open Font License, served from the site itself instead of Google Fonts. The bar over the z in my name is drawn inside the font, so I rebuilt both name fonts from Libron Regular. The page still holds the plain letters "Kazon Wilson", so selecting, copying and searching the name work as before, and a browser check on every screenshot run now confirms it. Inter and JetBrains Mono stay. Code review by Greptile caught four follow-ups before merge, including a social card still using the old type.',
    artifacts: [artifact(libronType, 'Type · Moving the serif to Libron', 'The top of the home page before and after PR #163, with numbered pointers.', 'Annotated page captures')],
  },
  {
    id: 'website-homepage-reading', day: '2026-10-10',
    title: 'Easier to read, easier to start',
    summary: 'Two small updates to Home. First, reading and tapping: descriptive text now stops at about 65 characters a line, headings balance across their lines, and small controls like "About this A/B" and "Credits and full comparison" are 44 pixels tall to tap while looking the same size. Hover effects now apply only with a mouse or trackpad, a press gives a light dimmed feedback, and pages fade briefly into each other when your device allows motion. Second, the main button on Home now reads "Start a software project" and opens the software brief already set to an idea, at "What’s the idea?". Both are live on the site.',
    artifacts: [artifact(homepageReading, 'Home · Easier to start', 'Home on a phone before and after PR #173, with numbered pointers.', 'Annotated page captures')],
  },
  {
    id: 'website-tally-story', day: '2026-10-10',
    title: 'Who does what on Tally',
    summary: 'My Tally page needed to say what I do and what AI coding agents do. It now says I make Tally’s product and architecture decisions and review every change, with AI coding tools helping on implementation, and I focus on decisions that could cause problems later and on keeping development repeatable. The Work page names Tally as my current example of owning a product end to end, with a link. The journal opens with three highlights, each a decision, why it matters and the entries it comes from. Built and tested; the changes are live.',
    artifacts: [artifact(tallyStory, 'Building · Who does what on Tally', 'The Tally page after PR #169, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-brief-signing', day: '2026-10-10',
    title: 'A software brief as a conversation',
    summary: 'A software brief used to be a three-step form and a page to print or save. Now it is a short conversation, one question at a time, and Cloudflare’s Workers AI suggests your next few words in light grey as you type. Tab accepts; you can turn it off. Only what you type in the answer boxes is sent, never your name, email or company. Afterwards you get an email copy and a reply time. Codex built it from options I picked.',
    artifacts: [artifact(briefConversation, 'Software brief · A conversation', 'A brief question with a suggestion in the answer box, from PR #172 with fictional text, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-ab-waveforms', day: '2026-10-19',
    title: 'Fill the A/B waveforms as they play',
    summary: 'I asked for two changes to the A/B players: seek Home’s compact player from its waveform, and fill each waveform as the song plays. The bars now start neutral gray for both versions and fill with the accent color from the left, while the labels and the A/B switch name the version. A mouse or pen drags across the waveform to scrub. On a phone, a tap seeks and only a clear sideways drag scrubs, so scrolling past the player never jumps the song. I picked the colors and asked for drag-scrub. Claude Code built it and fixed two edge cases a Codex review caught, and I reviewed it.',
    artifacts: [artifact(abWaveforms, 'Website · Fill the A/B waveforms as they play', 'The A/B player on the audio page before and after, from CI captures, with numbered pointers. Track title and artwork left out.', 'Annotated page captures')],
  },
  {
    id: 'website-hallmark-design', day: '2026-10-22',
    title: 'Holding the site to Hallmark',
    summary: 'I had my site’s public pages audited against Hallmark, an open-source design standard by Together AI and the Hallmark contributors (MIT license). The audit only reported. Its real defects were fixed: faint form field edges, pages that scrolled sideways, and key links below the first screen. Where it flagged choices I had made on purpose, I compared each with a few alternatives and made 42 picks, such as service doors beside the headline and a 404 page with its words first. Hallmark is now the design standard for my UI work, and every build checks six of its rules. Claude Code built it to my design, and I reviewed it. Live on the site.',
    artifacts: [artifact(hallmarkDesign, 'Website · Holding the site to Hallmark', 'The services page and the 404 page before and after the owner\'s picks, from CI captures at 1280 by 800, with numbered pointers.', 'Annotated page captures')],
  },
  {
    id: 'website-project-brief-paths', day: '2026-10-20',
    title: 'Naming the project brief’s paths',
    summary: 'A website lead had no brief to fill in: the website button opened the contact form, and the brief only offered "a workflow that should be easier" or "an idea to bring to life". Now its first screen names three paths: Website design, Web app and Workflow automation. A website brief asks what the site is for, what you already have, with an optional link to your current site, and who will keep it up to date. Every path still leads to the same review and fixed-price offer. New paths open only once I have a personal project to show for them, so mobile apps wait. Claude Code built it to my design, and I reviewed it.',
    artifacts: [artifact(briefPaths, 'Website · Naming the project brief’s paths', 'The project brief\'s first screen with its three named paths, from the PR\'s CI capture with a fictional brief, with numbered pointers.', 'Annotated page capture')],
  },
  {
    id: 'website-video-link-previews', day: '2026-10-22',
    title: 'Link previews that move',
    summary: 'Most links to my site shared one card, and it still said "Building with AI", a line I no longer use. Now each page has its own preview: a short silent loop built from that page’s own words, artwork and screenshots, plus a poster of its first frame. Apps that play preview videos, such as Apple Messages, show the loop; the rest show the poster. There are 22 scenes, and checks fail if a scene’s text stops matching its page or a scene changes without a new render. The same day, the previews’ labels moved to the site’s new label face. Claude Code built it to my design, and I reviewed it. Live on the site.',
    artifacts: [artifact(linkPreviews, 'Website · Link previews that move', 'Still frames from Home\'s silent preview loop, from the poster to the last frame, with numbered pointers.', 'Annotated video stills')],
  },
];
