// My video games, grouped into subsections shown top to bottom.
//
// Each subsection has:
//   title    the subsection header
//   layout   "reviews" (poster with review beside it) or "grid" (posters with titles underneath)
//   subtitle optional small text beside the header
//   group    optional: consecutive sections with the same group are shown together under that label.
//            On a group's first section, groupNote adds a line of text and groupStyle: "panel" gives it a raised box.
//   live     optional: a short fixed key like "horror" lets you add more from the site in owner mode (?admin).
//            Two keys are special: "queue" (In the Queue: visitors can suggest, 3 each, 20 total)
//            and "watched" (Recently Played: dated and rated, newest first).
//            Those additions are stored in Cloudflare, not here; run tools/pull_live.py to copy them into this file.
//            Don't change a key once set (the title can change freely).
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
//            for official art (no fan art found) use credit: { official: true }, shown as "Official poster" with no link
//   song     a 30-second Apple Music preview with a play button (grid layout):
//            { id: 1134673053, title: "Song", artist: "Artist" }
//            id is the number after ?i= in the song's Apple Music link
//            add cover: true when it isn't the original recording (shows "Cover by ...")
//
// A grid game only needs a title, and ideally year, image, and credit:
//   { title: "Game Title", year: 2020, image: "posters/game-title.jpg", credit: { artist: "Name", url: "https://..." } },

window.SECTIONS = [
  {
    // Filled in from the site in owner mode (?admin): pick a game, the date you played it, and a rating
    group: "Lately",
    groupNote: "What I just played, and what's up next",
    groupStyle: "panel",
    live: "watched",
    title: "Recently Played",
    subtitle: "",
    layout: "grid",
    items: []
  },
  {
    // Visitors can suggest games here (3 each, 20 total including these); yours from the site go in too
    group: "Lately",
    live: "queue",
    title: "In the Queue",
    layout: "grid",
    items: [
      { title: "Grand Theft Auto VI", year: 2026, image: "posters/grand-theft-auto-vi.jpg", credit: { artist: "Rahalarts", url: "https://posterspy.com/profile/rahalarts" } },
      { title: "Gears of War: E-Day", year: 2026, image: "posters/gears-of-war-e-day.jpg", credit: { artist: "Fakoori", url: "https://posterspy.com/profile/fakoori" } },
      { title: "Well Dweller", year: 2026, image: "posters/well-dweller.jpg", credit: { official: true } },
      { title: "Kingdom Come: Deliverance", year: 2018, image: "posters/kingdom-come-deliverance.jpg", credit: { official: true } }
    ]
  },
  {
    group: "Favorites",
    groupNote: "",
    groupStyle: "panel",
    title: "All Time Favorites",
    layout: "grid",
    items: [
      { title: "BioShock", year: 2007, image: "posters/bioshock.jpg", credit: { artist: "Felix Tindall", url: "https://posterspy.com/profile/felixtindall" } },
      { title: "Outer Wilds", year: 2019, image: "posters/outer-wilds.jpg", credit: { artist: "Jeff Langevin", url: "https://www.jefflangevin.com/" } },
      { title: "Kingdom Hearts", year: 2002, image: "posters/kingdom-hearts.jpg", credit: { artist: "TheKHRP", url: "https://www.deviantart.com/thekhrp/art/Nomura-Tribute-793571299" } },
      { title: "Subnautica", year: 2018, image: "posters/subnautica.jpg", credit: { official: true } },
      { title: "Rocket League", year: 2015, image: "posters/rocket-league.jpg", credit: { official: true } },
      { title: "The Witcher 3: Wild Hunt", year: 2015, image: "posters/the-witcher-3.jpg", credit: { artist: "Joe Cosentino", url: "https://posterspy.com/profile/joecosentinodesign/" } },
      { title: "Red Dead Redemption 2", year: 2018, image: "posters/red-dead-redemption-2.jpg", credit: { artist: "edwardjmoran", url: "https://posterspy.com/profile/edwardjmoran" } },
      { title: "Super Mario World 2: Yoshi's Island", year: 1995, image: "posters/yoshis-island.jpg", credit: { official: true } },
      { title: "Shadow of the Colossus", year: 2005, image: "posters/shadow-of-the-colossus.jpg", credit: { artist: "Koke Núñez", url: "https://posterspy.com/profile/koke" } },
      { title: "Super Smash Bros.", year: 1999, image: "posters/super-smash-bros.jpg", credit: { artist: "VGAfanatic", url: "https://www.deviantart.com/vgafanatic/art/Super-Smash-Bros-64-Anniversary-Print-1149939180" } },
      { title: "Portal", year: 2007, image: "posters/portal.jpg", credit: { artist: "therealbobmayo", url: "https://posterspy.com/profile/therealbobmayo" } },
      { title: "Final Fantasy X", year: 2001, image: "posters/final-fantasy-x.jpg", credit: { official: true } }
    ]
  },
  {
    group: "Favorites",
    live: "soundtracks",
    title: "Best Soundtracks",
    layout: "grid",
    items: [
      {
        title: "Mirror's Edge", year: 2008, image: "posters/mirrors-edge.jpg", credit: { artist: "nrwirth65", url: "https://posterspy.com/profile/nrwirth65" },
        song: { id: 1579465849, title: "Still Alive (Idun Sessions)", artist: "Lisa Miskovsky" }
      },
      {
        title: "Final Fantasy X", year: 2001, image: "posters/final-fantasy-x.jpg", credit: { official: true },
        song: { id: 62444655, title: "Zanarkand", artist: "Nobuo Uematsu" }
      },
      {
        title: "Final Fantasy VII", year: 1997, image: "posters/final-fantasy-vii.jpg", credit: { artist: "viet-anh_cao", url: "https://posterspy.com/profile/viet-anh_cao" },
        song: { id: 61018643, title: "One-Winged Angel", artist: "Nobuo Uematsu" }
      },
      {
        title: "The Last of Us", year: 2013, image: "posters/the-last-of-us.jpg", credit: { artist: "bruno-illustra", url: "https://posterspy.com/profile/bruno-illustra" },
        song: { id: 655118443, title: "The Last of Us", artist: "Gustavo Santaolalla" }
      },
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
      },
      {
        title: "Halo 3: ODST", year: 2009, image: "posters/halo-3-odst.jpg", credit: { artist: "Noble-6 Design", url: "https://posterspy.com/profile/noble-6/" },
        song: { id: 1682503376, title: "Deference for Darkness", artist: "Martin O'Donnell & Michael Salvatori" }
      }
    ]
  },
  {
    group: "Favorites",
    live: "horror",
    title: "Best Horror",
    layout: "grid",
    items: [
      { title: "Dead Space", year: 2008, image: "posters/dead-space.jpg", credit: { artist: "Estevan Silveira", url: "https://posterspy.com/profile/estevansilveira" } },
      { title: "ROUTINE", year: 2025, image: "posters/routine.jpg", credit: { official: true } },
      { title: "The Evil Within", year: 2014, image: "posters/the-evil-within.jpg", credit: { official: true } },
      { title: "Resident Evil 7: Biohazard", year: 2017, image: "posters/resident-evil-7.jpg", credit: { artist: "DComp", url: "https://posterspy.com/profile/dcomp" } },
      { title: "F.E.A.R. 2: Project Origin", year: 2009, image: "posters/fear-2.jpg", credit: { official: true } },
      { title: "Signalis", year: 2022, image: "posters/signalis.jpg", credit: { artist: "Ray-Ana", url: "https://www.deviantart.com/ray-ana/art/Signalis-Poster-941068347" } },
      { title: "SOMA", year: 2015, image: "posters/soma.jpg", credit: { official: true } },
      { title: "Alien: Isolation", year: 2014, image: "posters/alien-isolation.jpg", credit: { artist: "edwardjmoran", url: "https://posterspy.com/profile/edwardjmoran" } },
      { title: "Arizona Sunshine 2", year: 2023, image: "posters/arizona-sunshine-2.jpg", credit: { official: true } }
    ]
  },
  {
    group: "Favorites",
    live: "indie",
    title: "Best Indie",
    layout: "grid",
    items: [
      { title: "Void Bastards", year: 2019, image: "posters/void-bastards.jpg", credit: { official: true } },
      { title: "Cocoon", year: 2023, image: "posters/cocoon.jpg", credit: { official: true } },
      { title: "Raft", year: 2022, image: "posters/raft.jpg", credit: { official: true } },
      { title: "Firewatch", year: 2016, image: "posters/firewatch.jpg", credit: { official: true } },
      { title: "Superliminal", year: 2019, image: "posters/superliminal.jpg", credit: { official: true } },
      { title: "Inscryption", year: 2021, image: "posters/inscryption.jpg", credit: { official: true } },
      { title: "Quern - Undying Thoughts", year: 2016, image: "posters/quern.jpg", credit: { official: true } }
    ]
  }
];
