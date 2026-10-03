// The site's version history, newest first. The footer on every page shows the first entry's version, and
// /changelog/ lists them all.
//
// To release a new version, add an entry at the TOP:
//   { version: "1.1", date: "2026-10-15", changes: [
//       { page: "photography", text: "What changed, in a short plain sentence." },
//   ] },
//
// page    which part of the site it's about (gives the line its colored tag):
//         "site", "home", "games", "movies", "music", "photography", or "extras"
//         The changelog page groups a version's lines by page in that order, whatever order they're written in.
// When to bump: 1.1, 1.2... for new features or sections; 2.0 for a big redesign.
// New movies, games, or photos don't need a version (that's content; the home Lately strip covers it).
window.CHANGELOG = [
  {
    version: "1.2",
    date: "2026-10-02",
    title: "Posters and upvotes",
    changes: [
      { page: "site", text: "Vote on what I should watch or play next. The most-voted movies and games move to the front of the queue." },
      { page: "site", text: "Poster wall, top right on every page: every poster, album cover, photo, or game clip in one slowly drifting wall, and on the home page an even mix of all five. Hover for the details, click one to jump to it, or on Music, to play it." },
      { page: "site", text: "Every page now has a slowly drifting poster wall behind it. Prefer plain black? Flip the switch at the top right, and it stays off as you browse." },
      { page: "home", text: "Lately now shows my latest golf round too, from the sim or the course." },
      { page: "games", text: "My Xbox gamerscore up top, with how much I've earned in the last day. Click it to see all my achievements." },
      { page: "music", text: "Send me a song: search Spotify and it goes straight onto my Community Recs playlist. You can play everything people have sent right on the page." }
    ]
  },
  {
    version: "1.1",
    date: "2026-10-01",
    title: "Say why",
    changes: [
      { page: "movies", text: "When you suggest a movie for my queue, you can add a short note on why I should watch it. Show it on the card under your name, or keep it just between us." },
      { page: "games", text: "Same for games: tell me why I should play the one you suggest, publicly or just to me." },
      { page: "site", text: "Made a mistake? You can now edit or remove the movies and games you've suggested (from the same browser). Removing one gives you the spot back." },
      { page: "games", text: "Once I start playing something from the queue, it comes off the queue on its own." },
      { page: "site", text: "Recently Watched and Recently Played show my latest 12. Older ones move to an Archive link underneath, so nothing's lost." },
      { page: "extras", text: "Nick's Nine 1.1: a leaderboard. Finish all 9 holes, type your name, and see how your round stacks up (and whether you beat my ghost)." }
    ]
  },
  {
    version: "1.0",
    date: "2026-09-30",
    title: "Launch",
    changes: [
      { page: "home", text: "A Lately strip under the title: the newest game I've played, the newest movie I've watched with my rating, and what I'm listening to on Spotify right now." },
      { page: "games", text: "Favorites with fan-art posters (All Time, Soundtracks with previews, Horror, Indie), Recently Played synced with my Xbox, and a queue you can suggest games for." },
      { page: "movies", text: "Reviews of my All Time Favorites, Recently Watched with half-star ratings, Comedies, Dramas, Hidden Gems, and a queue you can suggest movies for." },
      { page: "music", text: "Recently Listened, live from my Spotify, with previews you can play, plus my playlists." },
      { page: "photography", text: "Film, Pixel, and Cats, with a featured photo, 1, 2, or 4 columns, and full-resolution downloads." },
      { page: "extras", text: "My golf rounds and score chart, Nick's Nine (a golf game built from my real stats), Rapture: ADAM & Dice, and the Video Game Montage Maker." }
    ]
  }
];
