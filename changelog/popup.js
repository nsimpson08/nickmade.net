// The "What's new" pop-up (assets/js/whats-new.js): everything it says, written separately from the changelog
// (Nick, 2026-10-15). A returning visitor whose last-seen version (footer.js's nm-seen-version) is older than
// `version` sees it once, on the first page they land on. For a new release: change `version` and the text.
//
// page   the item's tag (its colour, like the changelog's): "site", "home", "games", "movies", "music",
//        "photography", "library", "play", "extras"
// link   where the item's link goes; cta: the link's words (leave out cta for no link); gold: true for a link in
//        moving gold instead of the tag's colour
// intro, more: leave "" to leave them out
window.WHATS_NEW = {
  version: "1.7",
  kicker: "New since your last visit",
  title: "Ver 1.7: Library",
  intro: "A new section for everything I collect on physical media.",
  items: [
    { page: "library", link: "/library/", cta: "Browse the Library", text: "Library: my movies, vinyl, books and board games, each on its own shelf. Physical. Media. Forever." },
    { page: "library", link: "/library/vinyl/", cta: "Pull out a record", text: "Vinyl: slide a record out of its sleeve, turn it over for the back, and play the album on Spotify from its track list." },
    { page: "library", link: "/library/movies/", cta: "Open the shelf", text: "Movies: my disc library moved into Library, now with HD and SD filters, taglines, and the DVDs and VHS tapes filled in." },
  ],
  more: "Full changelog", // a button to /changelog/
  ok: "Got it",
};
