# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `projects/`: project list (edit the HTML directly)
- `games/list.js`, `movies/list.js`: favorite games and movies with reviews; the format is described at the top of each file
- `games/posters/`, `movies/posters/`: poster art
- `music/playlist.js`: the Spotify playlists shown on the Music page
- `worker/`: Cloudflare Worker behind the Movies "In the Queue" suggestions (title search, poster lookup, limits, storage)
- `photography/`: the Photography page. Drop photos into `photography/originals/` (not published),
  then run `python3 tools/photos.py` to make metadata-free full-resolution copies, smaller versions,
  and `photography/photos.js`. Set your Instagram username in `photography/config.js`.
- `assets/gifs/`: home tile GIFs (`make_gifs.py` regenerates them; needs Pillow)

Preview locally with `python3 -m http.server` and open http://localhost:8000.
