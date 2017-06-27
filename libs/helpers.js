const _ = require('lodash');
const chalk = require('chalk');
const winston = require('winston');
const slug = require('slug');
const debug = require('debug')('helpers');
const graph = require('../config/graph.js');
const Config = require('../config/config.js');
const winstonConfig = require('../config/winston');
const mediaIdWhitelistConfig = require('../config/media_id_whitelist');

const insertUserQuery = `
  INSERT INTO public.users
  (id, nombre, chilean)
  VALUES
  ($1, $2, $3)
  ON CONFLICT (id) DO UPDATE
  SET
    nombre = $2
`;

/**
 * Utility functions and contacts, grouped in an object
 * @type {Object}
 */
const Helpers = {
  tini: new Date(),

  get tini_time() {
    return this.tini.getTime();
  },

  /**
   * Transform a Date object to text in format YYYY-MM-DD hh:mm:ss
   * @param  {Date} date Date object
   * @return {string} text in format YYYY-MM-DD hh:mm:ss
   */
  dateToNiceText: function (date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    var date_nice = date.toISOString().split(/[T|\.]/);
    date_nice = date_nice[0] + ' ' + date_nice[1];
    return date_nice;
  },

  /**
   * Builds the query that retrieves which posts to update based in passed in parameters
   * @param  {Array} idMedios             [description]
   * @param  {integer} limit                [description]
   * @param  {integer} offset               [description]
   * @param  {integer} created_since        bring posts created since at most <created_since> days ago
   * @param  {integer} created_until        bring posts created at least <created_until> days ago
   * @param  {integer} updated_until        bring posts updated at least <updated_until> days ago
   * @param  {integer} diagnosis_until      calculates the total post that would result if using <diagnosis_until> instead of <updated_until>
   * to provide a reference of the post backlog.
   * @param  {boolean} without_interactions if true, then it will only consider posts without reactions OR without comments
   * @param  {integer} post_id  if specified, then it will return said post only
   * @return {string} the query to execute
   */
  buildPostQuery: function (idMedios, limit, offset, created_since, created_until, updated_until, diagnosis_until, without_interactions, post_id) {
    const createdSince = Math.ceil(created_since * 24); // in hours
    const createdUntil = created_until * 24; // in hours
    const updatedUntil = updated_until * 24; // in hours
    const diagnosisUntil = diagnosis_until * 24; // in hours

    var post_query;

    post_query =
      `
    SELECT
      id,
      id_medio,
      created_time,
      message AS name,
      
      `;

    if ((/^\d+_\d+$/).test(post_id)) {
      debug('will retrieve only post ', post_id);
      var post_medio = post_id.split('_'),
        id_post = post_medio[1],
        medio_id = post_medio[0];
      post_query +=
        ` 
      round(EXTRACT(epoch FROM updated_time))::text AS since,
      100 as max_sugerido
      FROM
      public.posts 
      WHERE id = ${id_post}::bigint
      AND id_medio=${medio_id}::bigint`;
    } else {

      post_query +=
        ` 
      url AS since,`;

      if (without_interactions) {
        post_query += `${limit} as max_sugerido `;
      } else {
        post_query += `round((SELECT count(*) from main.get_posts_to_update(${createdSince}, ${createdUntil}, ${diagnosisUntil} ))/8) as max_sugerido `;
      }

      post_query += `FROM
      main.get_posts_to_update(${createdSince}, ${createdUntil}, ${updatedUntil} )
      `;

      if (idMedios.length === 1) {
        const id_medio = idMedios[0];
        post_query += ` 
        WHERE id_medio=${id_medio}
        `;
        if (without_interactions) {
          post_query += ` 
        AND (reactions = -1 OR comments = -1) 
        `;
        }
      } else {
        post_query +=
          ` 
        JOIN (SELECT unnest(ARRAY[${idMedios.join(',')}]) as medios_id) medios  ON medios.medios_id=id_medio
       `;
        if (without_interactions) {
          post_query += ` 
        WHERE (reactions = -1 OR comments = -1) 
        `;
        }
      }
      //id_medio IN (${idMedios.join(',')})

      post_query += `
    ORDER BY updated_time, created_time DESC

    LIMIT ${limit}
    OFFSET ${offset}
    `;
    }
    debug('post_query', post_query);

    return post_query;
  },

  /* beautify preserve:start */
  createLogger: function (logfile) {
    const loggerConfig = winstonConfig.buildConfig(logfile);
    const logger = new (winston.Logger)(loggerConfig);

    return logger;
  },
  /* beautify preserve:end */

  filter_id_medio: function (id_medio) {
    const filter = function (medio) {
      return String(medio.id_medio) === String(id_medio);
    };
    return filter;
  },

  filter_categoria: function (schema) {
    const filter = function (medio) {
      return medio.schema === schema;
    };
    return filter;
  },

  filter_updated_time: function (time_ago) {
    const tini_time = this.tini_time;
    const filter = function (medio) {
      time_ago = time_ago || 300;
      if (!medio.updated_time) {
        medio.updated_time = 1100000000;
      }
      const seconds_since_update = parseInt(tini_time / 1000, 10) - medio.updated_time;

      if (!medio.is_active) {
        debug(chalk.red('Rejecting ') + chalk.yellow(medio.name) + ' ' + chalk.red('is not active'));
      }

      return medio.is_active && (seconds_since_update > time_ago);
    };
    return filter;
  },

  filterByActiveMedio: function (medio) {
    return (medio.is_active === true);
  },

  /*
  Rejects Medios that have a Local percentage lower than the threshold.
  OR have a predominant fanbase origin different than the COUNTRY parameter
  Filter must return TRUE in order to ACCEPT a Medio.
  */
  filterByLocalPercentage: function (medio, percentage) {
    let localPercentage = Infinity;

    if (_.isFinite(medio.local_percentage)) {
      localPercentage = medio.local_percentage;
    } else if (_.isFinite(medio.mediumOptions.local_percentage)) {
      localPercentage = medio.mediumOptions.local_percentage;
    }
    var mediumCountry;
    if (medio.mediumOptions) {
      mediumCountry = medio.country || medio.mediumOptions.country;
    } else {
      mediumCountry = medio.country;
    }

    /*debug('filterByLocalPercentage', {
      localPercentage: localPercentage,
      'mediumCountry': mediumCountry,
      'Config.Country': Config.Country
    });*/
    return (localPercentage >= percentage && mediumCountry === Config.Country);
  },

  /*
  Rejects Medios that are not in the whitelist.

  Filter must return TRUE in order to ACCEPT a Medio.
  */
  filterByMediaIdWhitelist: function (medio) {
    return _.includes(mediaIdWhitelistConfig, parseInt(medio.id_medio, 10));
  },

  getNewDatetime: function (timestamp) {
    return (new Date(timestamp).toISOString()).split('T').join(' ').replace('Z', '+00');
  },

  /**
   * Prepared statement to insert user
   * @param  {transaction} t     transaction, provided by pg-promise
   * @param  {numeric} user_id   [description]
   * @param  {string} user_name [description]
   * @return {void}           [description]
   */
  user_insertion: function (t, user_id, user_name) {
    const isChilean = null; // `users.chilean` attribute is deprecated

    return t.none({
      name: 'prepared_users',
      text: insertUserQuery,
      values: [user_id, user_name, isChilean],
    });
  },

  normalize_tendencia: function (tendencia) {
    let tendencia_normalizada = String(tendencia).toLowerCase();
    if (['blanco', 'derecha', 'izquierda'].indexOf(tendencia_normalizada) === -1) {
      tendencia_normalizada = 'blanco';
    }
    return tendencia_normalizada;
  },

  normalize_categoria: function (categoria) {
    return slug(categoria || '', {
      replacement: '_',
      lower: true
    }) || null;
  },

  stringToTableName: function (string) {
    return slug(string || '', {
      replacement: '_',
      lower: true
    });
  },

  /**
   * Method for cleaning special chars
   * @param  {String} str   source string
   * @return {String}        Clean string
   */
  cleanString: function (str) {
    let cleanstr = String(str).replace(/[,.\-& ]/g, '_');
    cleanstr = cleanstr.replace(/"/g, '');
    cleanstr = cleanstr.replace(/[ÀÁÂÃÄÅ]/g, "A");
    cleanstr = cleanstr.replace(/[àáâãäå]/g, "a");
    cleanstr = cleanstr.replace(/[ÈÉÊË]/g, "E");
    cleanstr = cleanstr.replace(/[é]/g, "e");
    cleanstr = cleanstr.replace(/[Í]/g, "I");
    cleanstr = cleanstr.replace(/[í]/g, "i");
    cleanstr = cleanstr.replace(/[Ó]/g, "O");
    cleanstr = cleanstr.replace(/(ó|ó)/g, "o");
    cleanstr = cleanstr.replace(/[Ú]/g, "U");
    cleanstr = cleanstr.replace(/[ú]/g, "u");
    cleanstr = cleanstr.replace(/[Ñ]/g, "N");
    cleanstr = cleanstr.replace(/[ñ]/g, "n");
    cleanstr = cleanstr.replace(/(__)+/g, '_');

    cleanstr = cleanstr.replace(/\'/g, '');
    return cleanstr;
  },
}; // end of Helpers

module.exports = Helpers;
