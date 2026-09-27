// My video games, grouped into subsections shown top to bottom.
//
// Each subsection has:
//   title    the subsection header
//   layout   "reviews" (poster with review beside it) or "grid" (posters with titles underneath)
//   items    the games, in the order you want them shown
//
// Game fields:
//   title    required
//   year     release year
//   details  studio, platform, whatever you like             (reviews layout)
//   rating   out of 10, leave out to hide                    (reviews layout)
//   review   your review; a blank line starts a new paragraph (reviews layout)
//   image    poster art: a file in games/posters/ (e.g. "posters/outer-wilds.jpg") or a full URL
//   credit   the artist, when the art came from the web: { artist: "Name", url: "https://..." }
//            for official art add label: "Official art from" (shown instead of "Art by")
//   song     a 30-second Apple Music preview with a play button (grid layout):
//            { id: 1134673053, title: "Song", artist: "Artist" }
//            id is the number after ?i= in the song's Apple Music link
//            add cover: true when it isn't the original recording (shows "Cover by ...")
//
// A grid game only needs a title, and ideally year, image, and credit:
//   { title: "Game Title", year: 2020, image: "posters/game-title.jpg", credit: { artist: "Name", url: "https://..." } },

window.SECTIONS = [
  {
    title: "All Time Favorites",
    layout: "reviews",
    items: [
      {
        title: "BioShock",
        year: 2007,
        details: "Irrational Games",
        image: "posters/bioshock.jpg",
        credit: { artist: "Felix Tindall", url: "https://posterspy.com/profile/felixtindall" },
        review: ""
      },
      {
        title: "Outer Wilds",
        year: 2019,
        details: "Mobius Digital",
        image: "posters/outer-wilds.jpg",
        credit: { artist: "Jeff Langevin", url: "https://www.jefflangevin.com/" },
        review: ""
      },
      {
        title: "Kingdom Hearts",
        year: 2002,
        details: "Square",
        image: "posters/kingdom-hearts.jpg",
        credit: { artist: "TheKHRP", url: "https://www.deviantart.com/thekhrp/art/Nomura-Tribute-793571299" },
        review: ""
      },
      {
        title: "Subnautica",
        year: 2018,
        details: "Unknown Worlds",
        image: "posters/subnautica.jpg",
        credit: { label: "Official art from", artist: "Unknown Worlds", url: "https://store.steampowered.com/app/264710/" },
        review: ""
      },
      {
        title: "Rocket League",
        year: 2015,
        details: "Psyonix",
        image: "posters/rocket-league.jpg",
        credit: { label: "Official art from", artist: "Psyonix", url: "https://store.steampowered.com/app/252950/" },
        review: ""
      },
      {
        title: "Guitar Hero III: Legends of Rock",
        year: 2007,
        details: "Neversoft",
        image: "posters/guitar-hero-iii.jpg",
        credit: { label: "Official art from", artist: "Activision" },
        review: ""
      }
    ]
  },
  {
    title: "Best Soundtracks",
    layout: "grid",
    items: [
      {
        title: "Hotline Miami", year: 2012, image: "posters/hotline-miami.jpg", credit: { artist: "Mbdsgns", url: "https://posterspy.com/profile/mbdsgns" },
        song: { id: 1134673053, title: "Hotline", artist: "Jasper Byrne" }
      },
      {
        title: "Clair Obscur: Expedition 33", year: 2025, image: "posters/clair-obscur-expedition-33.jpg", credit: { artist: "Felix Tindall", url: "https://posterspy.com/profile/felixtindall" },
        song: { id: 1808472864, title: "Lumière", artist: "Lorien Testard & Alice Duport-Percier" }
      },
      {
        title: "The Legend of Zelda: Ocarina of Time", year: 1998, image: "posters/zelda-ocarina-of-time.jpg", credit: { artist: "Estevan Silveira", url: "https://posterspy.com/profile/estevansilveira" },
        song: { id: 1591041759, title: "Title Theme", artist: "Masters of Sound", cover: true }
      },
      {
        title: "Minecraft", year: 2011, image: "posters/minecraft.jpg", credit: { artist: "edwardjmoran", url: "https://posterspy.com/profile/edwardjmoran" },
        song: { id: 1867885632, title: "Sweden", artist: "C418" }
      },
      {
        title: "Assassin's Creed II", year: 2009, image: "posters/assassins-creed-ii.jpg", credit: { artist: "Koke Núñez", url: "https://posterspy.com/profile/koke" },
        song: { id: 1640108517, title: "Ezio's Family", artist: "Jesper Kyd" }
      }
    ]
  },
  {
    title: "Best Horror",
    layout: "grid",
    items: [
      { title: "Dead Space", year: 2008, image: "posters/dead-space.jpg", credit: { artist: "Estevan Silveira", url: "https://posterspy.com/profile/estevansilveira" } },
      { title: "ROUTINE", year: 2025, image: "posters/routine.jpg", credit: { label: "Official art from", artist: "Lunar Software", url: "https://store.steampowered.com/app/606160/" } },
      { title: "The Evil Within", year: 2014, image: "posters/the-evil-within.jpg", credit: { label: "Official art from", artist: "Tango Gameworks", url: "https://store.steampowered.com/app/268050/" } },
      { title: "Resident Evil 7: Biohazard", year: 2017, image: "posters/resident-evil-7.jpg", credit: { artist: "DComp", url: "https://posterspy.com/profile/dcomp" } },
      { title: "F.E.A.R. 2: Project Origin", year: 2009, image: "posters/fear-2.jpg", credit: { label: "Official art from", artist: "Monolith Productions", url: "https://store.steampowered.com/app/16450/" } }
    ]
  },
  {
    title: "Best Indie",
    layout: "grid",
    items: [
      { title: "Void Bastards", year: 2019, image: "posters/void-bastards.jpg", credit: { label: "Official art from", artist: "Blue Manchu", url: "https://store.steampowered.com/app/857980/" } }
    ]
  }
];
