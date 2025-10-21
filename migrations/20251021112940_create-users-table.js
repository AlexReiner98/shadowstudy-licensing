/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('users', tbl => {
    tbl.increments() // 'id' field
    tbl.text('email',128)
        .notNullable()
        .unique()
    tbl.timestamps(true,true)
  })
  .createTable('subscriptions', tbl => {
    tbl.increments() //id field
    tbl.timestamps(true,true)
    tbl.text('product_name')
        .notNullable()
        .defaultTo('shadow-study')
    tbl.integer('seat_count')
        .notNullable()
        .defaultTo(1)
    
    // foreign key to users table
    tbl.integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
  })
  .createTable('activations', tbl => {
    tbl.increments() //id field
    tbl.timestamps(true,true)
    tbl.text('machine_key_hash')
        .notNullable()
        .unique()
    
    // foreign key to subscriptions table
    tbl.integer('subscription_id') 
        .unsigned()
        .references('id')
        .inTable('subscriptions')
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
  .dropTableIfExists('users')
  .dropTableIfExists('subscriptions')
  .dropTableIfExists('activations');
};
