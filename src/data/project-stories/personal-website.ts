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

export const websiteStory = {
  title: 'Personal website',
  subtitle: 'Finding a clearer way to share the work.',
  description: 'From the original pages to the directions we explored, the choices I made, and the site taking shape.',
  essayTitle: 'Showing the work, finding the words.',
  essayDescription: 'A visual account of this redesign: what felt wrong, the alternatives we explored, and the choices that brought it together.',
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
    id: 'website-start-with-the-reader', day: '2026-09-09',
    title: 'Start with the person visiting.', status: 'The brief',
    summary: 'I wanted visitors to understand who I am, what I do and what I am building, with visuals that make complex work easier to grasp.',
    detailLabel: 'What I wanted visitors to leave with',
    detail: 'A curious visitor should understand who I am and what I am making. A recruiter should have enough evidence to describe me accurately. Someone considering working together should be able to judge the fit. Home, Work, Building, Writing and About would each take responsibility for part of that picture.',
    artifacts: [artifact(readerPaths, 'Give each question a place to go', 'A map of the intended reader paths. The short services pages support direct conversations.', 'Content map')],
  },
  {
    id: 'website-four-directions', day: '2026-09-09',
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
    id: 'website-keep-the-feeling', day: '2026-09-09',
    title: 'A studio for Home. A path for About.', status: 'Selected direction',
    summary: 'Home needed to introduce my interests at a glance. About could take a slower path through the experiences that connect them.',
    artifacts: [artifact(home, 'Home · Selected refinement', 'The quiet studio leads into current projects, professional work and writing.'), artifact(about, 'About · Selected adaptation', 'Audio, software and play follow a path, with room for what comes next.')],
  },
  {
    id: 'website-mobile-continuity', day: '2026-09-09',
    title: 'Mobile needed the same sense of flow.', status: 'Revision',
    summary: 'I wanted mobile to feel as smooth as desktop. The revision replaced disjointed image blocks with a continuous paper surface.',
    artifacts: [artifact(mobile1, 'Mobile v1 · Not selected', 'The separate image blocks felt disjointed. Each sheet shows the page in two successive slices, not two mobile columns.'), artifact(mobile2, 'Mobile v2 · Selected', 'A more continuous composition. The left slice begins the page; the right continues it.')],
  },
  {
    id: 'website-page-responsibilities', day: '2026-09-09',
    title: 'Give each destination something to do.', status: 'Page studies',
    summary: 'Each destination needed a clear purpose: assess my experience in Work, explore projects in Building, and follow ideas in Writing.',
    artifacts: [artifact(work, 'Work · Initial study', 'Professional evidence and career history. The backend/data headline was later changed as my current direction became clearer.'), artifact(building, 'Building · Selected study', 'Projects lead into their own demonstrations and development histories.'), artifact(writing, 'Writing · Selected study', 'One existing essay gets room to breathe. There is no need to invent a library of posts.')],
  },
  {
    id: 'website-show-the-point', day: '2026-09-09',
    title: 'Share the structure, customize the explanation.', status: 'Project details',
    summary: 'I wanted project pages to be consistent to navigate, with explanations shaped around each idea: a lesson for Daily, a return-to-work sequence for Threadline.',
    artifacts: [artifact(daily, 'Daily · Selected study', 'The composition uses a lesson preview. Implementation uses the actual lesson screenshot, not this generated reinterpretation.'), artifact(threadline, 'Threadline · Selected second study', 'The second version was preferred. Its return-to-work sequence is illustrative; the journal preserves the reviewed inspect-before-sending example.')],
  },
  {
    id: 'website-remove-repetition', day: '2026-09-09',
    title: 'Let the diagram carry the explanation.', status: 'Work story revision',
    summary: 'The diagram already explained the contribution. Removing the repeated text let readers see the change and its outcome without reading the same point twice.',
    artifacts: [artifact(lyft1, 'Lyft v1 · Repeated explanation', 'The What I changed section repeated information already visible above.'), artifact(lyft2, 'Lyft v2 · Selected', 'The before/after and capacity comparison remain; additional source context can be opened when needed.')],
  },
  {
    id: 'website-audio-restraint', day: '2026-09-10',
    title: 'Keep the character. Remove the strange equipment.', status: 'Audio revisions',
    summary: 'I wanted the audio page to feel inviting and credible. Keeping the headphones and using simple service icons preserved its character without distracting, implausible equipment.',
    detailLabel: 'A quality standard for future images',
    detail: 'That review became a rule for future imagery: check proportions, use real-world references when needed, and inspect the physical logic. Cables should connect to electronics, not notebooks. Review the final asset in the page, including on a small screen.',
    artifacts: [artifact(audio1, 'Audio v1 · Rejected equipment treatment', 'The interface, knobs and extra equipment distracted from the page. Shown as the rejected study, not a reference for real equipment.'), artifact(audio2, 'Audio v2 · Simpler scene', 'Headphones and a notebook remain; the service imagery is removed.'), artifact(audio3, 'Audio v3 · Selected icons', 'Small line icons distinguish the services without inventing more equipment.')],
  },
  {
    id: 'website-current-direction', day: '2026-09-10',
    title: 'Make the words fit the work I want to do.', status: 'Positioning',
    summary: 'I wanted the site to reflect the work I enjoy now: shaping and building useful software with AI. My production engineering history provides evidence of what I bring to that work.',
    detailLabel: 'What clarified in the conversation',
    detail: 'The exciting part is shaping and building the solution; I do not need to originate the idea. Independent work is my preference, with room for an interesting full-time opportunity. Work keeps the engineering history as evidence. The introduction describes where I want to go.',
    artifacts: [artifact(work, 'Earlier positioning', 'The initial Work study led with backend and data engineering.'), artifact(currentWork, 'The current direction', 'The introduction now leads with building with AI. Work retains the career evidence.', 'Local implementation capture')],
  },
  {
    id: 'website-general-resume', day: '2026-09-10',
    title: 'One resume, an easier next step.', status: 'Contact and resume',
    summary: 'One general resume gives people a clear professional profile and an easier next step, with room for both contract work and interesting full-time opportunities.',
    artifacts: [artifact(resume1, 'Resume v1 · Earlier choice', 'The first study offered general and DoD-focused variants. This is a historical design, not the current form.'), artifact(resume2, 'Resume v2 · Selected', 'A single request form. The lower part of the sheet explores submission and error states.')],
  },
  {
    id: 'website-make-change-repeatable', day: '2026-09-10',
    title: 'Make the next conversation easier.', status: 'Pre-launch review',
    summary: 'After an in-person conversation, I wanted a short page someone could read or share immediately. Separate software and audio overviews help them understand how we might work together.',
    detailLabel: 'How the short pages fit',
    detail: 'Each overview explains what I can help with, the experience I bring, how a project starts, and where to get in touch. Both use one shared layout and print on a single page. Audio is part of the personal site, with its existing subdomain kept as another entry point.',
    artifacts: [artifact(softwareSheet, 'Software · A short overview to share', 'A later review added a concise services page for conversations that start in person. Shown in its one-page print layout.', 'Local implementation capture'), artifact(audioSheet, 'Audio · The same useful format', 'Audio belongs within the personal site, with its own services overview and a direct route into the inquiry form.', 'Local implementation capture')],
  },
];
