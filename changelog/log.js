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
// When to bump: 1.1, 1.2... for new features or sections; 2.0 for a big redesign.
// New movies, games, or photos don't need a version (that's content; the home Lately strip covers it).
window.CHANGELOG = [
  {
    version: "1.1",
    date: "2026-10-01",
    title: "Say why",
    changes: [
      { page: "movies", text: "When you suggest a movie for my queue, you can add a short note on why I should watch it. Show it on the card under your name, or keep it just between us." },
      { page: "games", text: "Same for games: tell me why I should play the one you suggest, publicly or just to me." },
      { page: "site", text: "Made a mistake? You can now edit or remove the movies and games you've suggested (from the same browser). Removing one gives you the spot back." },
      { page: "games", text: "Once I start playing something from the queue, it comes off the queue on its own." },
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
