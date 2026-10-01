// Photography page settings.
//   instagram  your Instagram username (without the @); leave "" to hide the link
//   sections   the page's sections, top to bottom. Each one's photos go in photography/originals/<folder>/;
//              tools/photos.py reads this list too (and makes any missing folders). A section with no photos is hidden.
//   fullUrl    where the full-resolution copies live: Cloudflare R2 (bucket nickmade-photos), since they're too
//              big for GitHub Pages. tools/photos.py uploads them there. Leave "" to serve them from photography/full/
//   featured   the photo in the gilded frame at the top: its original's file name without the extension, e.g.
//              "Olympus Collection" or "R26-K400-07". Leave "" to feature the newest photo
window.PHOTO_CONFIG = {
  instagram: "olympuslover1",
  featured: "Olympus Collection",
  fullUrl: "https://photos.nickmade.net/",
  sections: [
    { folder: "film", title: "Film" },
    { folder: "pixel", title: "Pixel" },
    { folder: "cats", title: "Cats" }
  ]
};
