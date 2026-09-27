# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `projects/`: project list (edit the HTML directly)
- `games/list.js`, `movies/list.js`: favorite games and movies with reviews; the format is described at the top of each file
- `games/posters/`, `movies/posters/`: poster art
- `music/playlist.js`: the Spotify playlists shown on the Music page
- `worker/`: Cloudflare Worker (api.nickmade.net) behind the live sections: title search, poster lookup,
  the "In the Queue" suggestions and limits and Recently Watched/Played on Movies and Games, and owner additions
- `assets/js/live.js`: the live sections on the Movies and Games pages. In owner mode (`?admin`, then the admin
  password) the owner can add movies/games to any section marked `live: "key"` in list.js, log Recently
  Watched movies / Recently Played games with a date and rating, and remove site additions. Visitors can suggest
  movies and games for each page's In the Queue. These are stored by the Worker, not in this repo.
- `tools/pull_live.py`: copies site additions into list.js and posters/ (then commit and push); run it again
  after pushing to clear the now-duplicate live copies. Also saves a snapshot to `backups/`.
- `photography/`: the Photography page. Drop photos into `photography/originals/` (not published),
  then run `python3 tools/photos.py` to make metadata-free full-resolution copies, smaller versions,
  and `photography/photos.js`. Set your Instagram username in `photography/config.js`.
- `assets/gifs/`: home tile GIFs (`make_gifs.py` regenerates them; needs Pillow)

Preview locally with `python3 -m http.server` and open http://localhost:8000.
