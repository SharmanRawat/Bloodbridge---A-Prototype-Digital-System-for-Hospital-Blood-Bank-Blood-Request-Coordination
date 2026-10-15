// Shared helpers for BloodBridge pages.
// - escapeHtml: safe HTML escaping for any value interpolated into innerHTML
// - authHeaders: returns request headers including the signed session token
// - getDeliveryToken: reads the ?t= delivery token from the URL (rider links)
(function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  window.escapeHtml = function (value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  window.getAuthToken = function () {
    return localStorage.getItem('token') || '';
  };

  window.authHeaders = function (extra) {
    var headers = Object.assign({}, extra || {});
    var token = window.getAuthToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  };

  window.getDeliveryToken = function () {
    try {
      return new URLSearchParams(window.location.search).get('t') || '';
    } catch (e) {
      return '';
    }
  };
})();
