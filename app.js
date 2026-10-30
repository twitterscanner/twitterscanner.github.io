(function () {
  "use strict";
  var REFRESH_MS = 30000;
  var data = null;
  var lastJson = "";
  var confFilter = "All";
  var themeFilter = "All";

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function setText(id, t) { var e = $(id); if (e && e.textContent !== String(t)) e.textContent = String(t); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hms(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function tag(text, kind) { return el("span", "tag " + kind, text); }
  function dirTag(d) { return tag(d, d === "Up" ? "up" : d === "Down" ? "down" : "neutral"); }
  function confTag(c) { return tag(c, c === "Confirmed" ? "confirmed" : "unconfirmed"); }
  function safeHref(h) { return /^https?:\/\//i.test(h || "") ? h : "#"; }

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
    var alerts = Array.isArray(data.alerts) ? data.alerts : [];
    var count = function (d) { return alerts.filter(function (a) { return a.direction === d; }).length; };
    var themes = [];
    alerts.forEach(function (a) { if (themes.indexOf(a.theme) === -1) themes.push(a.theme); });
    if (themeFilter !== "All" && themes.indexOf(themeFilter) === -1) themeFilter = "All";

    setText("summary", data.summary || "");
    setText("netread-lead", (data.netRead && data.netRead.lead) || "");
    setText("netread-text", (data.netRead && data.netRead.text) || "");
    setText("m-total", alerts.length);
    setText("m-up", count("Up"));
    setText("m-down", count("Down"));
    setText("m-brent", (data.brent && data.brent.value) || "–");
    setText("m-brent-detail", (data.brent && data.brent.detail) || "");
    setText("m-scanned", data.lastScanned || "–");

    buttons("conf-filter", ["All", "Confirmed", "Unconfirmed"], confFilter, function (v) { confFilter = v; render(); });
    var body = $("log-body");
    var frag = document.createDocumentFragment();
    var shown = alerts.filter(function (a) { return confFilter === "All" || a.confidence === confFilter; });
    shown.forEach(function (a) {
      frag.appendChild(row([a.time, a.eventTime, a.headline, a.theme, dirTag(a.direction), confTag(a.confidence), a.source]));
    });
    if (!shown.length) { var tr = el("tr"); var td = el("td", "empty", "No alerts match."); td.colSpan = 7; tr.appendChild(td); frag.appendChild(tr); }
    body.replaceChildren(frag);

    buttons("theme-filter", ["All"].concat(themes), themeFilter, function (v) { themeFilter = v; render(); });
    var tbody = $("theme-body");
    var frag2 = document.createDocumentFragment();
    alerts.filter(function (a) { return themeFilter === "All" || a.theme === themeFilter; }).forEach(function (a) {
      frag2.appendChild(row([a.theme, a.time, a.eventTime, a.headline, dirTag(a.direction), confTag(a.confidence)]));
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

  function status(ok, msg) {
    $("live-dot").className = "dot " + (ok ? "ok" : "err");
    setText("live-status", msg);
  }

  function load() {
    fetch("data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) {
        var parsed = JSON.parse(txt);
        if (txt !== lastJson) { lastJson = txt; data = parsed; render(); }
        status(true, "Updated live, checked " + hms(new Date()));
      })
      .catch(function () {
        status(false, "Could not refresh, retrying (last checked " + hms(new Date()) + ")");
      });
  }

  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
