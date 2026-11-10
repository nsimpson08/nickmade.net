# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles (seven: Games, Movies, Music, Photography, Library, Play, Extras)
- The header on every page (Games, Movies, Music, Photography, Library | Play, Extras) is written into each page's HTML.
  In owner mode `assets/js/footer.js` puts "Owner mode · Log out" beside the NickMade wordmark (on Home, floating top
  left); `?logout` on any page signs out
- `extras/`: the Extras page (Golf, Golf weather and the Scorecard; edit the HTML directly)
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
  copies and the smaller versions are too big for GitHub Pages, so the script uploads both to Cloudflare R2 (bucket
  `nickmade-photos`, served at photos.nickmade.net; the smaller ones under `sizes/`) with wrangler instead of
  committing them. Only the wall thumbnails (`photography/thumbs/`) stay in the repo. Sections, the Instagram username and the
  R2 address are set in `photography/config.js`. The page opens in a slideshow (one big photo, thumbnails beside it);
  1, 2 and 4 columns are in the layout toggle. In owner mode photos can also be added from a phone (to Pixel or Cats)
  or removed (`assets/js/photo-upload.js`; stored by the Worker in R2 and KV, not in this repo); new ones are marked
  Fresh for a week. Links: `/photography/#photo=<file name>` opens a photo, `/photography/#<section>` a section
- `library/`: the Library section (its own colour, red). `library/index.html` is the hub: a video store aisle per shelf
  (Movies, Vinyl, Board games, Books), its count glowing in the aisle's colour and a strip of up to 14
  covers fading off the right (picked by title in `PICKS` first, then the newest; drawn at once from what the browser saw
  last, then checked; an empty shelf shows dim spines and "Shelving soon"), on a dark panel over the poster wall.
  Shelf covers show as 400 px copies (`thumb`, made in the owner's browser and stored by `PUT /collection/<kind>/:id/thumb`;
  used only while `thumbOf` is the cover); the opened card shows the full cover. The hub shares its downloads with the wall,
  and the wall draws at once from the last visit's pictures. The vinyl, book and board game
  shelves (`library/vinyl/`, `books/`, `board-games/`) are all drawn by `assets/js/collection.js` and kept by the
  Worker (`worker/src/collections.js`, KV `collection:<kind>`), added in owner mode by search or barcode/ISBN:
  records from MusicBrainz (track list, running time, genres grouped into broad shelves, a Wikipedia summary, the
  sleeve's back from the Cover Art Archive or Discogs, picked when adding or later on the card, and a Spotify player
  for the album under its About, found through MusicBrainz's link or a Spotify search, with a play button on each
  track the album has), books from Open Library
  (a cover picked from its editions, genre worked out from its subjects, series), board games from BoardGameGeek
  (needs the `BGG_TOKEN` secret: players, play time, complexity, rating, rank). Covers are copied to R2 when added
  (photos.nickmade.net `covers/`); others go through the Worker's `/img` proxy so browsers keep them. Each card opens
  with its own animation (a record slides out of its sleeve, a book closes, a game box turns), the left and right
  arrow keys step through the shelf, and every Library page has the poster wall background. On a record's card,
  clicking the sleeve turns it over to the back and clicking the record takes it out and lays it on the sleeve.
  For the 1.7 release the shelves were filled on localhost and are copied to the live site by
  `python3 tools/push_library.py` (a dry run; `--go` to copy): the records, books and board games with their covers,
  and the Movies picks; it stops rather than leave a cover off, and checks live afterwards ("ALL CHECKED")
  - Records: a pressing MusicBrainz doesn't have is found on Discogs (`DISCOGS_TOKEN`; ids `dg-<release>`), by barcode,
    name, or a pasted discogs.com release link. Discogs limits by address and Cloudflare's shared ones are always over
    it, so answers are kept a week (KV `dgc:<path>`) and, when Discogs refuses the Worker, the owner's browser fetches
    that page from Discogs itself and hands it over (`POST /collection/discogs`; collection.js `dgFetch`). Pressings that match (same album, discs, label, track count, no edition of their own) are one choice, the
    newest US one; versions that differ say how ("10th anniversary, milky clear", "12 tracks"). Owner card: change the
    front or back cover (Apple Music's official artwork, then scans of this pressing, then same-barcode pressings, phone
    photos last), "Upload your own scan" for either side, "Edit pressing and note", and "Read its colour from its
    photos". The record is drawn in its vinyl's colour (solid, see-through, splatter, marble, split) from its pressing's
    words, refined by Workers AI reading its Discogs photos; the words decide see-through and pattern. Missing album
    summaries are looked up on Wikipedia by search (`/collection/vinyl/about`).
  - Board games: each game's name under its box (a "Details" button hides them), filters that combine (Players from-to,
    Best with, Rating, Nick's Picks, and owner-only Unopened, which the public list never carries), sorts
    incl. BGG Rank and Best with (complexity only on the opened card, not the shelf), owner-marked Nick's Pick (the disc library's ribbon), and a How to Play video at the
    bottom of each card (BGG's hot instructional video, `/collection/games/howto`).
  - Each page shows its count big under its title (`.lib-num`, e.g. "89 board games"), counting up when it opens.
  - The movie/game log dialog (`live.js`) closes only with its ×: not a tap outside, Escape or Back.
- Every Workers AI call (Scorecard reader, case reader, record colours) goes through `worker/src/aimeter.js`, shared with
  the owner app: at most 30,000 neurons and 600 calls a day and 600,000 a month in D1 `ai_meter` (nickmade-golf), with an
  off switch on the owner's page. When moving to Workers Paid, uncomment `[limits] cpu_ms` in `worker/wrangler.toml`.
- `library/movies/`: the Movie Library (Library > Movies; `movies/library/` only forwards here), the discs I own (4K, Blu-ray, DVD, VHS), shelved like a video
  store with a Covers / Spines view, format chips (incl. HD = 4K + Blu-ray and SD = DVD + VHS, which Pick for tonight
  follows), and Nick's Pick on the best copy of a film only (owner mode: "Make it a Nick's Pick" on an open case, kept in KV
  `library:picks` via `POST /library/pick`; the Nick's Picks aisle wears an amber ★). `discs.js` was built once from a My Movies app export by `python3 tools/discs.py`
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
- Recently Watched/Played take a short review (up to 280 characters) when logged or edited in owner mode, shown in full
  under the stars. Edit can also change a Recently Watched poster (the same choices as logging; "No Options" when
  there are none). Recently Watched movies also take a private "Watched with": the Worker only ever sends it to the owner
- `tools/pull_all.py`: a full copy of everything the live site keeps outside the repo (the Worker's storage, phone
  photos, the Library's cover images, the Scorecard database) into `backups/`; `--local` also makes localhost match it
  (refused while localhost has Library data that isn't live yet; `--force-local` overrides)
- `tools/thumbs.py`: makes the small WebP copies the poster walls use; run it after adding posters (`photos.py` runs it)
- `changelog/log.js`: the site's version history (newest first). The footer on every page (`assets/js/footer.js`)
  shows the newest version, linking to `/changelog/`; returning visitors see a dot when there's a version they
  haven't seen. Add an entry at the top for each new feature (1.1, 1.2...); new movies/games/photos don't need one
- `assets/js/back-close.js`: on every page, the phone's Back button closes what's open (a photo, a case or card, the
  poster wall) instead of leaving the page
- `robots.txt`: asks AI crawlers (GPTBot, CCBot, Google-Extended...) to stay out; search engines are still allowed
- `assets/gifs/`: the home tiles' looping videos (`<name>.mp4` + `<name>.jpg` poster), one script each sharing
  `cliplib.py`: `python3 assets/gifs/make_<name>_clip.py <work folder>` (needs Pillow and ffmpeg). Library's is drawn
  (`make_library_clip.py`); Extras' records the real Golf and Golf weather pages first (`node record_extras.js <work>`).
  Bump the `?v=` date on the tile in `index.html` after re-rendering one

Every date and time on the site and in the Worker is Central (America/Chicago, daylight saving included): a bare date
(YYYY-MM-DD) is shown as written, a timestamp in Central. Only the Workers AI daily counters stay on UTC.

Preview locally with `python3 -m http.server` and open http://localhost:8000.
