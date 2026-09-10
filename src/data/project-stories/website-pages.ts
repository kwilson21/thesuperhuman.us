import homeBefore from '~/assets/projects/website/home-before-full.webp';
import homeAfter from '~/assets/projects/website/home-after-full.webp';
import workBefore from '~/assets/projects/website/work-before-full.webp';
import workAfter from '~/assets/projects/website/work-after-full.webp';
import aboutBefore from '~/assets/projects/website/about-before-full.webp';
import aboutAfter from '~/assets/projects/website/about-after-full.webp';
import buildingBefore from '~/assets/projects/website/building-before-full.webp';
import buildingAfter from '~/assets/projects/website/building-after-full.webp';
import writingBefore from '~/assets/projects/website/writing-before-full.webp';
import writingAfter from '~/assets/projects/website/writing-after-full.webp';
import writingIndex from '~/assets/projects/website/writing-index-after.webp';
import audioBefore from '~/assets/projects/website/audio-before-full.webp';
import audioAfter from '~/assets/projects/website/audio-after-full.webp';

export const websitePages = [
  { id: 'home', name: 'Home', change: 'From a career introduction to an invitation.', description: 'The opening introduces software, sound and curiosity. Current projects, work highlights and writing become paths into the rest of the site.', before: homeBefore, after: homeAfter },
  { id: 'work', name: 'Work', change: 'Make the professional evidence easier to assess.', description: 'Outcome diagrams lead into the work. Career history sits behind them, including the distinct Lyft teams. The introduction reflects my interest in building with AI.', before: workBefore, after: workAfter },
  { id: 'building', name: 'Building', change: 'Let each project explain itself.', description: 'The overview gives a reason to explore each project. The deeper pages own the demonstrations and development history.', before: buildingBefore, after: buildingAfter },
  { id: 'about', name: 'About', change: 'Follow a person, not another resume.', description: 'Audio, software, play and future possibilities follow a visual path. Professional history has its home on Work.', before: aboutBefore, after: aboutAfter },
  { id: 'writing', name: 'The essay', change: 'Keep the argument. Improve the reading experience.', description: 'A quieter reading layout, section navigation and a diagram help people follow the existing essay. Writing also gains its own index.', before: writingBefore, after: writingAfter, extra: writingIndex },
  { id: 'audio', name: 'Audio', change: 'Bring sound into the same personal site.', description: 'The shared typography and navigation carry through. Restrained artwork and service icons replace the heavier presentation; a short services sheet supports direct conversations.', before: audioBefore, after: audioAfter },
];
