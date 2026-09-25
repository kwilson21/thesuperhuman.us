# Channel playbooks

One publicist writes for every channel. Each channel gets a playbook instead of its
own agent, so there is one review gate, one queue and one voice. If a channel later
needs deeper focus, the publicist can hand that channel's drafting to a helper
agent inside the same run, still under the same gate and the same approval PR.

| Channel | Kind | Job | Cadence | How it is published |
| --- | --- | --- | --- | --- |
| Website journal | Home | The full story of each change; every post links here | Per merged milestone | Merge of the public PR deploys it |
| LinkedIn | Feed | Professional story posts for recruiters and hiring managers | At most 1 a weekday | API for posts once approved; profile edits by hand |
| Bluesky | Feed | One idea per post, conversation with developers (@thesuperhuman.us) | 1 to 2 a day | API once approved (free) |
| X | Feed | One idea per post, wider reach (@TechGnostic_) | 1 to 2 a day | By hand; the API is paid per post |
| YouTube | Video | Software and music on one channel, @KazonTheOne ([playbook](youtube.md)) | At most 1 video a week, plus releases | Uploaded by hand in YouTube Studio at first |
| GitHub | Profile | Profile README (`kwilson21/kwilson21`), project READMEs, pinned repos | When a milestone lands | PRs for README changes; pinning by hand |
| Ko-fi | Profile | Support for all of the owner's work, tips only | Permanent links; at most 1 support post a month ([plan](ko-fi.md)) | By hand; no posting API is known |

Feed limits are per network (design doc, section 8): at most 1 LinkedIn post a
weekday, at most 2 posts a day each on Bluesky and X, and at most 5 across all
networks. YouTube videos and profile updates sit outside those limits, but a post
announcing a video counts against them.

**Where there is no API, the owner clicks.** For profile setup, the Ko-fi page,
YouTube uploads and pinned repos, the publicist prepares a checklist with the exact
text, images and files, and the owner spends a few minutes in the site's own
interface. The design does not use a GUI-driving agent for these: LinkedIn and X
prohibit automated activity outside their APIs, and it would need a standing
signed-in session to the owner's accounts.

## Feed platforms

**Platforms (recommendation).** Keep two, not three.

- **LinkedIn** is where recruiters and hiring managers already are, the site's main
  professional audience. Posting to your own profile needs only the self-serve
  "Share on LinkedIn" product (`w_member_social`); tokens expire after about 60 days,
  so automated posting needs a re-sign-in roughly every two months.
- **X** already has the account. Since February 2026 its API is pay-per-use:
  about $0.015 per post and $0.20 per post containing a URL, so about 60 linked
  posts a month cost roughly $12.
- **Bluesky** is free to post to through its open API (an app password is enough;
  limits are far above what a person needs), chronological by default, and its
  users skew toward developers and writers who reply. But it is small and
  shrinking: about 10 million monthly app users in mid-2026, roughly half its
  late-2024 peak, and posts reach far fewer people than on X.

**Decision (owner, 2026-09-25): all three networks.** The owner still uses X and
wants posts there at the same cadence as Bluesky. The original recommendation
follows for the record: **two networks, not three. LinkedIn plus Bluesky as a reset,
with X going quiet.** A third platform works against the goal of doing less. Since
you are open to a reset and not fond of X, Bluesky is the better second network:
your domain becomes your handle (@thesuperhuman.us), it costs nothing to automate,
and its audience is developers who reply. The trade is reach, which LinkedIn
covers. The setup walkthrough, banner draft and profile copy are in
[bluesky/](../bluesky/README.md). If you would rather keep X, the design works
unchanged with `platform: x`.

Sources checked 2026-09-23 through search results, because this environment blocks
docs.x.com, docs.bsky.app and learn.microsoft.com. Prices, limits and token rules
are rechecked against those official pages before any automated posting is proposed:
[X API pricing](https://docs.x.com/x-api/getting-started/pricing),
[Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin),
[Bluesky rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits),
[TechCrunch on Bluesky active users (2026-08-11)](https://techcrunch.com/2026/08/11/blueskys-active-user-base-is-shrinking-as-its-focus-expands-beyond-the-app/).
