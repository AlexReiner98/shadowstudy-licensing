/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
  
  //users table (contains emails that represent users, ties together activations, licenses and tokens)
  .createTable('users', tbl => {
    tbl.increments() // 'id' field
    tbl.text('email',128)
        .notNullable()
        .unique()
    tbl.timestamps(true,true)
  })

  .createTable('subscriptions', tbl => {
    tbl.increments() //id field
    tbl.timestamps(true,true)
    tbl.text('status')
        .notNullable()
    tbl.integer('seats')
        .notNullable()
        .defaultTo(1)
    
    //foreign key to users
    tbl.integer('user_id') 
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
  })

  //activations table (contains device id used to validate user identity on plugin launch)
  .createTable('activations', tbl => {
    tbl.increments() //id field
    tbl.timestamps(true,true)
    tbl.text('device_id')
        .notNullable()
        .unique()
    
    // foreign key to users
    tbl.integer('user_id') 
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
  })

  //magic link table (contains temporary tokens to tie activation to user through email)
  .createTable('magic', tbl => {
    tbl.text('token')
      .notNullable()
      .unique()
    tbl.date('expires_at')
      .notNullable()
    tbl.date('used_at')
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
  .dropTableIfExists('activations')
  .dropTableIfExists('magic');
};
