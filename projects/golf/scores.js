// My golf rounds and bag, shown on the Golf page (projects/golf/). Newest first isn't required; the page sorts by date.
//
// Each round:
//   date     "YYYY-MM-DD"
//   course   course name
//   holes    18 or 9 (leave out for 18)
//   par      course par for the holes played (leave out if unknown; the to-par badge is then hidden)
//   score    total strokes
//   stats    optional extra lines, as [label, value] pairs, e.g. [["Putts", 31], ["GIR", "44%"], ["Avg drive", "262 yds"]]
//   note     optional short note
//   example  true marks placeholder data; delete those entries once you add real ones
//
// <source>Stats (e.g. xgolfStats): the app's own overall stats, shown above that source's rounds instead of
// the computed summary: { headline: [[label, value], ...], stats: [[label, value], ...] }
//
// Bag: one entry per club, in the order you want them listed:
//   club     "Driver", "3 Wood", "7 Iron", "PW", ...
//   model    model name
//   loft     e.g. "10.5°"
//   details  shaft, flex, length, grip, whatever you like
//   image    optional product photo in projects/golf/bag/ (official TaylorMade shots, 240px square)
//   url      optional product page; the photo and model name link to it

window.GOLF = {
  // Trackman rounds are imported into trackman.js by tools/import_trackman.py; add any extras here
  trackman: [],
  // The Trackman app's Me screen, shown above the Trackman rounds
  trackmanStats: {
    headline: [["Trackman HCP", "15.3"], ["Last 5 avg", "98.6"]],
    stats: [
      ["Avg. drive", "175.1 yds"], ["Longest drive", "263.7 yds"],
      ["Fairways hit", "55%"], ["Missed left", "18%"], ["Missed right", "27%"],
      ["Greens in regulation", "13%"],
      ["Avg. on par 3s", "4.3"], ["Avg. on par 4s", "5.5"], ["Avg. on par 5s", "6.6"]
    ]
  },
  // From the X-Golf app's Game Played list (it doesn't show par)
  xgolf: [
    { date: "2026-09-22", course: "Aria Country Club", score: 90 },
    { date: "2026-09-22", course: "Aran Beach", score: 100 },
    { date: "2026-09-08", course: "Georgia Country Club", score: 87 },
    { date: "2026-08-25", course: "Hanbada New Course", score: 92 },
    { date: "2026-08-11", course: "Oakmont Country Club", score: 97 },
    { date: "2026-08-01", course: "Spylass Hill Golf Club", score: 89 },
    { date: "2026-07-21", course: "Zenith Valley", score: 91 },
    { date: "2026-07-14", course: "Sunhills Country Club", score: 95 },
    { date: "2026-06-30", course: "Keunsol Country Club", score: 97 }
  ],
  // The X-Golf app's Stats screen, shown above the rounds (replaces the computed summary line)
  xgolfStats: {
    headline: [["Handicap", "-16.33"], ["Best 18-hole", "87"], ["Best 9-hole", "40"]],
    stats: [
      ["Driving accuracy", "53.91%"], ["Avg. driving distance", "163.65 yd"],
      ["Up & down 30 yds", "86.79%"], ["Up & down 50 yds", "81.98%"],
      ["Putting inside 10 ft", "89.47%"], ["Putting inside 20 ft", "75.98%"],
      ["Longest putt", "24.61 ft"], ["Three putt", "3.66%"],
      ["Avg. putts per hole", "1.69"], ["Avg. putts per round", "30.33"]
    ]
  },
  // 18Birdies: coming soon (add rounds here and the section fills in)
  birdies: [],
  // All TaylorMade. club, model, loft, and details (shaft, length, grip, ...)
  bag: [
    { club: "Driver", image: "bag/qi4d-driver.jpg", url: "https://www.taylormadegolf.com/Qi4D-Driver/DW-TC441.html", model: "Qi4D Core", loft: "10.5°", details: "Reax Red 50 shaft, Regular flex" },
    { club: "Mini-Driver", image: "bag/r7-quad-mini-driver.jpg", url: "https://www.taylormadegolf.com/R7-Quad-Mini-Driver/DW-TC416.html", model: "Custom R7 Quad", loft: "13.5°", details: "Fujikura Speeder MD5, Regular flex, standard sleeve and tipping, -0.50\" length (~43.25\"). TAS weights: front toe/heel 10g, back toe/heel 7g. GolfPride New Decade White-Black grip" },
    { club: "3 Wood", image: "bag/qi4d-max-lite-fairway.jpg", url: "https://www.taylormadegolf.com/Qi4D-Max-Lite-Fairway/DW-TC456.html", model: "Qi4D Max Lite", loft: "15°", details: "Mitsubishi REAX 45, Regular flex" },
    { club: "5 Wood", image: "bag/qi4d-max-lite-fairway.jpg", url: "https://www.taylormadegolf.com/Qi4D-Max-Lite-Fairway/DW-TC456.html", model: "Qi4D Max Lite", loft: "18°", details: "Mitsubishi REAX 45, Regular flex" },
    { club: "7 Wood", image: "bag/qi4d-max-lite-fairway.jpg", url: "https://www.taylormadegolf.com/Qi4D-Max-Lite-Fairway/DW-TC456.html", model: "Qi4D Max Lite", loft: "21°", details: "Mitsubishi REAX 45, Regular flex" },
    { club: "5 Rescue", image: "bag/qi4d-max-lite-rescue.jpg", url: "https://www.taylormadegolf.com/Qi4D-Max-Lite-Rescue/DW-TC459.html", model: "Qi4D Max Lite", loft: "26°", details: "Mitsubishi REAX 45, Regular flex" },
    { club: "7 Iron", image: "bag/rbz-iron.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "31°", details: "37.25\"" },
    { club: "8 Iron", image: "bag/rbz-iron.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "36°", details: "36.75\"" },
    { club: "9 Iron", image: "bag/rbz-iron.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "41°", details: "36.25\"" },
    { club: "PW", image: "bag/rbz-iron.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "46°", details: "35.75\"" },
    { club: "50° Wedge", image: "bag/mg5-charcoal-wedge.jpg", url: "https://www.taylormadegolf.com/MG5-Wedge/DW-TC647.html", model: "MG5 Charcoal", loft: "50°", details: "9° bounce, SB grind, Stiff flex, Dynamic Gold Tour Issue steel shaft" },
    { club: "SW", image: "bag/rbz-wedge.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "54°", details: "35.25\"" },
    { club: "Putter", image: "bag/rbz-putter.jpg", url: "https://www.taylormadegolf.com/RBZ-SpeedLite-Set/DW-TA197.html", model: "RBZ", loft: "3°", details: "34.50\". A MySpider upgrade is planned" }
  ]
};
