const normalizeTagToken = (value) => {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

module.exports = {
  normalizeTagToken,
};
