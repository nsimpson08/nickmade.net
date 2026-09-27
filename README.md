# nickmade.net

Personal site, served by GitHub Pages from the root of `main`. Plain HTML, no build step.

- `index.html`: home page with the section tiles
- `projects/`: project list (edit the HTML directly)
- `games/list.js`, `movies/list.js`: favorite games and movies with reviews; the format is described at the top of each file
- `games/posters/`, `movies/posters/`: poster art
- `assets/gifs/`: home tile GIFs (`make_gifs.py` regenerates them; needs Pillow)

Preview locally with `python3 -m http.server` and open http://localhost:8000.
