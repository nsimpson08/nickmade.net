// My movies, grouped into subsections shown top to bottom.
//
// Each subsection has:
//   title    the subsection header
//   subtitle optional small text beside the header
//   live     optional: a short fixed key like "horror" lets you add more from the site in owner mode (?admin).
//            Two keys are special: "queue" (In the Queue: visitors can suggest, 3 each, 20 total)
//            and "watched" (Recently Watched: dated and rated, newest first).
//            Those additions are stored in Cloudflare, not here; run tools/pull_live.py to copy them into this file.
//            Don't change a key once set (the title can change freely).
//   group    optional: consecutive sections with the same group are shown together under that label.
//            On a group's first section, groupNote adds a line of text and groupStyle: "panel" gives it a raised box.
//   layout   "reviews" (poster with review beside it) or "grid" (posters with titles underneath)
//   items    the movies, in the order you want them shown
//
// "In the Queue" and "Recently Watched" also get movies added from the site (assets/js/live.js).
//
// Movie fields:
//   title    required
//   year     release year
//   details  director, genre, whatever you like          (reviews layout)
//   starring the top actors, e.g. ["Actor One", "Actor Two"] (reviews layout)
//   rating   out of 10, leave out to hide                 (reviews layout)
//   review   your review; a blank line starts a new paragraph (reviews layout)
//   image    poster art: a file in movies/posters/ (e.g. "posters/heat.jpg") or a full URL
//   credit   the artist, when the art came from the web: { artist: "Name", url: "https://..." }
//            for an official poster (no fan art found) use credit: { official: true }, shown as "Official poster" with no link
//
// A grid movie only needs a title, and ideally year, image, and credit:
//   { title: "Movie Title", year: 1995, image: "posters/movie-title.jpg", credit: { artist: "Name", url: "https://..." } },

window.SECTIONS = [
  {
    // Filled in from the site in owner mode (?admin): pick a movie, the date you watched it, and a rating
    group: "Lately",
    groupNote: "What I just watched, and what's up next",
    groupStyle: "panel",
    live: "watched",
    title: "Recently Watched",
    subtitle: "w/ my ratings",
    layout: "grid",
    items: []
  },
  {
    group: "Lately",
    live: "queue",
    title: "In the Queue",
    layout: "grid",
    items: []
  },
  {
    group: "Favorites",
    groupNote: "",
    groupStyle: "panel",
    title: "All Time Favorites",
    layout: "reviews",
    items: [
      {
        title: "There Will Be Blood",
        year: 2007,
        details: "Dir. Paul Thomas Anderson",
        starring: ["Daniel Day-Lewis", "Paul Dano"],
        image: "posters/there-will-be-blood.jpg",
        credit: { artist: "Jamie Stark", url: "https://instagram.com/starkdesignsllc" },
        review: "What can be said that hasn't already been said? Daniel Day-Lewis literally is Daniel Plainview. There is no separation between where one begins and one ends, a complete and total immersion into character. Personally, Plainview reminds me of my uncle. A rough and tumbled farmer from West Texas, a lone wolf, very little family connection. He worked very hard, made the most of his business, and now lives in a log cabin away from all of society. I don't know him, yet I love him. I love them both and all of their flaws."
      },
      {
        title: "The Big Lebowski",
        year: 1998,
        details: "Dir. Joel & Ethan Coen",
        starring: ["Jeff Bridges", "John Goodman"],
        image: "posters/the-big-lebowski.jpg",
        credit: { artist: "Doaly", url: "http://www.doaly.co.uk/" },
        review: "There is an unspeakable vibe that arises straight from the essence of this movie. Each character and actor that portrays them is the definition of 'perfect'. No one could play anyone else. There are no jokes in this movie written like Anchorman, yet they are endlessly quotable. I watch this 3 times a year minimum. Own the VHS, DVD, BluRay, and 4k. Sountrack, perfect. Story script, perfect. Philip Seymour Hoffman, perfect. The Dude, perfect."
      },
      {
        title: "Everything Everywhere All at Once",
        year: 2022,
        details: "Dir. Daniel Kwan & Daniel Scheinert",
        starring: ["Michelle Yeoh", "Ke Huy Quan"],
        image: "posters/everything-everywhere-all-at-once.jpg",
        credit: { artist: "Jason Ragosta", url: "https://posterspy.com/profile/jragosta" },
        review: "The Multiverse Matrix. Zoom out and it's dripping with existentialism. Zoom in and it's a distilled love story for bloodlines and soulmates. It helps me have less anxiety about reality, what the purpose of anything and everything is. An absolute masterpiece from the Daniels. A performance from David Bryne sure doesn't hurt it either."
      }
    ]
  },
  {
    group: "Favorites",
    live: "comedies",
    title: "Best Comedies",
    layout: "grid",
    items: [
      { title: "Anchorman", year: 2004, image: "posters/anchorman.jpg", credit: { artist: "Oregon Pizza", url: "https://www.behance.net/oregonpizza" } },
      { title: "Superbad", year: 2007, image: "posters/superbad.jpg", credit: { artist: "Star Pendergrass", url: "https://www.instagram.com/star.pendergrass/" } },
      { title: "Horrible Bosses", year: 2011, image: "posters/horrible-bosses.jpg", credit: { artist: "Chungkong", url: "https://displate.com/artist/chungkong" } },
      { title: "The Art of Self-Defense", year: 2019, image: "posters/the-art-of-self-defense.jpg", credit: { artist: "salny", url: "https://posterspy.com/profile/salny/" } },
      { title: "Forgetting Sarah Marshall", year: 2008, image: "posters/forgetting-sarah-marshall.jpg", credit: { artist: "Chungkong", url: "https://displate.com/artist/chungkong" } },
      { title: "Pineapple Express", year: 2008, image: "posters/pineapple-express.jpg", credit: { artist: "Rough Deontas", url: "https://alternativemovieposters.com/amp/pineapple-express-by-rough-deontas/" } }
    ]
  },
  {
    group: "Favorites",
    live: "dramas",
    title: "Best Dramas",
    layout: "grid",
    items: [
      { title: "Phantom Thread", year: 2017, image: "posters/phantom-thread.jpg", credit: { artist: "Chris Ayers", url: "https://www.instagram.com/filmprintposters/" } },
      { title: "Call Me by Your Name", year: 2017, image: "posters/call-me-by-your-name.jpg", credit: { artist: "Cinzia Cacioppo", url: "https://www.instagram.com/the_cinziettis/" } },
      { title: "Blue Valentine", year: 2010, image: "posters/blue-valentine.jpg", credit: { artist: "sampath", url: "https://posterspy.com/profile/sampath/" } },
      { title: "Romeo + Juliet", year: 1996, image: "posters/romeo-juliet.jpg", credit: { artist: "Ise Ananphada", url: "https://alternativemovieposters.com/amp/romeo-juliet-by-ise-ananphada/" } },
      { title: "Lawless", year: 2012, image: "posters/lawless.jpg", credit: { artist: "Lucas Peverill", url: "https://posterspy.com/profile/lucaspeverill/" } }
    ]
  },
  {
    group: "Favorites",
    live: "hidden-gems",
    title: "Hidden Gems",
    layout: "grid",
    items: [
      { title: "Southland Tales", year: 2006, image: "posters/southland-tales.jpg", credit: { artist: "CmdrRiker", url: "https://theposterdb.com/user/CmdrRiker" } },
      { title: "Night Watch", year: 2004, image: "posters/night-watch.jpg", credit: { official: true } },
      { title: "The Fountain", year: 2006, image: "posters/the-fountain.jpg", credit: { artist: "Ise Ananphada", url: "https://alternativemovieposters.com/amp/fountain-ise-ananphada/" } },
      { title: "Layer Cake", year: 2004, image: "posters/layer-cake.jpg", credit: { artist: "Rémi Germain", url: "https://posterspy.com/profile/remigermain/" } },
      { title: "Primer", year: 2004, image: "posters/primer.jpg", credit: { artist: "sampath", url: "https://posterspy.com/profile/sampath/" } },
      { title: "Garden State", year: 2004, image: "posters/garden-state.jpg", credit: { artist: "Daniel Norris", url: "https://posterspy.com/profile/danknorris/" } },
      { title: "Visioneers", year: 2008, image: "posters/visioneers.jpg", credit: { official: true } }
    ]
  }
];
