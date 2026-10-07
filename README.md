# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `extras/`: the Extras page (Golf and the Video Game Montage Maker; edit the HTML directly)
- `play/`: the Play page (the games). The games themselves still live at `extras/golf-game/` and `extras/rapture/`,
  where their publish scripts put them; gameplay clips for the cards are in `play/wall/`
- `play/office/`: Nick's Office, an interactive pixel-art copy of my office (Play). One canvas drawn entirely in code by
  `office.js` (no image files): the room is boxes in an isometric view, turned with the arrows or a drag, zoomed with
  the wheel, a trackpad pinch, or the button. Things in it are clickable, with their own sounds (WebAudio) and links
  around the site; some show live data from the Worker (the latest movie's title and TMDB stills on the Magnavox, the
  latest song's Apple Music preview on the speaker, the gamerscore on the TV)
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
  Every 4 hours the Worker refreshes those games' last played date, achievements, and playtime, and the Games page's
  gamerscore banner (its gains over the last day, week and month update once a day, at midnight Central). In owner
  mode, Refresh in Recently Played does it on demand. These are stored by the Worker, not in this repo.
- `extras/rapture/`: the built Rapture: ADAM & Dice game (one self-contained file). Its source is a separate project;
  don't edit this copy, publish a new build from the game's folder with `npm run publish:site`
- `extras/golf-game/`: the built Nick's Nine golf game (one self-contained file). Its source is a separate project
  (`../Golf Game`); don't edit this copy, publish a new build from the game's folder with `npm run publish:site`.
  It reads `extras/golf/scores.js` and `trackman.js` at runtime, so new rounds and stats change the game with no rebuild
- `extras/golf/`: the Golf page (Extras). Rounds and bag in `scores.js`; Trackman rounds are imported into `trackman.js`
  (and course photos into `courses/`) by `python3 tools/import_trackman.py`, from the round cards' HTML copied off Trackman's site
- Recently Watched/Played keep the newest 8; older ones are listed by the Archive link under them. Poster grids (all but
  In the Queue) show 8 at a time, 6 on phones, with an Expand button. The favorites/best sections have no limit: in
  owner mode each item has Remove (hidden on the site, deleted from list.js by pull_live.py)
- `tools/pull_live.py`: copies site additions into list.js and posters/ (then commit and push); run it again
  after pushing to clear the now-duplicate live copies. Also saves a snapshot to `backups/`.
- `photography/`: the Photography page, in sections (Film, Pixel, Cats). Drop photos into the section's folder,
  `photography/originals/<film|pixel|cats>/` (not published), then run `python3 tools/photos.py`. It makes
  metadata-free copies (location, camera data and phones' hidden extra images removed; only an artist and
  copyright tag added), smaller versions in `photography/sizes/`, and `photography/photos.js`. The full-resolution
  copies are too big for GitHub Pages, so the script uploads them to Cloudflare R2 (bucket `nickmade-photos`,
  served at photos.nickmade.net) with wrangler instead of committing them. Sections, the Instagram username and the
  R2 address are set in `photography/config.js`. The page opens in a slideshow (one big photo, thumbnails beside it);
  1, 2 and 4 columns are in the layout toggle. In owner mode photos can also be added from a phone (to Pixel or Cats)
  or removed (`assets/js/photo-upload.js`; stored by the Worker in R2 and KV, not in this repo); new ones are marked
  Fresh for a week. Links: `/photography/#photo=<file name>` opens a photo, `/photography/#<section>` a section
- `movies/library/`: the Library page (Movies > Library), the discs I own (4K, Blu-ray, DVD, VHS), shelved like a video
  store with a Covers / Spines view. `discs.js` was built once from a My Movies app export by `python3 tools/discs.py`
  (the export itself isn't committed); new discs are added in owner mode (search, or scan the barcode) and stored by
  the Worker, with details and cover from TMDB, the synopsis from Wikipedia, and the extras from TheDiscDb or typed in.
  `covers/` are the case covers; `logos/` are the spines' title logos from TMDB (needs a free `TMDB_API_KEY`, in
  `worker/.dev.vars` and the Worker's secrets). 4K discs' HDR (Dolby Vision, HDR10+, HDR10) is in `hdr.json`, looked up
  on blu-ray.com by `python3 tools/hdr.py` (site adds look it up themselves). Each case can play the film's official
  trailer (`assets/js/trailer.js`, YouTube's embedded player, from TMDB)
- `assets/js/film-dialog.js`: on the Movies page, every poster (and every Recently Watched Archive row) opens a card
  like a Library case: tagline, synopsis, cast, IMDb, the trailer, and my rating and short review. The Worker looks the
  film up on TMDB (`/library/film`). Links: `/movies/#the-big-lebowski` jumps to a review, `/movies/#film=<IMDb id>`
  opens a film's card
- Recently Watched/Played take a short review (up to 280 characters) when logged or edited in owner mode, shown under
  the stars. Recently Watched movies also take a private "Watched with": the Worker only ever sends it to the owner
- `tools/thumbs.py`: makes the small WebP copies the poster walls use; run it after adding posters (`photos.py` runs it)
- `changelog/log.js`: the site's version history (newest first). The footer on every page (`assets/js/footer.js`)
  shows the newest version, linking to `/changelog/`; returning visitors see a dot when there's a version they
  haven't seen. Add an entry at the top for each new feature (1.1, 1.2...); new movies/games/photos don't need one
- `assets/js/back-close.js`: on every page, the phone's Back button closes what's open (a photo, a case or card, the
  poster wall) instead of leaving the page
- `robots.txt`: asks AI crawlers (GPTBot, CCBot, Google-Extended...) to stay out; search engines are still allowed
- `assets/gifs/`: home tile GIFs. `python3 assets/gifs/make_gifs.py assets/gifs [name...]` regenerates them (needs Pillow); e.g. `... assets/gifs extras` redoes just the Extras one

Preview locally with `python3 -m http.server` and open http://localhost:8000.
