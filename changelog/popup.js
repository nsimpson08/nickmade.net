// The "What's new" pop-up (assets/js/whats-new.js): everything it says, written separately from the changelog
// (Nick, 2026-10-15). A returning visitor whose last-seen version (footer.js's nm-seen-version) is older than
// `version` sees it once, on the first page they land on. For a new release: change `version` and the text.
//
// page   the item's tag (its colour, like the changelog's): "site", "home", "games", "movies", "music",
//        "photography", "play", "extras"
// link   where the item's link goes; cta: the link's words (leave out cta for no link)
// intro, more: leave "" to leave them out
window.WHATS_NEW = {
  version: "1.6",
  kicker: "New since your last visit",
  title: "Ver 1.6: The Cattery",
  intro: "A new game to come back to, new banners on Games, and golf weather for anywhere in the US.",
  items: [
    { page: "play", link: "/play/cats/", cta: "Make your cat", text: "The Cattery: make your own cat and move it into a room with everyone else’s. Come back to see who it befriended, fought, or fell for." },
    { page: "play", link: "/extras/golf-game/", cta: "Play a round", text: "Nick’s Nine 1.2: slope arrows on the greens, new doglegs and ponds, and real lip-outs." },
    { page: "games", link: "/games/", cta: "See the banners", text: "My PlayStation trophies and Steam achievements now sit next to Xbox." },
    { page: "extras", link: "/extras/golf-weather/", cta: "Check your ZIP", text: "Golf weather: the best times to play this week near any US ZIP code." },
  ],
  more: "Full changelog", // a button to /changelog/
  ok: "Got it",
};
