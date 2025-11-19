const path = require('path');
const { readJson, writeJson, ensureDir } = require('./io');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');

const readCandidates = () => readJson(candidatesPath, []);

const writeCandidates = (candidates) => {
  ensureDir(path.dirname(candidatesPath));
  writeJson(candidatesPath, candidates);
  return candidates;
};

const findByStatus = (status) => {
  if (!status) return [];
  return readCandidates().filter((candidate) => candidate.status === status);
};

const updateCandidate = (id, updater) => {
  const candidates = readCandidates();
  const index = candidates.findIndex((candidate) => candidate.id === id);
  if (index === -1) {
    return { updated: null, candidates };
  }
  const current = candidates[index];
  const next =
    typeof updater === 'function'
      ? updater(current)
      : {
          ...current,
          ...updater,
        };
  candidates[index] = next;
  writeCandidates(candidates);
  return { updated: next, candidates };
};

const appendCandidate = (candidate) => {
  const candidates = readCandidates();
  candidates.push(candidate);
  writeCandidates(candidates);
  return candidate;
};

module.exports = {
  candidatesPath,
  readCandidates,
  writeCandidates,
  findByStatus,
  updateCandidate,
  appendCandidate,
};
