/* ==========================================================================
   BloodBridge – Hospital Module Helpers
   --------------------------------------------------------------------------
   Loaded by hospital.html and exposed as `window.BBHospital`. This file
   does NOT call any new backend endpoints — it only post-processes the
   response that the existing /api/hospital/request call already returns.

   Responsibilities:
     1. Browser geolocation (navigator.geolocation) for the hospital's
        current position, with a safe demo fallback if denied/unavailable.
     2. Resolving each blood bank's coordinates — uses real lat/lng from
        the API response if present, otherwise generates a realistic,
        STABLE demo coordinate (per the approved plan: "use realistic
        demo coordinates for the existing demo hospitals and blood banks"
        when the API doesn't supply coordinates yet).
     3. Haversine distance calculation.
     4. Sorting blood banks nearest-first.
     5. Building a Google Maps "Directions" URL.
     6. Initializing/updating a Leaflet map with hospital + bank markers.
   ========================================================================== */

(function () {
  'use strict';

  // --------------------------------------------------------------------
  // Demo coordinate fallback
  // --------------------------------------------------------------------
  // Used ONLY when a bank object from the API does not include real
  // latitude/longitude fields. Centered on Vadodara, Gujarat as a
  // representative demo region for this project's demo data.
  // Coordinates are derived deterministically from bankId/bankName so
  // the SAME bank always lands at the SAME point — distances and sort
  // order stay stable across searches/reloads instead of jumping around.
  var DEMO_CENTER = { lat: 22.3072, lng: 73.1812 }; // Vadodara, Gujarat

  // A few realistic named fallbacks in case any demo banks share these
  // common names — gives nicer, spread-out demo locations on the map.
  console.log("hospital.js loaded");
  var KNOWN_DEMO_BANKS = {
    'gmers gotri': { lat: 22.313792, lng: 73.148075 },
    'red cross vadodara': { lat: 22.310654, lng: 73.179436 },
    'ssg blood bank vadodara': { lat: 22.306185, lng: 73.190746 },
  'gmers blood bank': { lat: 22.313792, lng: 73.148075 },
  'red cross blood bank': { lat: 22.310654, lng: 73.179436 },
  'ssghospital blood bank': { lat: 22.306185, lng: 73.190746 },
    'gmers blood bank': { lat: 22.313792, lng: 73.148075 },
    'red cross blood bank': { lat: 22.310654, lng: 73.179436 },
    'civil hospital blood bank': { lat: 23.048797, lng: 72.608350 },
    'dhwani blood bank': { lat: 22.305811, lng: 73.185041 },
    'indu blood bank': { lat: 22.304108, lng: 73.193499 },
    'ssghospital blood bank': { lat: 22.306185, lng: 73.190746 }
  };

  function hashStringToInt(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // force 32-bit int
    }
    return Math.abs(hash);
  }

  function getDemoCoordsForBank(bank) {
    var key = String(bank.bankName || '').trim().toLowerCase();
	console.log("Bank Name From API:", key);
    for (const bankKey in KNOWN_DEMO_BANKS) {
      console.log("Comparing with:", bankKey);
    if (key.includes(bankKey) || bankKey.includes(key)) {
      console.log("MATCH FOUND:", bankKey);
        return KNOWN_DEMO_BANKS[bankKey];
    }
}
console.log("NO MATCH FOUND FOR:", key);

    // Deterministic pseudo-random point, 2km - 25km from the demo
    // center, based on a hash of the bank's id/name.
    var seed = hashStringToInt(String(bank.bankId != null ? bank.bankId : key));
    var angle = (seed % 360) * (Math.PI / 180);
    var radiusKm = 2 + (seed % 23);
    var dLat = (radiusKm / 111) * Math.cos(angle);
    var dLng =
      (radiusKm / (111 * Math.cos((DEMO_CENTER.lat * Math.PI) / 180))) *
      Math.sin(angle);

    return { lat: DEMO_CENTER.lat + dLat, lng: DEMO_CENTER.lng + dLng };
  }

  // --------------------------------------------------------------------
  // Coordinate resolution (real API data first, demo fallback second)
  // --------------------------------------------------------------------
  function resolveBankCoords(bank) {
    var realLat = bank.latitude != null ? bank.latitude
                : bank.lat != null ? bank.lat
                : bank.bank_lat != null ? bank.bank_lat
                : null;
    var realLng = bank.longitude != null ? bank.longitude
                : bank.lng != null ? bank.lng
                : bank.lon != null ? bank.lon
                : bank.bank_lng != null ? bank.bank_lng
                : null;

    if (realLat != null && realLng != null && realLat !== 0 && realLng !== 0) {
        return { lat: realLat, lng: realLng, isDemo: false };
    }

    var demo = getDemoCoordsForBank(bank);
    return { lat: demo.lat, lng: demo.lng, isDemo: true };
  } 
  // --------------------------------------------------------------------
  // Haversine distance calculation (returns kilometers)
  // --------------------------------------------------------------------
  function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Earth's mean radius in km
    var toRad = function (deg) { return (deg * Math.PI) / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --------------------------------------------------------------------
  // Browser geolocation
  // --------------------------------------------------------------------
  // Resolves with the hospital's current { lat, lng, isDemo }. Never
  // rejects — if permission is denied, the browser doesn't support
  // geolocation, or it times out, it resolves with the demo center so
  // the rest of the flow (map + distances) keeps working.
  function getHospitalLocation() {
    return new Promise(function (resolve) {
      if (!('geolocation' in navigator)) {
        resolve({ lat: DEMO_CENTER.lat, lng: DEMO_CENTER.lng, isDemo: true });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, isDemo: false });
        },
        function () {
          // Permission denied / unavailable / timeout
          resolve({ lat: DEMO_CENTER.lat, lng: DEMO_CENTER.lng, isDemo: true });
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  // --------------------------------------------------------------------
  // Enrich banks with distance + sort nearest-first
  // --------------------------------------------------------------------
  function enrichAndSortBanks(banks, hospitalLoc) {
    return banks
      .map(function (bank) {
        var coords = resolveBankCoords(bank);
        var distance = haversineDistanceKm(hospitalLoc.lat, hospitalLoc.lng, coords.lat, coords.lng);
        var enriched = {};
        for (var k in bank) { if (Object.prototype.hasOwnProperty.call(bank, k)) enriched[k] = bank[k]; }
        enriched.distance = distance;
        enriched._lat = coords.lat;
        enriched._lng = coords.lng;
        enriched._isDemoLocation = coords.isDemo;
        return enriched;
      })
      .sort(function (a, b) { return a.distance - b.distance; });
  }

  // --------------------------------------------------------------------
  // Google Maps directions URL
  // --------------------------------------------------------------------
  function buildDirectionsUrl(destLat, destLng, originLat, originLng) {
    var url = 'https://www.google.com/maps/dir/?api=1&destination=' + destLat + ',' + destLng;
    if (typeof originLat === 'number' && typeof originLng === 'number') {
      url += '&origin=' + originLat + ',' + originLng;
    }
    return url;
  }

  // --------------------------------------------------------------------
  // Leaflet map
  // --------------------------------------------------------------------
  var map = null;
  var markersLayer = null;

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function initMap(containerId, hospitalLoc) {
    if (typeof L === 'undefined') return null; // Leaflet failed to load

    if (map) {
      map.remove();
      map = null;
      markersLayer = null;
    }

    map = L.map(containerId, { scrollWheelZoom: false }).setView([hospitalLoc.lat, hospitalLoc.lng], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // Fixes Leaflet sizing issues when the container becomes visible
    // right before/at the same time the map is created.
    setTimeout(function () { if (map) map.invalidateSize(); }, 150);

    return map;
  }

  function plotBanks(banks, hospitalLoc) {
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();

    var hospitalIcon = L.icon({
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    });

    L.marker([hospitalLoc.lat, hospitalLoc.lng], { icon: hospitalIcon })
      .addTo(markersLayer)
      .bindPopup(
        '<strong>Your Location</strong>' +
        (hospitalLoc.isDemo ? '<br><small>(demo location)</small>' : '')
      );

    var bounds = [[hospitalLoc.lat, hospitalLoc.lng]];

    banks.forEach(function (bank) {
      var marker = L.marker([bank._lat, bank._lng]).addTo(markersLayer);
      var dirUrl = buildDirectionsUrl(bank._lat, bank._lng, hospitalLoc.lat, hospitalLoc.lng);
      marker.bindPopup(
        '<strong>' + escapeHtml(bank.bankName) + '</strong><br>' +
        bank.distance.toFixed(1) + ' km away<br>' +
        bank.unitsAvailable + ' units available<br>' +
        '<a href="' + dirUrl + '" target="_blank" rel="noopener">Get Directions</a>'
      );
      bounds.push([bank._lat, bank._lng]);
    });

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    } else {
      map.setView([hospitalLoc.lat, hospitalLoc.lng], 12);
    }
  }

  // --------------------------------------------------------------------
  // Public API used by hospital.html
  // --------------------------------------------------------------------
  window.BBHospital = {
    getHospitalLocation: getHospitalLocation,
    enrichAndSortBanks: enrichAndSortBanks,
    haversineDistanceKm: haversineDistanceKm,
    buildDirectionsUrl: buildDirectionsUrl,
    initMap: initMap,
    plotBanks: plotBanks
  };
})();