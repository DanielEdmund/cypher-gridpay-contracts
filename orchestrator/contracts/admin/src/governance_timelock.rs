//! orchestrator/contracts/admin/src/governance_timelock.rs
//!
//! Timelocked Parameter Governance Queue with Guardian Veto Windows.

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol};

pub const MIN_TIMELOCK_DELAY_LEDGERS: u64 = 34_560; // 48 hours

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Queued,
    Executed,
    Vetoed,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GovernanceProposal {
    pub proposal_id: u64,
    pub proposer: Address,
    pub action_symbol: Symbol,
    pub payload_hash: BytesN<32>,
    pub eta_ledger: u64,
    pub status: ProposalStatus,
}
