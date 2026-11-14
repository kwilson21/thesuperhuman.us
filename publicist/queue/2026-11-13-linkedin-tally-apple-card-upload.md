---
id: tally-apple-card-upload-li
source: tally-apple-card-upload
platform: linkedin
slot: 2026-11-13T09:30-05:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-apple-card-upload
media: publicist/media/tally-apple-card-upload.mp4
media_gif: publicist/media/tally-apple-card-upload.gif
alt: On Tally's demo, on a phone: Accounts, Add Apple Card, then a sheet that says the demo uses a sample file. Add the sample adds 13 made-up transactions and an Apple Card balance to the list.
status: draft
---
Plaid can't reach Apple Card from a web app, so Tally takes the file instead.

In the clip, on Tally's demo: Accounts, Add Apple Card, and a made-up sample file in place of a real export.

Every other bank comes into Tally through Plaid. For Apple Card, Accounts now takes the CSV that Apple exports from Wallet or its card website.

The rules:
Tally adds only the transactions it doesn't already have, so uploading the same file twice adds nothing.
One unreadable row means nothing is added.
Paying off the card, or a payment that bounced, is left out, so it never counts as spending.
An optional balance puts the card in net worth.

New rows are sorted the way a bank sync's are. Claude Code built it to my design, and I reviewed it. Built and tested.
