//! orchestrator/contracts/admin/src/escape_hatch.rs
//!
//! Protocol Escape-Hatch Recovery Mode guaranteeing self-custodial exit rights
//! if emergency pause exceeds maximum governance ceilings.

use soroban_sdk::{contracttype, Address, Env};

pub const MAX_PAUSE_CEILING_LEDGERS: u64 = 241_920; // ~14 days at 5s per ledger

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscapeState {
    Normal,
    Paused(u64), // Records pause onset ledger
    EscapeActive(u64), // Records escape activation ledger
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscapeClaim {
    pub claimant: Address,
    pub contract_id: Address,
    pub amount: i128,
    pub claimed_at_ledger: u64,
}
