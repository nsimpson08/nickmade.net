# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `extras/`: the Extras page (hobbies, projects, and lists; edit the HTML directly)
- `games/list.js`, `movies/list.js`: favorite games and movies with reviews; the format is described at the top of each file
- `games/posters/`, `movies/posters/`: poster art
- `music/playlist.js`: the Spotify playlists shown on the Music page
- `worker/`: Cloudflare Worker (api.nickmade.net) behind the live sections: title search, poster lookup,
  the "In the Queue" suggestions and limits and Recently Watched/Played on Movies and Games, and owner additions
- `assets/js/live.js`: the live sections on the Movies and Games pages. In owner mode (`?admin`, then the admin
  password) the owner can add movies/games to any section marked `live: "key"` in list.js, log Recently
  Watched movies / Recently Played games with a date and rating, and remove site additions. Visitors can suggest
  movies and games for each page's In the Queue. On Games, "Get latest from Xbox" lists recently played
  Xbox games (via [OpenXBL](https://xbl.io)) to add with their playtime, achievement progress, and last played date.
  Every night at midnight Central the Worker refreshes those games' last played date, achievements, and playtime. These are stored by the Worker, not in this repo.
- `extras/rapture/`: the built Rapture: ADAM & Dice game (one self-contained file). Its source is a separate project;
  don't edit this copy, publish a new build from the game's folder with `npm run publish:site`
- `extras/golf-game/`: the built Nick's Nine golf game (one self-contained file). Its source is a separate project
  (`../Golf Game`); don't edit this copy, publish a new build from the game's folder with `npm run publish:site`.
  It reads `extras/golf/scores.js` and `trackman.js` at runtime, so new rounds and stats change the game with no rebuild
- `extras/golf/`: the Golf page (Extras). Rounds and bag in `scores.js`; Trackman rounds are imported into `trackman.js`
  (and course photos into `courses/`) by `python3 tools/import_trackman.py`, from the round cards' HTML copied off Trackman's site
- Recently Watched/Played show the newest 12; older ones are listed by the Archive link under them. The favorites/best
  sections have no limit: in owner mode each item has Remove (hidden on the site, deleted from list.js by pull_live.py)
- `tools/pull_live.py`: copies site additions into list.js and posters/ (then commit and push); run it again
  after pushing to clear the now-duplicate live copies. Also saves a snapshot to `backups/`.
- `photography/`: the Photography page, in sections (Film, Pixel, Cats). Drop photos into the section's folder,
  `photography/originals/<film|pixel|cats>/` (not published), then run `python3 tools/photos.py`. It makes
  metadata-free copies (location, camera data and phones' hidden extra images removed; only an artist and
  copyright tag added), smaller versions in `photography/sizes/`, and `photography/photos.js`. The full-resolution
  copies are too big for GitHub Pages, so the script uploads them to Cloudflare R2 (bucket `nickmade-photos`,
  served at photos.nickmade.net) with wrangler instead of committing them. Sections, the featured photo, the
  Instagram username and the R2 address are set in `photography/config.js`
- `changelog/log.js`: the site's version history (newest first). The footer on every page (`assets/js/footer.js`)
  shows the newest version, linking to `/changelog/`; returning visitors see a dot when there's a version they
  haven't seen. Add an entry at the top for each new feature (1.1, 1.2...); new movies/games/photos don't need one
- `robots.txt`: asks AI crawlers (GPTBot, CCBot, Google-Extended...) to stay out; search engines are still allowed
- `assets/gifs/`: home tile GIFs. `python3 assets/gifs/make_gifs.py assets/gifs [name...]` regenerates them (needs Pillow); e.g. `... assets/gifs extras` redoes just the Extras one

Preview locally with `python3 -m http.server` and open http://localhost:8000.
