// ════════════════════════════════════════════════════════════════
// Migration 004 — Blockchain Infrastructure
// Adds: blockchain_events, updates ventures + users with chain fields
// ════════════════════════════════════════════════════════════════

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // ── blockchain_events — immutable event log (mirrored from on-chain) ──
  await knex.schema.createTable('blockchain_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('event_type', 100).notNullable();
    t.string('tx_hash', 66);              // Ethereum/Polygon tx hash
    t.string('chain', 20).notNullable();  // ethereum | polygon | ipfs | off-chain
    t.string('contract_address', 42);
    t.jsonb('payload').notNullable().defaultTo('{}');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('venture_id').references('id').inTable('ventures').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['event_type']);
    t.index(['chain']);
    t.index(['user_id']);
    t.index(['venture_id']);
    t.index(['created_at']);
  });

  // ── Add blockchain columns to ventures ──
  await knex.schema.table('ventures', (t) => {
    t.string('score_hash', 66);         // Polygon IkonetUScore.sol commitment
    t.string('score_hash_tx', 66);      // tx hash
    t.string('score_hash_chain', 20);   // 'polygon'
    t.string('merkle_root', 66);        // Ethereum document Merkle root
    t.string('merkle_tx', 66);
    t.string('merkle_chain', 20);
  });

  // ── Add blockchain/DID columns to users ──
  await knex.schema.table('users', (t) => {
    t.string('did', 200);               // W3C DID: did:ethr:polygon:0x...
    t.string('did_document_ipfs', 100); // IPFS CID of DID document
    t.string('did_hash', 66);           // SHA-256 of DID document
    t.string('did_tx', 66);             // Ethereum tx hash of DID anchor
    t.string('did_chain', 20);          // 'ethereum'
    t.string('wallet_address', 42);     // Optional user wallet (for threat screening)
  });

  // ── Add escrow columns to marketplace_bookings ──
  await knex.schema.table('marketplace_bookings', (t) => {
    t.string('escrow_tx', 66);
    t.string('escrow_chain', 20);
    t.decimal('r12_commission', 10, 2);
    t.boolean('escrow_released').defaultTo(false);
    t.string('escrow_release_tx', 66);
  });

  // ── Add sha256 hash to venture_documents for Merkle leaves ──
  await knex.schema.table('venture_documents', (t) => {
    t.string('sha256_hash', 64);        // SHA-256 of document ciphertext
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('blockchain_events');
  await knex.schema.table('ventures', (t) => {
    t.dropColumns('score_hash', 'score_hash_tx', 'score_hash_chain', 'merkle_root', 'merkle_tx', 'merkle_chain');
  });
  await knex.schema.table('users', (t) => {
    t.dropColumns('did', 'did_document_ipfs', 'did_hash', 'did_tx', 'did_chain', 'wallet_address');
  });
  await knex.schema.table('marketplace_bookings', (t) => {
    t.dropColumns('escrow_tx', 'escrow_chain', 'r12_commission', 'escrow_released', 'escrow_release_tx');
  });
  await knex.schema.table('venture_documents', (t) => {
    t.dropColumn('sha256_hash');
  });
}
