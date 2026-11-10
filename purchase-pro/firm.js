// APPACHI JEWELLERY PVT LTD — the only company in Purchase Pro.
// Started 22/04/2026: nothing can be dated before that.
const FIRM_GSTIN = '33ABFCA2567H1ZS';
const FIRM_START = '2026-04-22';
const beforeStart = (date) => !!date && String(date) < FIRM_START;
const START_MSG = 'APPACHI JEWELLERY PVT LTD started on 22/04/2026 — the date can\'t be before that.';
module.exports = { FIRM_GSTIN, FIRM_START, beforeStart, START_MSG };
