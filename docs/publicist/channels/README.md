# Channel playbooks

One publicist writes for every channel. Each channel gets a playbook instead of its
own agent, so there is one review gate, one queue and one voice. If a channel later
needs deeper focus, the publicist can hand that channel's drafting to a helper
agent inside the same run, still under the same gate and the same approval PR.

| Channel | Kind | Job | Cadence | How it is published |
| --- | --- | --- | --- | --- |
| Website journal | Home | The full story of each change; every post links here | Per merged milestone | Merge of the public PR deploys it |
| LinkedIn | Feed | Professional story posts for recruiters and hiring managers | At most 1 a weekday | API for posts once approved; profile edits by hand |
| Bluesky (or X) | Feed | One idea per post, conversation with developers | 1 to 2 a day | API once approved; X is paid per post |
| YouTube | Video | Software and music on one channel ([playbook](youtube.md)) | At most 1 video a week, plus releases | Uploaded by hand in YouTube Studio at first |
| GitHub | Profile | Profile README (`kwilson21/kwilson21`), project READMEs, pinned repos | When a milestone lands | PRs for README changes; pinning by hand |
| Ko-fi | Profile | Support for all of the owner's work | On hold ([plan needed](ko-fi.md)) | By hand; no posting API is known |

The shared limit of 3 feed posts a day covers LinkedIn and Bluesky (or X) together.
YouTube videos and profile updates sit outside that limit, but a post announcing a
video counts against it.

**Where there is no API, the owner clicks.** For profile setup, the Ko-fi page,
YouTube uploads and pinned repos, the publicist prepares a checklist with the exact
text, images and files, and the owner spends a few minutes in the site's own
interface. The design does not use a GUI-driving agent for these: LinkedIn and X
prohibit automated activity outside their APIs, and it would need a standing
signed-in session to the owner's accounts.
