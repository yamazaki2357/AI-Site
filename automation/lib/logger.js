const formatMessage = (scope, message) => {
  if (typeof message === 'string') {
    return scope ? `[${scope}] ${message}` : message;
  }
  return scope ? `[${scope}]` : '';
};

const createLogger = (scope) => {
  const logWith = (method) => (message, ...rest) => {
    const prefix = formatMessage(scope, message);
    if (typeof message === 'string') {
      console[method](prefix, ...rest);
    } else {
      console[method](prefix, message, ...rest);
    }
  };

  return {
    info: logWith('log'),
    warn: logWith('warn'),
    error: logWith('error'),
    debug: logWith('debug'),
    success: logWith('log'),
  };
};

module.exports = {
  createLogger,
};
