# Payment Channel Watchtower & Cosigner Aggregator Service

Cypher GridPay implements high-throughput bidirectional off-chain payment and streaming channels (`core/contracts/payment/src/channels.rs`, `test_payment_channel.rs`, `test_streaming_channel.rs`). To ensure fairness when participants disconnect or go offline, an automated Watchtower service defends channel participants against fraudulent settlement of outdated state.

---

## 1. Threat Model & Challenge Window Slashing

### The Malicious Outdated Settlement Attack
1. Alice (customer) and Bob (merchant) open a channel with 100 USDC each (Initial State: `seq=0, A=100, B=100`).
2. Over multiple micro-payments, the channel progresses off-chain to State `seq=10, A=20, B=180`.
3. Alice disconnects or goes offline.
4. Alice maliciously broadcasts State `seq=0` to the on-chain contract to reclaim 100 USDC instead of her honest 20 USDC balance.
5. The contract enters a mandatory **Dispute Challenge Window** (e.g. 1,000 ledgers / ~83 minutes).

### Watchtower Defense & Counter-Proof Submission
1. Bob's client continuously synchronizes blinded channel commitments with the Watchtower service whenever state increments.
2. The Watchtower monitors on-chain channel events (`ChannelDisputeOpened`, `ChannelSettlementInitiated`).
3. Upon detecting a dispute with sequence $0 < 10$, the Watchtower extracts the counterparty signature from its database and submits `counter_dispute_channel(channel_id, seq=10, state, signatures)` before the challenge window elapses.
4. **Sequence-Number Slashing**: The contract verifies the higher sequence number, awards the full remaining balance plus Alice's slashed collateral stake to Bob, and closes the channel.

---

## 2. Blinded Storage & Locator Indexing

To protect customer privacy and prevent the Watchtower from spying on balances:
- **State Locator**: The watchtower indexes states using `locator = sha256(channel_id || sequence_number)[0..16]`.
- **Encrypted Blob**: The channel state is encrypted with a key derived from the breach transaction ID. The watchtower cannot decrypt the channel state or observe payment amounts until an on-chain dispute reveals the tx hash.
- **Zero-Knowledge Breach Proof**: Upon observing the breach transaction hash on-chain, the Watchtower decrypts the payload, reveals the latest state, and broadcasts the penalty transaction.

---

## 3. Cosigner Aggregator Service

For multi-party channels (e.g. multi-tenant energy microgrids):
- Collects and aggregates Ed25519 threshold signatures across microgrid participant nodes.
- Validates quorum weights before persisting off-chain streaming channel snapshots.
