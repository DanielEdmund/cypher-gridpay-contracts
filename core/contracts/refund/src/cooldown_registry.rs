//! core/contracts/refund/src/cooldown_registry.rs
//!
//! Arbitrator Conflict-of-Interest Cooldown Registry preventing repeat-pair collusion.

use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitratorCooldown {
    pub arbitrator: Address,
    pub merchant: Address,
    pub last_dispute_id: u64,
    pub cooldown_until_ledger: u64,
    pub total_disputes_handled: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct JurisdictionRefundFloor {
    pub jurisdiction_code: u32,
    pub min_refund_window_seconds: u64,
    pub min_refund_percentage_bps: u32,
    pub active: bool,
}
