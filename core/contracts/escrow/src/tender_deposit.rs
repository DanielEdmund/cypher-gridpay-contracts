//! core/contracts/escrow/src/tender_deposit.rs
//!
//! Sealed-Bid Tender Deposit Escrow with Atomic Loser Refund & Winner Conversion.

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TenderStatus {
    Open,
    Revealing,
    Finalized,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TenderBid {
    pub bidder: Address,
    pub deposit_amount: i128,
    pub bid_hash: BytesN<32>,
    pub revealed: bool,
    pub actual_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TenderAuction {
    pub tender_id: u64,
    pub creator: Address,
    pub min_deposit: i128,
    pub reveal_deadline: u64,
    pub status: TenderStatus,
    pub winner: Option<Address>,
}
