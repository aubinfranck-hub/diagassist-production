/* Publicité locale discrète : affiche l'annonce d'un commerce partenaire, ou rien s'il n'y en a pas. */
(function () {
  var zones = document.querySelectorAll("[data-pub-slot]");
  Array.prototype.forEach.call(zones, function (zone) {
    fetch("/api/pub/ads?slot=" + encodeURIComponent(zone.getAttribute("data-pub-slot")), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ad) return;
        var a = document.createElement("a");
        a.className = "pub-card";
        a.href = d.ad.goUrl;
        a.target = "_blank";
        a.rel = "sponsored noopener noreferrer";
        a.setAttribute("aria-label", "Publicité : " + d.ad.advertiser);
        var label = document.createElement("span");
        label.className = "pub-label";
        label.textContent = "Publicité";
        var img = document.createElement("img");
        img.src = d.ad.imageUrl;
        img.alt = d.ad.advertiser;
        img.loading = "lazy";
        a.appendChild(label);
        a.appendChild(img);
        zone.appendChild(a);
      })
      .catch(function () {});
  });
})();
