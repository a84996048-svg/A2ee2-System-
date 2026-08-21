const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'database.json');

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    const initial = {
      access: [],
      points: {},
      warnings: {},
      logs: []
    };

    fs.writeFileSync(dataFile, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDatabase() {
  ensureDataFile();
  const raw = fs.readFileSync(dataFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { access: [], points: {}, warnings: {}, logs: [] };
  }
}

function writeDatabase(data) {
  ensureDataFile();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAccessUsers() {
  const db = readDatabase();
  return Array.isArray(db.access) ? db.access : [];
}

function addAccessUser(userId) {
  const db = readDatabase();
  const set = new Set((db.access || []).map(String));
  set.add(String(userId));
  db.access = [...set];
  writeDatabase(db);
  return db.access;
}

function removeAccessUser(userId) {
  const db = readDatabase();
  db.access = (db.access || []).filter((id) => String(id) !== String(userId));
  writeDatabase(db);
  return db.access;
}

function getUserPoints(userId) {
  const db = readDatabase();
  return Number(db.points?.[String(userId)] || 0);
}

function setUserPoints(userId, value) {
  const db = readDatabase();
  db.points = db.points || {};
  db.points[String(userId)] = Number(value);
  writeDatabase(db);
  return Number(db.points[String(userId)]);
}

function addUserPoints(userId, change) {
  const previous = getUserPoints(userId);
  const next = Math.max(0, previous + Number(change));
  setUserPoints(userId, next);
  return { previous, next };
}

function removeUserData(userId) {
  const db = readDatabase();
  delete db.points[String(userId)];
  writeDatabase(db);
}

function getTopUsers() {
  const db = readDatabase();
  const entries = Object.entries(db.points || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([userId, value]) => ({ userId, points: Number(value) }));

  return entries.sort((a, b) => b.points - a.points);
}

function getWarnings(userId) {
  const db = readDatabase();
  db.warnings = db.warnings || {};
  return Array.isArray(db.warnings[String(userId)]) ? db.warnings[String(userId)] : [];
}

function addWarning(userId, reason) {
  const db = readDatabase();
  db.warnings = db.warnings || {};
  const key = String(userId);
  db.warnings[key] = [...getWarnings(key), { reason, createdAt: new Date().toISOString() }];
  writeDatabase(db);
  return db.warnings[key];
}

module.exports = {
  getAccessUsers,
  addAccessUser,
  removeAccessUser,
  getUserPoints,
  setUserPoints,
  addUserPoints,
  removeUserData,
  getTopUsers,
  getWarnings,
  addWarning,
  readDatabase
};
