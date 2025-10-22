const knex = require('knex');
const knexfile = require('./knexfile');
const environment = process.env.NODE_ENV;
const config = knexfile[environment];

module.exports = knex(config);