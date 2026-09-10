// Curated from the owner's career account. Update professional facts here.
export const workFocus = 'I’m interested in work where I can help shape the solution, build with AI, and stay close to how people use the result.';
export const workingPreference = 'Independent work is my preference. I’m also open to the right full-time opportunity.';
export const lyftBonus = { before: '5,000', after: '100,000+', evidence: 'Owner-reported batch capacity' };
// Team scope clarified by the owner on September 10, 2026. Rentals projects come
// from the existing career account; quiet hours comes from the owner's recollection.
export const lyftTeams = [
  {
    name: 'Rentals',
    projects: [
      { title: 'Rental rebooking', description: 'Led a third-party rebooking integration from ideation through deployment, identifying vendor regressions and coordinating API changes across organizational boundaries.' },
      { title: 'Service migration', description: 'Owned a 40,000-row migration during a rentals-service deprecation. Designed a dry-run-capable plan, audited and backfilled 18,000 closed rentals, and added safeguards against duplicate customer fee charges.' },
      { title: 'Touchless drop-off', description: 'Coordinated delivery across backend, frontend, mobile, operations and program management, spanning six services and iOS and Android clients.' },
    ],
  },
  {
    name: 'Associate Tools',
    projects: [
      { title: 'Bulk driver bonuses', description: `Refactored the customer incident response team’s bonus tool from a ${lyftBonus.before}-row batch limit to handling ${lyftBonus.after} rows. Added Grafana observability so support could monitor and run the work without escalating to on-call engineers.` },
      { title: 'Fare recalculation', description: 'Led the end-to-end migration of a driver and rider fare-recalculation tool off a legacy internal service, integrating seven services and coordinating backend and frontend delivery.' },
    ],
  },
  {
    name: 'Comms Platform',
    projects: [
      { title: 'Quiet hours', description: 'Implemented quiet-hours checks so marketing campaign emails respected users’ preferences. Integrated with the separate microservice owned by the team responsible for that preference data.' },
    ],
  },
] as const;

export const experience = [
  {
    id: 'scotch', company: 'Scotch', role: 'Data Engineer',
    dates: 'October 2025 – May 2026', location: 'Remote', legacyId: 'scotch--data-engineer',
    outcome: 'Sole data engineer for a platform built around retail transaction data.',
    context: [
      'Built and maintained ETL pipelines bringing liquor-store POS transactions into a Ruby on Rails platform.',
      'Conducted scenario-based senior engineering interviews and contributed to hiring decisions. Advocated for AI-assisted development and helped the engineering team adopt it.',
    ],
  },
  {
    id: 'axuall', company: 'Vendorpass / Axuall', role: 'Senior Python Developer (Contract)',
    dates: 'July 2025 – November 2025', location: 'Remote', legacyId: 'vendorpass--axuall-contract--senior-python-developer',
    outcome: 'Data ingestion for a healthcare credentialing platform.',
    context: ['Built per-state Dagster ETL pipelines ingesting medical-board data from SFTP feeds, REST APIs, and web interfaces. Contributed to the early transition from legacy Python connectors to per-state pipelines.'],
  },
  {
    id: 'sure', company: 'Sure', role: 'Software Engineer',
    dates: 'December 2023 – February 2025', location: 'Remote', legacyId: 'sure--software-engineer',
    outcome: 'Backend engineering for Toggle homeowners insurance.',
    context: [
      'Owned the document templating pipeline, adapting HTML and CSS to carrier reference PDFs. Maintained document generation in Django and third-party carrier integrations.',
      'The role ended in a company-wide layoff in early 2025.',
    ],
  },
  {
    id: 'lyft', company: 'Lyft', role: 'Software Engineer',
    dates: 'January 2021 – December 2023', location: 'Remote', legacyId: 'lyft--software-engineer',
    outcome: 'Product and platform engineering across Rentals, Associate Tools and Comms Platform.',
    context: [],
  },
  {
    id: 'skupos', company: 'Skupos', role: 'Associate Software Engineer / Data Operations Analyst',
    dates: 'November 2018 – January 2021', location: 'San Francisco', legacyId: 'skupos--associate-software-engineer--data-operations-analyst',
    outcome: 'My first role in software, progressing from intern to associate engineer.',
    context: ['Worked with retail POS data and built tools for the analysts responsible for its quality. Also mentored interns, including one who later moved into data science.'],
  },
] as const;

export const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Kazon Wilson',
  jobTitle: 'Software Engineer',
  url: 'https://thesuperhuman.us',
  sameAs: [
    'https://github.com/kwilson21',
    'https://www.linkedin.com/in/kazonwilson/',
  ],
  worksFor: { '@type': 'Organization', name: 'The Superhuman Group LLC' },
};
