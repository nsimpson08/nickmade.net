# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `projects/`: the Extras page (hobbies, projects, and lists; edit the HTML directly)
- `games/list.js`, `movies/list.js`: favorite games and movies with reviews; the format is described at the top of each file
- `games/posters/`, `movies/posters/`: poster art
- `music/playlist.js`: the Spotify playlists shown on the Music page
- `worker/`: Cloudflare Worker (api.nickmade.net) behind the live sections: title search, poster lookup,
  the "In the Queue" suggestions and limits and Recently Watched/Played on Movies and Games, and owner additions
- `assets/js/live.js`: the live sections on the Movies and Games pages. In owner mode (`?admin`, then the admin
  password) the owner can add movies/games to any section marked `live: "key"` in list.js, log Recently
  Watched movies / Recently Played games with a date and rating, and remove site additions. Visitors can suggest
  movies and games for each page's In the Queue. On Games, "Get latest from Xbox" lists recently played
  Xbox games (via [OpenXBL](https://xbl.io)) to add with their playtime, achievement progress, and last played date. These are stored by the Worker, not in this repo.
- `projects/rapture/`: the built Rapture: ADAM & Dice game (one self-contained file). Its source is a separate project;
  don't edit this copy, publish a new build from the game's folder with `npm run publish:site`
- `projects/golf/`: the Golf page (Extras). Rounds and bag in `scores.js`; Trackman rounds are imported into `trackman.js`
  (and course photos into `courses/`) by `python3 tools/import_trackman.py`, from the round cards' HTML copied off Trackman's site
- `tools/pull_live.py`: copies site additions into list.js and posters/ (then commit and push); run it again
  after pushing to clear the now-duplicate live copies. Also saves a snapshot to `backups/`.
- `photography/`: the Photography page. Drop photos into `photography/originals/` (not published),
  then run `python3 tools/photos.py` to make metadata-free full-resolution copies, smaller versions,
  and `photography/photos.js`. Set your Instagram username in `photography/config.js`.
- `assets/gifs/`: home tile GIFs. `python3 assets/gifs/make_gifs.py assets/gifs [name...]` regenerates them (needs Pillow); e.g. `... assets/gifs extras` redoes just the Extras one

Preview locally with `python3 -m http.server` and open http://localhost:8000.
