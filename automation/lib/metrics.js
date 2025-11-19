const average = (values) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / values.length);
};

const createMetricsTracker = (scope = 'metrics') => {
  const counters = new Map();
  const timings = new Map();

  const increment = (key, amount = 1) => {
    const next = (counters.get(key) || 0) + amount;
    counters.set(key, next);
    return next;
  };

  const set = (key, value) => {
    counters.set(key, value);
    return value;
  };

  const recordDuration = (key, duration) => {
    if (!timings.has(key)) {
      timings.set(key, []);
    }
    timings.get(key).push(duration);
    return duration;
  };

  const startTimer = (key) => {
    const start = Date.now();
    return () => recordDuration(key, Date.now() - start);
  };

  const getCounter = (key) => counters.get(key) || 0;

  const getTimings = (key) => timings.get(key) || [];

  const summary = () => {
    const timingSummary = {};
    timings.forEach((values, key) => {
      if (!values.length) return;
      timingSummary[key] = {
        count: values.length,
        avg: average(values),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });

    return {
      scope,
      counters: Object.fromEntries(counters),
      timings: timingSummary,
    };
  };

  return {
    increment,
    set,
    startTimer,
    recordDuration,
    getCounter,
    getTimings,
    summary,
  };
};

module.exports = {
  average,
  createMetricsTracker,
};
