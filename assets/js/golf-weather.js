// Extras > Golf weather (extras/golf-weather/): the best times to play this week near any US ZIP code, by Nick's rules,
// all in the visitor's browser (no Worker): the three services below answer browsers directly.
//   ZIP -> place     api.zippopotam.us (free, no key)
//   the forecast     api.weather.gov (the National Weather Service: hourly, ~6.5 days, US only; its grid point for a
//                    place is looked up once and remembered); the hours after it runs out, to the same day next week
//                    (Nick, 2026-10-17: "go a full 7 days ahead, so I'm looking at Saturday and I want to see next
//                    Saturday's as well"), from api.open-meteo.com (free, no key; marked "Open-Meteo" in each tip)
//   courses nearby   api.opengolfapi.org /courses/search?lat=&lng= (nearest first; 500 lookups a day per visitor)
// Each hour from 7 AM to 7 PM (the place's own time) is good / playable / not great on temperature, wind and rain
// (rate(), Nick's limits, 2026-10-17: 50-84°F good, 40-49 and 85-89 playable, under 40 or 90+ never (was 60-85 good,
// 50-59 playable, 45-49 only under 5 mph of wind, over 85 never); wind up to 10
// good, up to 20 playable; rain up to 20% good, up to 40% playable, thunder never). A day's best window is its best
// run of 4+ playable hours (about a round), widened to every hour beside it that's as good; a day without one says why.
// The same rules as Nick's private golf page; keep the two in step.
// The ZIP and course picked are kept in the address (?zip=75074&course=<id>) and remembered (nm-golfwx-zip); a
// visitor's remembered ZIP wins over one in a link.
// With a course picked, the wind is laid over its holes (Nick: "how often the wind would affect you on the course"):
// each hole's tee-to-green direction from OpenStreetMap (api.opengolfapi.org /features: the hole lines, or else each
// hole's numbered tees and green), then for the window's wind, how many holes play downwind (helps carry), into it,
// or across, with a little compass of the holes, only when the wind is over 10 mph. Not every course is mapped; then
// it says so.
(function () {
  var root = document.getElementById("gw");
  var form = document.getElementById("gw-search");
  var input = document.getElementById("gw-zip");
  var msg = document.getElementById("gw-msg");
  if (!root || !form) return;
  var MIN_HOURS = 4, FIRST = 7, LAST = 19, DAYS_AHEAD = 7;
  var COURSES_SHOWN = 8, COURSES_MILES = 30;
  var state = { zip: null, place: null, courses: [], course: null, data: null, holes: [] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getJSON(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- rules (as in Nick's private golf page) ----------
  function rate(h) {
    var t = h.temp, w = h.wind;
    var r = {
      temp: t >= 90 ? 0 : t >= 85 ? 1 : t >= 50 ? 2 : t >= 40 ? 1 : 0,
      wind: w <= 10 ? 2 : w <= 20 ? 1 : 0,
      rain: /thunder/i.test(h.sky) || h.rain > 40 ? 0 : h.rain > 20 ? 1 : 2,
    };
    r.overall = Math.min(r.temp, r.wind, r.rain);
    return r;
  }
  function best(hours) {
    var top = null;
    for (var i = 0; i < hours.length; i++) {
      for (var j = i; j < hours.length && hours[j].r.overall > 0 && (j === i || hours[j].hour === hours[j - 1].hour + 1); j++) {
        var run = hours.slice(i, j + 1);
        if (run.length < MIN_HOURS) continue;
        var score = run.reduce(function (n, h) { return n + h.r.overall + (h.r.temp + h.r.wind + h.r.rain) / 6; }, 0) / run.length;
        score = Math.round(score * 100) / 100;
        var cand = summary(run, { score: score, great: run.every(function (h) { return h.r.overall === 2; }) });
        if (!top || cand.score > top.score + 0.01 || (Math.abs(cand.score - top.score) <= 0.01 && run.length > top.end - top.start && run.length <= 6)) top = cand;
      }
    }
    return top && stretch(top, hours);
  }
  function summary(run, extra) {
    var temps = run.map(function (h) { return h.temp; });
    return Object.assign({ start: run[0].hour, end: run[run.length - 1].hour + 1, temp: [Math.min.apply(null, temps), Math.max.apply(null, temps)],
      wind: Math.max.apply(null, run.map(function (h) { return h.wind; })), rain: Math.max.apply(null, run.map(function (h) { return h.rain; })) }, extra);
  }
  // widen to every hour beside it that's as good (so an all-good day shows all of it)
  function stretch(b, hours) {
    var at = function (hr) { return hours.filter(function (h) { return h.hour === hr; })[0]; };
    var inside = hours.filter(function (h) { return h.hour >= b.start && h.hour < b.end; });
    var floor = Math.min.apply(null, inside.map(function (h) { return h.r.overall; }));
    var s = b.start, e = b.end;
    while (at(s - 1) && at(s - 1).r.overall >= floor) s--;
    while (at(e) && at(e).r.overall >= floor) e++;
    var run = hours.filter(function (h) { return h.hour >= s && h.hour < e; });
    var out = summary(run, { score: b.score, great: b.great });
    out.allDay = s === hours[0].hour && e === hours[hours.length - 1].hour + 1 && hours.length >= 10;
    return out;
  }
  var DIRS = { N: "north", S: "south", E: "east", W: "west", NE: "northeast", NW: "northwest", SE: "southeast", SW: "southwest",
    NNE: "north-northeast", ENE: "east-northeast", ESE: "east-southeast", SSE: "south-southeast", SSW: "south-southwest", WSW: "west-southwest", WNW: "west-northwest", NNW: "north-northwest" };
  function why(hours) {
    if (hours.length < MIN_HOURS) return "Not enough daylight left today";
    var bad = hours.filter(function (h) { return h.r.overall === 0; });
    var playable = hours.length - bad.length;
    if (!bad.length) return "Never " + MIN_HOURS + " playable hours in a row";
    var out = [];
    var windy = bad.filter(function (h) { return h.r.wind === 0; });
    if (windy.length) {
      var dirs = {};
      windy.forEach(function (h) { dirs[h.dir] = (dirs[h.dir] || 0) + 1; });
      var dir = Object.keys(dirs).sort(function (a, b) { return dirs[b] - dirs[a]; })[0];
      var ws = windy.map(function (h) { return h.wind; }), lo = Math.min.apply(null, ws), hi = Math.max.apply(null, ws);
      out.push([windy.length, "too windy" + (windy.length >= hours.length - 1 ? " all day" : "") + ": " + (lo === hi ? hi : lo + "–" + hi) + " mph" + (dir ? " from the " + (DIRS[dir] || dir) : "")]);
    }
    var stormy = bad.filter(function (h) { return /thunder/i.test(h.sky); });
    var wet = bad.filter(function (h) { return h.r.rain === 0 && !/thunder/i.test(h.sky); });
    if (stormy.length) out.push([stormy.length, "thunderstorms" + (stormy.length >= hours.length - 1 ? " all day" : "")]);
    if (wet.length) out.push([wet.length, "rain likely (up to " + Math.max.apply(null, wet.map(function (h) { return h.rain; })) + "%)"]);
    var hot = bad.filter(function (h) { return h.r.temp === 0 && h.temp >= 90; });
    var cold = bad.filter(function (h) { return h.r.temp === 0 && h.temp < 40; });
    if (hot.length) out.push([hot.length, "too hot (up to " + Math.max.apply(null, hot.map(function (h) { return h.temp; })) + "°F; 90°F is too hot)"]);
    if (cold.length) out.push([cold.length, "too cold (down to " + Math.min.apply(null, cold.map(function (h) { return h.temp; })) + "°F)"]);
    out.sort(function (a, b) { return b[0] - a[0]; });
    var text = out.slice(0, 2).map(function (x) { return x[1]; }).join("; ");
    return text.charAt(0).toUpperCase() + text.slice(1) + (playable && playable < MIN_HOURS ? "; only " + playable + " playable " + (playable === 1 ? "hour" : "hours") : "");
  }

  // ---------- data ----------
  function place(zip) {
    return getJSON("https://api.zippopotam.us/us/" + zip).then(function (d) {
      var p = (d.places || [])[0];
      if (!p) throw new Error("zip");
      return { lat: +p.latitude, lon: +p.longitude, name: p["place name"] + ", " + p["state abbreviation"] };
    }, function (e) { throw e.status === 404 ? new Error("zip") : e; });
  }
  // the hourly forecast for a point, cached for an hour (and its grid URL for good)
  function forecast(lat, lon) {
    var key = lat.toFixed(3) + "," + lon.toFixed(3);
    var cached = JSON.parse(get("nm-golfwx-fc2:" + key) || "null");
    if (cached && Date.now() - cached.at < 3600e3) return Promise.resolve(cached.periods);
    var grid = get("nm-golfwx-grid:" + key);
    var findGrid = grid ? Promise.resolve(grid) : getJSON("https://api.weather.gov/points/" + key, { Accept: "application/geo+json" })
      .then(function (d) { set("nm-golfwx-grid:" + key, d.properties.forecastHourly); return d.properties.forecastHourly; },
        function (e) { throw e.status === 404 ? new Error("us") : e; });
    return findGrid.then(function (url) { return getJSON(url, { Accept: "application/geo+json" }); }).then(function (d) {
      var periods = d.properties.periods.map(function (p) {
        var speeds = String(p.windSpeed || "0").match(/\d+/g) || ["0"];
        return { t: p.startTime, temp: p.temperature, wind: Math.max.apply(null, speeds.map(Number)), dir: p.windDirection || "",
          rain: (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0, sky: p.shortForecast || "" };
      });
      return laterDays(lat, lon, periods).then(function (more) { return periods.concat(more); }, function () { return periods; });
    }).then(function (periods) {
      set("nm-golfwx-fc2:" + key, JSON.stringify({ at: Date.now(), periods: periods }));
      return periods;
    });
  }
  // the hours after the Weather Service's forecast ends, through the same day next week, from Open-Meteo (its times
  // are the place's own, like the Weather Service's: "2026-10-24T12:00")
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function skyOf(code) {
    return code >= 95 ? "Thunderstorms" : code >= 85 ? "Snow showers" : code >= 80 ? "Rain showers" : code >= 71 ? "Snow" :
      code >= 61 ? "Rain" : code >= 51 ? "Drizzle" : code >= 45 ? "Fog" : code >= 3 ? "Cloudy" : code >= 1 ? "Partly cloudy" : "Clear";
  }
  function lastDate(periods) { // the same day next week
    var d = new Date(periods[0].t.slice(0, 10) + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + DAYS_AHEAD);
    return d.toISOString().slice(0, 10);
  }
  function laterDays(lat, lon, periods) {
    if (!periods.length) return Promise.resolve([]);
    var end = periods[periods.length - 1].t.slice(0, 13), until = lastDate(periods);
    if (end.slice(0, 10) > until || end >= until + "T" + LAST) return Promise.resolve([]);
    return getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(4) + "&longitude=" + lon.toFixed(4) +
      "&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=" + (DAYS_AHEAD + 2)).then(function (d) {
      var h = d.hourly || {}, out = [];
      (h.time || []).forEach(function (t, i) {
        if (t.slice(0, 13) <= end || t.slice(0, 10) > until || h.temperature_2m[i] == null) return;
        out.push({ t: t, temp: Math.round(h.temperature_2m[i]), wind: Math.round(h.wind_speed_10m[i] || 0),
          dir: COMPASS[Math.round((h.wind_direction_10m[i] || 0) / 22.5) % 16], rain: h.precipitation_probability[i] || 0,
          sky: skyOf(h.weather_code[i]), src: "om" });
      });
      return out;
    });
  }
  // the forecast's times are in the place's own time zone ("2026-10-14T13:00:00-05:00"): its date and hour as written
  function days(periods) {
    var byDay = {}, order = [];
    periods.forEach(function (p) {
      var date = p.t.slice(0, 10), hour = +p.t.slice(11, 13);
      if (hour < FIRST || hour > LAST) return;
      if (!byDay[date]) { byDay[date] = []; order.push(date); }
      var h = Object.assign({ hour: hour }, p);
      h.r = rate(h);
      byDay[date].push(h);
    });
    return order.map(function (date) {
      var b = best(byDay[date]);
      return { date: date, hours: byDay[date], best: b, why: b ? null : why(byDay[date]) };
    });
  }
  function nearbyCourses(p) {
    return getJSON("https://api.opengolfapi.org/api/v1/courses/search?lat=" + p.lat + "&lng=" + p.lon + "&limit=20").then(function (d) {
      return (d.courses || []).map(function (c) {
        return { id: c.id, name: c.course_name, city: c.city, type: String(c.type || "").toLowerCase(), lat: c.lat, lon: c.lng, mi: miles(p, { lat: c.lat, lon: c.lng }) };
      }).filter(function (c) { return c.lat && c.mi <= COURSES_MILES; }).slice(0, COURSES_SHOWN);
    }).catch(function () { return []; });
  }

  // ---------- the course's holes vs the wind ----------
  var WIND_MATTERS = 10; // mph: at or under it, the wind-by-hole details aren't shown (Nick)
  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function deg(dir) { var i = POINTS.indexOf(dir); return i < 0 ? null : i * 22.5; }
  function bearing(a, b) { // degrees from north, from a to b ([lng, lat] each)
    var r = Math.PI / 180, la1 = a[1] * r, la2 = b[1] * r, dl = (b[0] - a[0]) * r;
    var y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function middle(geom) { // the middle of a tee or green (its outline's average point)
    var pts = geom.type === "Polygon" ? geom.coordinates[0] : geom.type === "MultiPolygon" ? geom.coordinates[0][0] : geom.type === "Point" ? [geom.coordinates] : geom.coordinates;
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }
  // [{ n, deg }] for the course, or [] when OpenStreetMap doesn't have its holes; worked out once and remembered
  function holes(course) {
    var key = "nm-golfwx-holes:" + course.id;
    var saved = get(key);
    if (saved) return Promise.resolve(JSON.parse(saved));
    return getJSON("https://api.opengolfapi.org/api/v1/features?course=" + encodeURIComponent(course.id)).then(function (d) {
      var tag = function (f) { var t = {}; (f.tags || []).forEach(function (x) { var i = x.indexOf("="); if (i > 0) t[x.slice(0, i)] = x.slice(i + 1); }); return t; };
      var num = function (f, t) { var n = f.hole_number || parseInt(t.ref, 10); return n >= 1 && n <= 36 ? n : null; };
      var out = {}, tees = {}, greens = {};
      (d.features || []).forEach(function (f) {
        var t = tag(f), n = num(f, t), g = f.geometry;
        if (!g || !n) return;
        if (t.golf === "hole" && g.type === "LineString" && g.coordinates.length > 1) out[n] = bearing(g.coordinates[0], g.coordinates[g.coordinates.length - 1]);
        else if (t.golf === "tee") (tees[n] = tees[n] || []).push(middle(g));
        else if (t.golf === "green" && !greens[n]) greens[n] = middle(g);
      });
      // no hole lines: from the middle of a hole's tee boxes to its green
      Object.keys(greens).forEach(function (n) {
        if (out[n] != null || !tees[n]) return;
        var x = 0, y = 0;
        tees[n].forEach(function (p) { x += p[0]; y += p[1]; });
        out[n] = bearing([x / tees[n].length, y / tees[n].length], greens[n]);
      });
      var list = Object.keys(out).map(function (n) { return { n: +n, deg: Math.round(out[n]) }; }).sort(function (a, b) { return a.n - b.n; });
      if (list.length < 9) list = []; // a few stray holes isn't a layout
      set(key, JSON.stringify(list));
      return list;
    }).catch(function () { return []; });
  }
  // how the holes play in a wind from `dir`: each hole down (the wind within 45° of its line, behind you), into, or across
  function split(hl, dir) {
    var from = deg(dir);
    if (from == null || !hl.length) return null;
    var to = (from + 180) % 360, out = { down: 0, into: 0, across: 0, each: [] };
    hl.forEach(function (h) {
      var a = Math.abs(((h.deg - to) % 360 + 540) % 360 - 180); // 0 = straight downwind, 180 = straight into it
      var k = a <= 45 ? "down" : a >= 135 ? "into" : "across";
      out[k]++;
      out.each.push({ n: h.n, deg: h.deg, k: k });
    });
    return out;
  }
  // the window's wind: its most common direction, and its strongest speed
  function windOf(hours) {
    var c = {};
    hours.forEach(function (h) { if (h.dir) c[h.dir] = (c[h.dir] || 0) + 1; });
    var dir = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0] || "";
    return { dir: dir, speed: Math.max.apply(null, hours.map(function (h) { return h.wind; })) };
  }
  // a little compass: every hole a spoke from the middle in its direction, colored by how it plays (green downwind, red into
// it, yellow across); the wind's arrow
  function rose(sp, dir) {
    var C = { down: "var(--mint)", into: "var(--coral)", across: "#ffd166" };
    var line = function (d, len, color, w) { var r = d * Math.PI / 180; return '<line x1="24" y1="24" x2="' + (24 + Math.sin(r) * len).toFixed(1) + '" y2="' + (24 - Math.cos(r) * len).toFixed(1) + '" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round"/>'; };
    var from = deg(dir), to = (from + 180) % 360, r = to * Math.PI / 180;
    // the wind: an arrow across the circle, pointing the way it blows
    var ax = 24 + Math.sin(r) * 21, ay = 24 - Math.cos(r) * 21, bx = 24 - Math.sin(r) * 21, by = 24 + Math.cos(r) * 21;
    var head = function (k) { var a = r + Math.PI + k; return (ax + Math.sin(a) * 5).toFixed(1) + "," + (ay - Math.cos(a) * 5).toFixed(1); };
    return '<svg class="gw-rose" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22.5" fill="none" stroke="#2a2a2e"/>' +
      sp.each.map(function (h) { return line(h.deg, 18, C[h.k], 1.6); }).join("") +
      '<line x1="' + bx.toFixed(1) + '" y1="' + by.toFixed(1) + '" x2="' + ax.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="#ecebe7" stroke-width="1.2" stroke-dasharray="2 2"/>' +
      '<polygon points="' + ax.toFixed(1) + "," + ay.toFixed(1) + " " + head(0.45) + " " + head(-0.45) + '" fill="#ecebe7"/></svg>';
  }
  function windLine(sp, w) {
    // the most common of the three is underlined (all of them that tie for it)
    var most = Math.max(sp.down, sp.into, sp.across);
    var part = function (k, text) { return '<b class="' + k + (sp[k] === most ? " top" : "") + '">' + sp[k] + " " + text + "</b>"; };
    return "Wind on the course: from the " + (DIRS[w.dir] || w.dir) + " at up to " + w.speed + " mph · " + part("down", "downwind") + " · " + part("into", "into it") + " · " + part("across", "across");
  }

  // ---------- page ----------
  function hr(h) { return (h % 12 || 12) + (h < 12 || h === 24 ? " AM" : " PM"); }
  function dayFmt(d, o) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, o)); }
  function render() {
    var list = state.data, today = list.length ? list[0].date : "";
    function dayName(d) { return d === today ? "Today" : dayFmt(d, { weekday: "long" }); }
    var where = state.course ? state.course.name + " · " + state.course.city : state.place.name;
    // the week's best three, a day each (all good first, then by score, then sooner)
    var all = list.filter(function (d) { return d.best; }).sort(function (x, y) { return (y.best.great - x.best.great) || (y.best.score - x.best.score) || (x.date < y.date ? -1 : 1); }).slice(0, 3);
    var chips = state.courses.length ? '<div class="gw-courses" role="group" aria-label="Forecast for"><span class="gw-courses-label">Courses nearby</span>' +
      '<button type="button" data-course="" aria-pressed="' + !state.course + '">' + esc(state.place.name) + "</button>" +
      state.courses.map(function (c) {
        return '<button type="button" data-course="' + esc(c.id) + '" aria-pressed="' + !!(state.course && state.course.id === c.id) + '">' + esc(c.name) +
          ' <small>' + c.mi.toFixed(1) + " mi" + (/private/.test(c.type) ? " · private" : "") + "</small></button>";
      }).join("") + "</div>" : "";
    var mapNote = state.course ? '<p class="gw-map-note">' + (state.holes.length
      ? "When the wind is over " + WIND_MATTERS + " mph, wind on the course uses the layout of its " + state.holes.length + " holes from OpenStreetMap: <b class=\"down\">downwind</b> helps carry, <b class=\"into\">into it</b> plays longer, <b class=\"across\">across</b> pushes the ball sideways."
      : "This course's holes aren't mapped on OpenStreetMap, so there's no wind-by-hole for it.") + "</p>" : "";
    root.innerHTML = chips + mapNote +
      '<section class="gw-best"><h2>Best times this week · ' + esc(where) + "</h2>" + (all.length ? '<div class="gw-picks">' + all.map(function (d) {
        return '<div class="gw-pick"><b>' + esc(dayName(d.date)) + (d.best.allDay ? " all day" : " " + hr(d.best.start) + "–" + hr(d.best.end)) + "</b><span>" +
          d.best.temp[0] + "–" + d.best.temp[1] + "°F · wind " + d.best.wind + " mph · " + d.best.rain + "% rain</span></div>";
      }).join("") + "</div>" : '<p class="gw-window none">No 4-hour window looks playable this week.</p>') + "</section>" +
      list.map(function (d) {
        var cells = [];
        for (var h = FIRST; h <= LAST; h++) {
          var x = d.hours.filter(function (y) { return y.hour === h; })[0];
          var inBest = d.best && h >= d.best.start && h < d.best.end;
          var hs = state.course && state.holes.length && x && x.wind > WIND_MATTERS ? split(state.holes, x.dir) : null;
          cells.push(x ? '<span class="gw-h g' + x.r.overall + (inBest ? " in" : "") + '" tabindex="0" data-tip="' + esc(hr(h) + ": " + x.temp + "°F, wind " + x.dir + " " + x.wind + " mph, " + x.rain + "% rain, " + x.sky + (x.src === "om" ? " (Open-Meteo)" : "") +
            (hs ? " · on the course: " + hs.down + " downwind, " + hs.into + " into it, " + hs.across + " across" : "")) + '">' + x.temp + "°<small>" + (h % 12 || 12) + "</small></span>"
            : '<span class="gw-h none"></span>');
        }
        // with a course picked: how the window's wind plays on its holes
        var course = "";
        if (state.course && state.holes.length && d.hours.length) {
          // the window's wind, or the whole day's when there's no window (a too-windy day is when this matters most)
          var w = windOf(d.best ? d.hours.filter(function (x) { return x.hour >= d.best.start && x.hour < d.best.end; }) : d.hours);
          // only when there's enough wind to matter (Nick: over 10 mph)
          var sp = w.speed > WIND_MATTERS ? split(state.holes, w.dir) : null;
          if (sp) course = '<span class="gw-course-wind">' + rose(sp, w.dir) + "<span>" + windLine(sp, w) + "</span></span>";
        }
        return '<div class="gw-day"><span class="gw-date">' + esc(dayName(d.date)) + "<small>" + esc(dayFmt(d.date, { month: "short", day: "numeric" })) + "</small></span>" +
          '<span class="gw-window' + (d.best ? "" : " none") + '">' + (d.best ? "<b>" + (d.best.allDay ? "Good all day: " : "") + hr(d.best.start) + " – " + hr(d.best.end) + "</b> <span class=\"meta\">· " +
            (d.best.temp[0] === d.best.temp[1] ? d.best.temp[0] : d.best.temp[0] + "–" + d.best.temp[1]) + "°F · wind up to " + d.best.wind + " mph · " + d.best.rain + "% rain</span>" : esc(d.why)) + "</span>" +
          course + '<span class="gw-hours">' + cells.join("") + '</span><span class="gw-tip"></span></div>';
      }).join("") +
      // (the color rules are at the top of the page, extras/golf-weather/index.html .gw-rules: keep them matching rate())
      '<div class="gw-key"><span>Forecast: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a>' +
        (state.data && state.data.some(function (d) { return d.hours.some(function (x) { return x.src === "om"; }); }) ? ', then <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>' : "") +
        (state.courses.length ? ' · courses: <a href="https://opengolfapi.org/" target="_blank" rel="noopener">OpenGolfAPI</a>' : "") +
      (state.course && state.holes.length ? ' · hole layout © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' : "") + "</span></div>";
  }

  function say(text, bad) { msg.textContent = text || ""; msg.classList.toggle("bad", !!bad); }
  function load(zip, courseId) {
    say("Looking it up…");
    root.classList.add("loading");
    return place(zip).then(function (p) {
      state.zip = zip; state.place = p; state.course = null;
      set("nm-golfwx-zip", zip);
      return nearbyCourses(p).then(function (courses) {
        state.courses = courses;
        state.course = courses.filter(function (c) { return c.id === courseId; })[0] || null;
        var at = state.course || p;
        return Promise.all([forecast(at.lat, at.lon), state.course ? holes(state.course) : []]).then(function (r) { state.holes = r[1]; return r[0]; });
      });
    }).then(function (periods) {
      state.data = days(periods);
      render();
      say("");
      remember();
    }).catch(function (e) {
      say(e.message === "zip" ? "Couldn't find that ZIP code." : e.message === "us" ? "The Weather Service only covers the US." : "Couldn't get the forecast just now. Try again in a bit.", true);
    }).then(function () { root.classList.remove("loading"); });
  }
  function pickCourse(id) {
    var c = state.courses.filter(function (x) { return x.id === id; })[0] || null;
    state.course = c;
    var at = c || state.place;
    root.classList.add("loading");
    Promise.all([forecast(at.lat, at.lon), c ? holes(c) : []]).then(function (r) { state.holes = r[1]; state.data = days(r[0]); render(); remember(); },
      function () { say("Couldn't get that course's forecast just now.", true); })
      .then(function () { root.classList.remove("loading"); });
  }
  function remember() {
    var q = "?zip=" + state.zip + (state.course ? "&course=" + encodeURIComponent(state.course.id) : "");
    if (location.search !== q) history.replaceState(null, "", q);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var zip = input.value.trim();
    if (!/^\d{5}$/.test(zip)) return say("Type a 5-digit US ZIP code.", true);
    load(zip);
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-course]");
    if (b) return pickCourse(b.dataset.course);
    var h = e.target.closest(".gw-h[data-tip]");
    if (h) h.closest(".gw-day").querySelector(".gw-tip").textContent = h.dataset.tip;
  });
  function tip(e) {
    var h = e.target.closest && e.target.closest(".gw-h[data-tip]");
    if (h) h.closest(".gw-day").querySelector(".gw-tip").textContent = h.dataset.tip;
  }
  root.addEventListener("mouseover", tip);
  root.addEventListener("focusin", tip);

  // start: the ZIP in the address, else the last one used, else Plano's
  var params = new URLSearchParams(location.search);
  // the visitor's own ZIP first (Nick, 2026-10-19: "make sure it stays and doesn't default back to mine"): a ZIP in the
  // link (a shared ?zip=75074, copied from the address bar) is only for someone who hasn't entered one yet; its course
  // goes with it
  var urlZip = /^\d{5}$/.test(params.get("zip") || "") ? params.get("zip") : null, savedZip = get("nm-golfwx-zip");
  var zip0 = savedZip || urlZip || "75074";
  input.value = zip0;
  load(zip0, zip0 === urlZip ? params.get("course") : null);
})();
