# connorvanscyoc.com

Things I've counted, mapped or drawn.

- `public/` is the website. Everything in it is served as-is.
- `public/index.html` is the home page; the project list is near the bottom of the file.
- `public/counties/` is the county map. To update it, export both maps from mapchart.net and replace `public/counties/data/mapchart-visited.txt` and `public/counties/data/mapchart-slept.txt`.

Every change saved to the `main` branch goes live automatically through Cloudflare.

## Banana counter

- `public/bananas/` is the banana counter app. `src/worker.js` handles `/api/bananas`, which stores the log in the `bananas` KV namespace.
- Only a device holding `BANANA_KEY` (a secret set in the Cloudflare dashboard) can add entries. Everyone else sees the counter view-only.
- The previous log is backed up once a day to `backup:YYYY-MM-DD` keys in the same namespace, kept for 120 days.
