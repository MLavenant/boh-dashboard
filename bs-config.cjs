/**
 * Bottle Service table sets + time windows — mirrors FP&A Excel methodology.
 *
 * Casa Neos Beach Club (regular): VIP floor + cabanas + dock, 2:30–8:00 PM
 * Casa Neos Beach Club MM Rooftop (Aug 1 – Sep 30): rooftop VIP + bar M* + dock,
 *   same 2:30–8:00 PM window — from
 *   "Bottle Service - Beach Club Sales Moved to MM Rooftop.xlsx"
 */
'use strict';

const CASA_NEOS_BEACH_TABLES = new Set([
  '34','51','52','31','41','32','33','35','36','42','43','46','48','49',
  '53','54','55','56','45','44','47','24','25','26','27','28','19','20',
  '21','22','23','C1','C2','C3','C4','C5','C6','C7','C8','C9','C10',
  'C1A','C2A','C3A','C4A','C5A','C6A','C7A','C8A','C9A','C10A',
  'D1','D2','D3','D4','D5','D6','D7',
]);

/* Excel Bottle Service tab — Diamond/Prestige/Platinum/Gold + Bar M1–M15 + Dock D1–D7 */
const CASA_NEOS_ROOFTOP_TABLES = new Set([
  '61','63','81','83','73',           // Diamond
  '64','65','84','85','74',           // Prestige
  '66','68','76','75','88','86',      // Platinum
  '91','92','93','94',                // Gold
  'M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','M13','M14','M15',
  'D1','D2','D3','D4','D5','D6','D7',
]);

const BS_CONFIG = {
  casa_neos: {
    label: 'Casa Neos Beach Club',
    days: [6, 0], // Saturday, Sunday
    tables: CASA_NEOS_BEACH_TABLES,
    rooftopTables: CASA_NEOS_ROOFTOP_TABLES,
    /* Rooftop Excel totals include unassigned-table checks in the 2:30–8 PM window. */
    rooftopIncludeNoTable: true,
    startFrac: 0.604167, // 2:30 PM
    endFrac: 0.833333,   // 8:00 PM
    crossesMidnight: false,
  },
  mm_mila: {
    label: 'MILA Lounge',
    days: [3, 4, 5, 6],
    tables: new Set([
      '402','304','303','302','301','308','410','401','403','404','305','306',
      '307','408','408bis','407','405','409','406','1','2','3','4','5','6','7',
      '8','9','10','11','12','1A','2A','3A','4A','5A','6A','7A','8A','9A',
      '10A','11A','12A','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10',
      'S11','S12','S13','S14','S15','S16','S17','S18','S19','S20','S21',
      'S22','S23','S24','S25','S26','S27','S28','S29','S30','73',
    ]),
    startFrac: 0.979167,
    endFrac: 0.208333,
    crossesMidnight: true,
  },
  casa_neos_lounge: {
    label: 'Casa Neos Lounge',
    days: [4, 5, 6, 0],
    tables: new Set([
      '809','808','905','904','903','902','810','906','907','908','909','910',
      '911','912','901','807','806','805','804','803','L1','L2','L3','L4',
      'L5','L6','L7','L8','L9','L10','L11','L12','L1A','L2A','L3A','L4A',
      'L5A','L6A','L7A','L8A','L9A','L10A','L11A','L12A','44',
    ]),
    startFrac: 0.958333,
    endFrac: 0.208333,
    crossesMidnight: true,
    includeNoTable: true,
    sundayStartFrac: 0.75,
  },
};

/** Aug 1 – Sep 30 (inclusive): Beach Club bottle service uses MM Rooftop floor plan. */
function isCnbcSummerRoof(dateStr) {
  const parts = String(dateStr || '').split('-');
  if (parts.length < 2) return false;
  const m = +parts[1];
  return m >= 8 && m <= 9;
}

function getBsTables(venueKey, dateStr) {
  const cfg = BS_CONFIG[venueKey];
  if (!cfg) return new Set();
  if (venueKey === 'casa_neos' && isCnbcSummerRoof(dateStr) && cfg.rooftopTables) {
    return cfg.rooftopTables;
  }
  return cfg.tables;
}

/** Whether unassigned (no-table) checks count toward BS for this venue/date. */
function includeNoTable(venueKey, dateStr) {
  const cfg = BS_CONFIG[venueKey];
  if (!cfg) return false;
  if (venueKey === 'casa_neos' && isCnbcSummerRoof(dateStr) && cfg.rooftopIncludeNoTable) return true;
  return !!cfg.includeNoTable;
}

function isOperatingDay(venueKey, dateStr) {
  const cfg = BS_CONFIG[venueKey];
  if (!cfg || !cfg.days) return true;
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return cfg.days.includes(dow);
}

module.exports = {
  BS_CONFIG,
  CASA_NEOS_BEACH_TABLES,
  CASA_NEOS_ROOFTOP_TABLES,
  isCnbcSummerRoof,
  getBsTables,
  includeNoTable,
  isOperatingDay,
};
