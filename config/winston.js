const chalk = require('chalk');
const winston = require('winston');

const buildConfig = function (logfile) {
  const consoleTransportConfig = {
    timestamp: function () {
      return new Date().toISOString();
    },
    formatter: function (opts) {
      return opts.timestamp() + ' ' + chalk.cyan(opts.level.toUpperCase()) + ' ' + chalk.yellow(opts.message) + (opts.meta && Object.keys(opts.meta).length ? '\n\t' + JSON.stringify(
        opts.meta) : '');
    },
  };
  const consoleTransport = new(winston.transports.Console)(consoleTransportConfig);

  const fileTransportConfig = {
    dirname: `${__dirname}/../logs`,
    filename: `${logfile}.log`,
    maxsize: 1 * 1024 * 1024, // in bytes
    maxFiles: 7,
    tailable: true,
    json: false,
    timestamp: function () {
      return new Date().toISOString();
    },
    formatter: function (opts) {
      // Return string will be passed to logger.
      return opts.timestamp() + ' ' + opts.level.toUpperCase() + ' ' +
        (undefined !== opts.message ? opts.message : '') +
        (opts.meta && Object.keys(opts.meta).length ? '\n\t' + JSON.stringify(opts.meta) : '');
    },
  };
  const fileTransport = new(winston.transports.File)(fileTransportConfig);

  const loggerConfig = {
    level: 'debug',
    transports: [
      consoleTransport,
      fileTransport,
    ],
    /*
    filters:   [
      function (level, msg, meta) {
        const current_date = new Date().toISOString();
        return current_date + ' ' + level.toUpperCase() + ' ' + msg;
      }
    ],
    */
  };

  return loggerConfig;
};

exports.buildConfig = buildConfig;
