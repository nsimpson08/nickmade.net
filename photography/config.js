// Photography page settings.
//   instagram  your Instagram username (without the @); leave "" to hide the link
//   sections   the page's sections, top to bottom. Each one's photos go in photography/originals/<folder>/;
//              tools/photos.py reads this list too (and makes any missing folders). A section with no photos is hidden.
//   fullUrl    where the full-resolution copies live: Cloudflare R2 (bucket nickmade-photos), since they're too
//              big for GitHub Pages. tools/photos.py uploads them there. Leave "" to serve them from photography/full/
window.PHOTO_CONFIG = {
  instagram: "olympuslover1",
  fullUrl: "https://photos.nickmade.net/",
  sections: [
    { folder: "film", title: "Film" },
    { folder: "pixel", title: "Pixel" },
    { folder: "cats", title: "Cats" }
  ]
};
