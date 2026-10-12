/* report-data.js — shared by the /purchase/reports/* pages.
 *
 * The report lists don't depend on the on-page filters, so each one is
 * fetched once per page visit and every filter change re-filters locally
 * instead of re-downloading everything (each round trip to the DB is slow).
 */
(function () {
  "use strict";

  var cache = {};

  // GET a JSON list once per page visit. Rejects (instead of resolving with
  // an {error} object) on a failed response, and sends an expired session
  // back to login. A failed fetch is dropped from the cache so the next
  // filter change retries it.
  window.reportJson = function (url, companyId) {
    var key = (companyId || "") + " " + url;
    if (!cache[key]) {
      var opts = companyId ? { headers: { "X-Company-ID": companyId } } : undefined;
      cache[key] = fetch(url, opts).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r.status === 401) {
            window.location.replace("/purchase/login");
            throw new Error("Session expired");
          }
          if (!r.ok) throw new Error((body && body.error) || "HTTP " + r.status);
          return body;
        });
      });
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  };
  // Call after the page itself changes data (e.g. a delete) so the next
  // loadReport() fetches fresh lists.
  window.reportJson.clear = function () { cache = {}; };

  // Each loadReport() takes a token; if the user changes a filter again
  // while it awaits, the older load sees isLatest() === false and stops,
  // so a slow earlier response can't overwrite the newer result.
  var seq = 0;
  window.reportLoadToken = function () {
    var mine = ++seq;
    return { isLatest: function () { return mine === seq; } };
  };

  window.reportErrorRow = function (colspan, e) {
    console.error("Report load failed:", e);
    var msg = String((e && e.message) || e || "unknown error").replace(/[<&]/g, "");
    return '<tr><td colspan="' + colspan + '" class="empty-state" style="color:var(--danger);">' +
      "Error loading data — " + msg + ". Change a filter to retry.</td></tr>";
  };
})();
