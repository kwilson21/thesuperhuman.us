// Curated from the owner's career account. Update professional facts here.
export const workFocus = 'I want to own the system behind a feature, including how it’s built and the infrastructure it needs.';
export const workingPreference = 'I work independently, through contracts and projects, and I’m selective about full-time roles.';
export const workingPreferenceDetail = 'I work independently, through contracts and projects. I’ll consider full-time roles where I’d own a system end to end, work fully remotely, and build with AI as a normal part of the job. If that isn’t your role, a contract is probably the better fit, and I’m glad to talk about that too.';
export const lyftBonus = { before: '5,000', after: '100,000+', evidence: 'Owner-reported batch capacity' };
// Team scope clarified by the owner on September 10, 2026. Rentals projects come
// from the existing career account. Quiet hours was completed after the July 2026
// candidate summary and is recorded separately from that historical account.
export const lyftTeams = [
  {
    "name": "Rentals team",
    "projects": [
      {
        "title": "Rental migration",
        "description": "Led migration of 40,000 rental records off a third-party service. Wrote the technical spec and risk assessment, audited discrepancies, and ran an 18,000-record audit and backfill. Built dry-run verification and caught a duplicate-charge edge case. Worked with backend engineering and support on a safeguard."
      },
      {
        "title": "Sixt reservation editing",
        "description": "Owned delivery of Sixt reservation editing from planning through deployment. Implemented changes in Lyft’s rentals service and coordinated the required Sixt API changes and mobile/web interface changes with the engineers responsible. Identified regressions in Sixt’s rebooking API and worked with its engineers to resolve them. Fixed incorrect fees for additional drivers under 25 and compatibility issues with other features in development."
      },
      {
        "title": "Touchless drop-off",
        "description": "Owned delivery of touchless rental drop-off, spanning six services and the iOS and Android apps. Implemented backend changes and coordinated with backend, design, and client engineers to meet the first milestone without delay. Worked with operations to test the feature in staging, reviewed changes from contributing teams, and helped resolve service and mobile-client issues."
      }
    ]
  },
  {
    "name": "Associate Tools team",
    "projects": [
      {
        "title": "Bulk driver bonuses",
        "description": "Refactored a tool for correcting driver bonuses to process 100,000+ rows per batch, up from 5,000. Added real-time dashboards so support could track runs and diagnose failures without asking on-call engineers to investigate."
      },
      {
        "title": "Fare recalculation",
        "description": "Led migration of a fare-recalculation tool off a legacy service, integrating seven internal services. Wrote the technical design, implemented backend and frontend changes, and added metrics and mismatch logging. Wrote a rollout guide that another engineer used to deploy the changes successfully."
      }
    ]
  },
  {
    "name": "Comms Platform team",
    "projects": [
      {
        "title": "Quiet hours",
        "description": "Implemented quiet-hours checks so marketing campaign emails respected users’ preferences. Integrated with the separate microservice owned by the team responsible for that preference data."
      }
    ]
  }
] as const;

export const skuposStages = [
  {
    "name": "Internal tools and automation",
    "projects": [
      {
        "title": "Workflow",
        "description": "Wrote Python scripts that automated tobacco scan-data troubleshooting and updates to Google Sheets, the shared source of truth for data operations and account managers, removing the need for manual updates and spreadsheet formulas."
      },
      {
        "title": "System ownership",
        "description": "Built and owned a Flask application backed by MySQL on AWS, using Huey to run and schedule the troubleshooting scripts as background tasks. Extended an existing internal React page for data operators to use the tools."
      },
      {
        "title": "Result",
        "description": "The application supported transaction-data troubleshooting across 3,000+ retailer locations; the tobacco scan-data automation supported 3–5× store growth without increasing operations headcount."
      },
      {
        "title": "Performance",
        "description": "Sped up I/O-bound Python data-loading scripts by making SQL, GraphQL, and Google Sheets API calls asynchronous."
      }
    ]
  },
  {
    "name": "Core product development",
    "projects": [
      {
        "title": "Multipack matching",
        "description": "Took ownership of multipack matching in the core product’s Rails reporting rewrite after the original developer left. Completed the feature using Python logic that generated configurations from sampled transactions, avoiding prohibitively expensive queries and refreshing configurations weekly."
      }
    ]
  }
] as const;

export const experience = [
  {
    id: 'scotch', company: 'Scotch', role: 'Data Engineer',
    dates: 'October 2025 – May 2026', location: 'Remote',
    outcome: 'Sole data engineer maintaining retail transaction data pipelines.',
    context: [
      'Maintained and operated inherited ETL pipelines in a Ruby on Rails platform, using GoodJob, EC2, and S3 to transform legacy store transaction data and bulk-load results.',
      'Handled on-call issues and deployed fixes for bugs causing recurring alarms. Prototyped an MCP-driven store-onboarding pipeline and a PII-stripping debug tool; both remained internal prototypes and were not shipped.',
      'Conducted scenario-based senior engineering interviews and contributed to hiring decisions. Advocated for AI-assisted development and helped the engineering team adopt it.',
    ],
  },
  {
    id: 'axuall', company: 'Vendorpass / Axuall', role: 'Senior Python Developer (Contract)',
    dates: 'July 2025 – November 2025', location: 'Remote',
    outcome: 'Data ingestion for a healthcare credentialing platform.',
    context: ['Built per-state Dagster pipelines ingesting medical-board data from SFTP feeds, REST APIs, and Selenium-driven web sources. Applied credentialing logic for multiple states, including North Carolina, and contributed to the early transition from legacy Python connectors to per-state pipelines.'],
  },
  {
    id: 'sure', company: 'Sure', role: 'Software Engineer',
    dates: 'December 2023 – February 2025', location: 'Remote',
    outcome: 'Backend engineering for Toggle homeowners insurance.',
    context: [
      'Added document types to the insurance pipeline, adapting HTML and CSS to carrier reference PDFs and generating application documents with Jinja.',
      'Stored documents in S3 with versioned metadata in MongoDB, and maintained document generation in Django and third-party carrier integrations.',
      'The role ended in a company-wide layoff in early 2025.',
    ],
  },
  {
    id: 'faith-church', company: 'Faith Church', companyHref: 'https://lifeatfaith.tv/', role: 'Live Sound Engineer',
    dates: '2022–2025', location: 'Houston, Texas',
    outcome: 'Live sound at Faith Church for three years.',
    context: [
      'Worked on Allen & Heath SQ-6 and SQ-5 consoles, mixing three to four vocalists, electric guitar, drums, bass, keys, and a synth/backing track.',
    ],
  },
  {
    id: 'lyft', company: 'Lyft', role: 'Software Engineer',
    dates: 'January 2021 – December 2023', location: 'Remote',
    outcome: 'From junior to mid-level engineer, with growing ownership across three teams.',
    context: ['Started on Rentals, moved to Associate Tools and was promoted to mid-level engineer, then finished on Comms Platform. The work combined technical design, cross-team delivery and responsibility for the result after rollout.'],
  },
  {
    id: 'skupos', company: 'Skupos', role: 'Associate Software Engineer / Data Operations Analyst',
    dates: 'November 2018 – January 2021', location: 'San Francisco',
    outcome: 'Intern → Associate Software Engineer: from internal system ownership to core product features.',
    context: [
      "Established code-review standards and mentored two interns on Python, code review, debugging, and Agile workflows.",
    ],
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
