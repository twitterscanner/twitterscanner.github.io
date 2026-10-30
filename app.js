(function () {
  "use strict";
  var REFRESH_MS = 30000;
  var TZ_KEY = "oilwatch.timeZone";
  var COMMON_ZONES = ["Asia/Singapore", "Asia/Kolkata", "Asia/Dubai", "Asia/Tehran", "Europe/London", "Europe/Moscow",
    "Europe/Kyiv", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney",
    "Asia/Tokyo", "Asia/Hong_Kong", "UTC"];
  var data = null;
  var lastJson = "";
  var confFilter = "All";
  var themeFilter = "All";

  /* ---------- time zone helpers (pure; no DOM) ---------- */
  var fmtCache = {};
  function validZone(z) {
    if (!z || typeof z !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch (e) { return false; }
  }
  function browserZone() {
    var z = "";
    try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { z = ""; }
    return validZone(z) ? z : "UTC";
  }
  function parseTs(s) {
    if (typeof s !== "string" || !s) return null;
    var t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }
  // Returns {weekday, day, month, year, hour, minute, second, ampm, h24, zone, dayKey} for a Date in zone z.
  function parts(d, z) {
    var f = fmtCache[z];
    if (!f) {
      f = fmtCache[z] = new Intl.DateTimeFormat("en-US", {
        timeZone: z, weekday: "short", day: "numeric", month: "short", year: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short"
      });
    }
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    var h = parseInt(o.hour, 10) % 24;
    return {
      weekday: o.weekday, day: o.day, month: o.month, year: o.year, minute: o.minute, second: o.second,
      h24: h, hour: (h % 12) || 12, ampm: h < 12 ? "am" : "pm", zone: o.timeZoneName || z,
      dayKey: o.year + "-" + o.month + "-" + o.day
    };
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function clock(p) { return p.hour + ":" + p.minute + " " + p.ampm; }                  // 6:12 am
  function dayMonth(p) { return p.day + " " + p.month; }                                // 30 Oct
  function fullStamp(d, z) {                                                            // Fri 30 Oct 2026, 5:59 pm SGT
    var p = parts(d, z);
    return p.weekday + " " + p.day + " " + p.month + " " + p.year + ", " + clock(p) + " " + p.zone;
  }
  function hmsIn(d, z) { var p = parts(d, z); return p2(p.h24) + ":" + p.minute + ":" + p.second + " " + p.zone; }

  // refDayKey: day the table is "about" (last scan / as-of) in zone z; date is shown when the row differs.
  // headerZone: zone label shown in the column headers; appended to a cell only when it differs (DST edges).
  function reportedText(a, z, refDayKey, headerZone) {
    var d = parseTs(a.ts);
    if (!d) return a.time ? String(a.time) + (z === "Asia/Singapore" ? "" : " SGT") : "";
    var p = parts(d, z);
    var s = clock(p);
    if (refDayKey && p.dayKey !== refDayKey) s += ", " + dayMonth(p);
    if (headerZone && p.zone !== headerZone) s += " " + p.zone;
    return s;
  }
  function eventText(a, z, headerZone, refDayKey) {
    var e = parseTs(a.eventTs);
    if (!e) {
      if (a.eventTs === null || a.eventTs === undefined || a.eventTs === "") {
        if (a.eventTime) return String(a.eventTime);   // keeps context like "Not stated (policy decision…)"
        return a.eventQual === "not stated" || a.eventTs === null ? "Not stated" : "";
      }
      return a.eventTime ? String(a.eventTime) : "";
    }
    var p = parts(e, z);
    var s = clock(p);
    var r = parseTs(a.ts);
    // show the date when it differs from the reported day or from the table's reference day
    if (!r || parts(r, z).dayKey !== p.dayKey || (refDayKey && p.dayKey !== refDayKey)) s += ", " + dayMonth(p);
    if (headerZone && p.zone !== headerZone) s += " " + p.zone;
    if (a.eventQual === "est.") s += " est.";
    return s;
  }
  function headerInfo(dat, z) {
    var ref = parseTs(dat && dat.lastScannedTs) || parseTs(dat && dat.asOfTs) || new Date();
    var p = parts(ref, z);
    return { dayKey: p.dayKey, zone: p.zone };
  }
  function scannedText(dat, z) {
    var d = parseTs(dat && dat.lastScannedTs);
    return d ? fullStamp(d, z) : ((dat && dat.lastScanned) || "–");
  }
  function asOfText(dat, z) {
    var d = parseTs(dat && dat.asOfTs);
    return d ? fullStamp(d, z) : ((dat && dat.asOf) || "");
  }

  var api = { validZone: validZone, browserZone: browserZone, parts: parts, reportedText: reportedText,
    eventText: eventText, headerInfo: headerInfo, scannedText: scannedText, asOfText: asOfText, hmsIn: hmsIn,
    COMMON_ZONES: COMMON_ZONES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---------- time zone selection ---------- */
  var BROWSER_TZ = browserZone();
  var storedTz = "";
  try { storedTz = localStorage.getItem(TZ_KEY) || ""; } catch (e) { storedTz = ""; }
  if (storedTz && !validZone(storedTz)) storedTz = "";
  function currentZone() { return storedTz || BROWSER_TZ; }

  /* ---------- DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function setText(id, t) { var e = $(id); if (e && e.textContent !== String(t)) e.textContent = String(t); }
  function tag(text, kind) { return el("span", "tag " + kind, text); }
  function dirTag(d) { return tag(d, d === "Up" ? "up" : d === "Down" ? "down" : "neutral"); }
  function confTag(c) { return tag(c, c === "Confirmed" ? "confirmed" : "unconfirmed"); }
  function safeHref(h) { return /^https?:\/\//i.test(h || "") ? h : "#"; }
  function eventCell(a, z, hz, ref) {
    var s = el("span", "", eventText(a, z, hz, ref));
    if (a.eventTs && a.eventTime) s.title = "Source note: " + String(a.eventTime);
    return s;
  }

  function buildTzSelect() {
    var sel = $("tz-select");
    if (!sel) return;
    var frag = document.createDocumentFragment();
    var def = el("option", "", "Browser default (" + BROWSER_TZ + ")");
    def.value = "";
    frag.appendChild(def);
    var seen = {};
    var g1 = el("optgroup");
    g1.label = "Common";
    COMMON_ZONES.forEach(function (z) {
      if (!validZone(z) || seen[z]) return;
      seen[z] = true;
      var o = el("option", "", z); o.value = z; g1.appendChild(o);
    });
    frag.appendChild(g1);
    var all = [];
    try { if (typeof Intl.supportedValuesOf === "function") all = Intl.supportedValuesOf("timeZone"); } catch (e) { all = []; }
    if (storedTz && !seen[storedTz] && all.indexOf(storedTz) === -1) all = all.concat([storedTz]);
    var rest = all.filter(function (z) { return !seen[z]; });
    if (rest.length) {
      var g2 = el("optgroup");
      g2.label = "All time zones";
      rest.forEach(function (z) { var o = el("option", "", z); o.value = z; g2.appendChild(o); });
      frag.appendChild(g2);
    }
    sel.replaceChildren(frag);
    sel.value = storedTz;
    if (sel.value !== storedTz) sel.value = "";
    sel.addEventListener("change", function () {
      storedTz = validZone(sel.value) ? sel.value : "";
      try { if (storedTz) localStorage.setItem(TZ_KEY, storedTz); else localStorage.removeItem(TZ_KEY); } catch (e) { /* ignore */ }
      render();
      if (lastChecked) status(lastOk, lastMsgBase);
    });
  }

  function row(cells) {
    var tr = el("tr");
    cells.forEach(function (c) {
      var td = el("td");
      if (c instanceof Node) td.appendChild(c); else td.textContent = c == null ? "" : String(c);
      tr.appendChild(td);
    });
    return tr;
  }

  function buttons(containerId, options, current, onPick) {
    var box = $(containerId);
    box.replaceChildren();
    options.forEach(function (o) {
      var b = el("button", o === current ? "active" : "", o);
      b.type = "button";
      b.setAttribute("aria-pressed", o === current ? "true" : "false");
      b.addEventListener("click", function () { onPick(o); });
      box.appendChild(b);
    });
  }

  function render() {
    if (!data) return;
    var z = currentZone();
    var hi = headerInfo(data, z);
    var alerts = Array.isArray(data.alerts) ? data.alerts : [];
    var count = function (d) { return alerts.filter(function (a) { return a.direction === d; }).length; };
    var themes = [];
    alerts.forEach(function (a) { if (themes.indexOf(a.theme) === -1) themes.push(a.theme); });
    if (themeFilter !== "All" && themes.indexOf(themeFilter) === -1) themeFilter = "All";

    Array.prototype.forEach.call(document.querySelectorAll(".th-rep"), function (th) { th.textContent = "Reported (" + hi.zone + ")"; });
    Array.prototype.forEach.call(document.querySelectorAll(".th-evt"), function (th) { th.textContent = "Event time (" + hi.zone + ")"; });

    setText("summary", data.summary || "");
    var asof = asOfText(data, z);
    setText("asof", asof ? "Alerts as of " + asof : "");
    setText("netread-lead", (data.netRead && data.netRead.lead) || "");
    setText("netread-text", (data.netRead && data.netRead.text) || "");
    setText("m-total", alerts.length);
    setText("m-up", count("Up"));
    setText("m-down", count("Down"));
    setText("m-brent", (data.brent && data.brent.value) || "–");
    setText("m-brent-detail", (data.brent && data.brent.detail) || "");
    setText("m-scanned", scannedText(data, z));

    buttons("conf-filter", ["All", "Confirmed", "Unconfirmed"], confFilter, function (v) { confFilter = v; render(); });
    var body = $("log-body");
    var frag = document.createDocumentFragment();
    var shown = alerts.filter(function (a) { return confFilter === "All" || a.confidence === confFilter; });
    shown.forEach(function (a) {
      frag.appendChild(row([reportedText(a, z, hi.dayKey, hi.zone), eventCell(a, z, hi.zone, hi.dayKey), a.headline, a.theme,
        dirTag(a.direction), confTag(a.confidence), a.source]));
    });
    if (!shown.length) { var tr = el("tr"); var td = el("td", "empty", "No alerts match."); td.colSpan = 7; tr.appendChild(td); frag.appendChild(tr); }
    body.replaceChildren(frag);

    buttons("theme-filter", ["All"].concat(themes), themeFilter, function (v) { themeFilter = v; render(); });
    var tbody = $("theme-body");
    var frag2 = document.createDocumentFragment();
    alerts.filter(function (a) { return themeFilter === "All" || a.theme === themeFilter; }).forEach(function (a) {
      frag2.appendChild(row([a.theme, reportedText(a, z, hi.dayKey, hi.zone), eventCell(a, z, hi.zone, hi.dayKey), a.headline,
        dirTag(a.direction), confTag(a.confidence)]));
    });
    tbody.replaceChildren(frag2);

    var bars = $("bars");
    var frag3 = document.createDocumentFragment();
    var max = 1;
    var counts = themes.map(function (t) {
      var n = alerts.filter(function (a) { return a.theme === t; }).length;
      if (n > max) max = n;
      return [t, n];
    });
    counts.forEach(function (p) {
      var b = el("div", "bar");
      b.appendChild(el("span", "", p[0]));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = Math.round((p[1] / max) * 100) + "%";
      track.appendChild(fill);
      b.appendChild(track);
      b.appendChild(el("span", "n", p[1]));
      frag3.appendChild(b);
    });
    bars.replaceChildren(frag3);

    var ul = $("sources");
    var frag4 = document.createDocumentFragment();
    (Array.isArray(data.sources) ? data.sources : []).forEach(function (s) {
      var li = el("li");
      var a = el("a", "", s.title);
      a.href = safeHref(s.href);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      li.appendChild(el("span", "site", s.site));
      frag4.appendChild(li);
    });
    ul.replaceChildren(frag4);
  }

  var lastChecked = null, lastOk = true, lastMsgBase = "";
  function status(ok, base) {
    lastOk = ok; lastMsgBase = base;
    var t = lastChecked ? hmsIn(lastChecked, currentZone()) : "";
    $("live-dot").className = "dot " + (ok ? "ok" : "err");
    setText("live-status", ok ? base + " " + t : base + " " + t + ")");
  }

  function load() {
    fetch("data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) {
        var parsed = JSON.parse(txt);
        if (txt !== lastJson) { lastJson = txt; data = parsed; render(); }
        lastChecked = new Date();
        status(true, "Updated live, checked");
      })
      .catch(function () {
        lastChecked = new Date();
        status(false, "Could not refresh, retrying (last checked");
      });
  }

  buildTzSelect();
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
