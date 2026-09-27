// My movies, grouped into subsections shown top to bottom.
//
// Each subsection has:
//   title    the subsection header
//   subtitle optional small text beside the header
//   layout   "reviews" (poster with review beside it) or "grid" (posters with titles underneath)
//   items    the movies, in the order you want them shown
//
// "In the Queue" and "Recently Watched" also get movies added from the site (assets/js/queue.js).
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
//            for an official poster add label: "Official poster by" (shown instead of "Art by")
//
// A grid movie only needs a title, and ideally year, image, and credit:
//   { title: "Movie Title", year: 1995, image: "posters/movie-title.jpg", credit: { artist: "Name", url: "https://..." } },

window.SECTIONS = [
  {
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
        review: "2018, on my third whiskey & coke, Daniel is on the screen saying 'I have a competition in me. I want no one else to succeed'. I am now changed."
      },
      {
        title: "The Big Lebowski",
        year: 1998,
        details: "Dir. Joel & Ethan Coen",
        starring: ["Jeff Bridges", "John Goodman"],
        image: "posters/the-big-lebowski.jpg",
        credit: { artist: "Doaly", url: "http://www.doaly.co.uk/" },
        review: "There is an unspeakable vibe that arises straight from the essence of this movie. Each character and actor that portrays them is the definition of 'perfect'. No one could play anyone else. There are no jokes in this movie written like Anchorman, yet they are endlessly quotable."
      },
      {
        title: "Donnie Darko",
        year: 2001,
        details: "Dir. Richard Kelly",
        starring: ["Jake Gyllenhaal", "Jena Malone"],
        image: "posters/donnie-darko.jpg",
        credit: { artist: "John Dunn", url: "https://www.instagram.com/johndunn_art/" },
        review: ""
      }
    ]
  },
  {
    title: "In the Queue",
    layout: "grid",
    items: [
      { title: "Blue Jay", year: 2016, image: "posters/blue-jay.jpg", credit: { label: "Official poster by", artist: "InSync Plus", url: "http://www.impawards.com/2016/blue_jay.html" } },
      { title: "Apocalypse Now", year: 1979, image: "posters/apocalypse-now.jpg", credit: { artist: "Dan Mumford", url: "http://www.dan-mumford.com" } },
      { title: "The Florida Project", year: 2017, image: "posters/the-florida-project.jpg", credit: { artist: "Crisella Garcia", url: "https://www.instagram.com/bycrisella/" } },
      { title: "After Hours", year: 1985, image: "posters/after-hours.jpg", credit: { artist: "Sam Coyle", url: "https://posterspy.com/profile/samcoyle" } }
    ]
  },
  {
    // Filled in from the site in owner mode (?admin): pick a movie and the date you watched it
    title: "Recently Watched",
    subtitle: "w/ personal ratings",
    layout: "grid",
    items: []
  },
  {
    title: "Favorite Comedies",
    layout: "grid",
    items: [
      { title: "Anchorman", year: 2004, image: "posters/anchorman.jpg", credit: { artist: "Oregon Pizza", url: "https://www.behance.net/oregonpizza" } },
      { title: "Superbad", year: 2007, image: "posters/superbad.jpg", credit: { artist: "Star Pendergrass", url: "https://www.instagram.com/star.pendergrass/" } },
      { title: "Horrible Bosses", year: 2011, image: "posters/horrible-bosses.jpg", credit: { artist: "Chungkong", url: "https://displate.com/artist/chungkong" } },
      { title: "The Art of Self-Defense", year: 2019, image: "posters/the-art-of-self-defense.jpg", credit: { artist: "salny", url: "https://posterspy.com/profile/salny/" } }
    ]
  },
  {
    title: "Best Dramas",
    layout: "grid",
    items: [
      { title: "Phantom Thread", year: 2017, image: "posters/phantom-thread.jpg", credit: { artist: "Chris Ayers", url: "https://www.instagram.com/filmprintposters/" } },
      { title: "Call Me by Your Name", year: 2017, image: "posters/call-me-by-your-name.jpg", credit: { artist: "Cinzia Cacioppo", url: "https://www.instagram.com/the_cinziettis/" } }
    ]
  }
];
