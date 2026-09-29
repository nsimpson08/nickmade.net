// Playlists shown on the Music page, top to bottom.
//
//   title        header above the player
//   description  paragraph under the header (leave "" for none)
//   url          Spotify share link: playlist ... menu > Share > Copy link to playlist
//   group        optional: consecutive playlists with the same group are shown together under that label.
//                On a group's first playlist, groupNote adds a line of text and groupStyle: "panel" gives it a raised box.
window.PLAYLISTS = [
  {
    // Paste the playlist's Spotify link into url (and set the title and description); until then it says "Playlist coming soon."
    group: "Lately",
    groupNote: "What I've been listening to",
    groupStyle: "panel",
    title: "",
    description: "",
    url: "https://open.spotify.com/playlist/19F54mBzCryNrrLIOGFY5Q?si=4f607253cb434b81"
  },
  {
    title: "Best of the Best",
    description: "This playlist was both extremely easy and extremely difficult to make. I believe everyone should take the time to make their own. It's personal; It's a journey.",
    url: "https://open.spotify.com/playlist/0bVbAc35F1ojkJyAofCAZZ?si=3e0883bc67144326"
  },
  {
    title: "Coding/Chores/Focus",
    description: "My latest obsession of 2026. Lyricless hype music. From the title you can tell this is nostalgic of 2000's Racing Game music. Apparently it's also called Atmospheric Drum & Bass. Although this can be easily found on some kind of 24/7 YouTube Live channel, this playlist is curated of favorites. And you know who's a difficult artist to search for? 'Thing'",
    url: "https://open.spotify.com/playlist/3CLltogSU1Z2uMWt0OJhU0?si=8aeeaef4423e42a0&pt=482f2081240249561c3c3f327fd95bcc"
  }
];
