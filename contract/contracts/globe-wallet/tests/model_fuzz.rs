//! Model-based fuzzing of globe-wallet invariants (issue #187).
//!
//! A plain-Rust reference model of the admin / guardian / recovery /
//! spend-limit state machine is driven side by side with the real contract
//! by random call sequences from random callers. After every call we assert:
//!
//! * the call succeeded on the contract iff the model says it should;
//! * the full observable state matches (admin, guardian list, recovery
//!   config + proposal, per-user limit and spent-today);
//! * the invariants listed in `contract/docs/invariants.md` hold.
//!
//! Case count comes from `PROPTEST_CASES` (CI: small and time-boxed; the
//! nightly job runs many more). Failing seeds are persisted by proptest in
//! `tests/model_fuzz.proptest-regressions` — commit that file so the seed is
//! replayed forever.

use globe_wallet::{AssetInfo, GlobeWallet, GlobeWalletClient, SPEND_LIMIT_INCREASE_DELAY_SECS};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

const ACTORS: usize = 6;
const LEDGERS_PER_DAY: u32 = 17_280;
const SECONDS_PER_DAY: u64 = 86_400;
const MAX_GUARDIANS: usize = 15;
const MIN_GUARDIANS_FOR_RECOVERY: usize = 3;
/// Rolling spend window (issue #177): hourly buckets, 24 h + one guard bucket.
const SPEND_BUCKET_SECONDS: u64 = 3_600;
const SPEND_WINDOW_BUCKETS: u64 = 25;

#[derive(Clone, Debug)]
enum Op {
    AddGuardian { caller: usize, guardian: usize },
    RemoveGuardian { caller: usize, guardian: usize },
    SetRecoveryConfig { caller: usize, threshold: u32, extra_delay: u32 },
    InitiateRecovery { guardian: usize, new_admin: usize },
    ApproveRecovery { guardian: usize },
    RevokeApproval { guardian: usize },
    ExecuteRecovery,
    CancelRecovery { caller: usize },
    ApplyGuardianChange,
    CancelGuardianChange { caller: usize },
    SetSpendLimit { user: usize, limit: i128 },
    RecordSpend { user: usize, amount: i128 },
    AdvanceLedgers(u32),
    AdvanceTime(u64),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    let a = 0..ACTORS;
    prop_oneof![
        (a.clone(), a.clone()).prop_map(|(caller, guardian)| Op::AddGuardian { caller, guardian }),
        (a.clone(), a.clone()).prop_map(|(caller, guardian)| Op::RemoveGuardian { caller, guardian }),
        (a.clone(), 0u32..6, prop_oneof![Just(0u32), 0u32..1_000])
            .prop_map(|(caller, threshold, extra_delay)| Op::SetRecoveryConfig { caller, threshold, extra_delay }),
        (a.clone(), a.clone()).prop_map(|(guardian, new_admin)| Op::InitiateRecovery { guardian, new_admin }),
        a.clone().prop_map(|guardian| Op::ApproveRecovery { guardian }),
        a.clone().prop_map(|guardian| Op::RevokeApproval { guardian }),
        Just(Op::ExecuteRecovery),
        a.clone().prop_map(|caller| Op::CancelRecovery { caller }),
        Just(Op::ApplyGuardianChange),
        a.clone().prop_map(|caller| Op::CancelGuardianChange { caller }),
        (a.clone(), prop_oneof![Just(0i128), -5i128..2_000]).prop_map(|(user, limit)| Op::SetSpendLimit { user, limit }),
        (a.clone(), -5i128..800).prop_map(|(user, amount)| Op::RecordSpend { user, amount }),
        // Kept below half a day so the keeper call made after every step
        // (`extend_user_ttl`) always catches entries before they archive.
        (1u32..LEDGERS_PER_DAY / 2).prop_map(Op::AdvanceLedgers),
        (1u64..SECONDS_PER_DAY).prop_map(Op::AdvanceTime),
    ]
}

#[derive(Clone, Debug, PartialEq)]
struct Proposal {
    new_admin: usize,
    approvals: std::vec::Vec<usize>,
    ready_at: Option<u32>,
}

/// Reference model. `bug` lets the self-test inject a deliberate defect to
/// prove the harness notices divergence.
#[derive(Clone, Debug, Default)]
struct Model {
    admin: usize,
    guardians: std::vec::Vec<usize>,
    config: Option<(u32, u32)>,
    proposal: Option<Proposal>,
    /// Timelocked guardian change (issue #175): (guardian, add, ready_at).
    guardian_change: Option<(usize, bool, u32)>,
    /// Stored (in force) limit per user; 0 = unlimited.
    limits: [i128; ACTORS],
    /// Queued limit increase per user (issue #176): (limit, effective_at).
    pending_limits: [Option<(i128, u64)>; ACTORS],
    /// Every recorded spend per user as (hour, amount); recorded whether or
    /// not a limit is set (issue #179).
    spends: [std::vec::Vec<(u64, i128)>; ACTORS],
    seq: u32,
    ts: u64,
    bug: bool,
}

impl Model {
    fn is_guardian(&self, a: usize) -> bool {
        self.guardians.contains(&a)
    }
    fn hour(&self) -> u64 {
        self.ts / SPEND_BUCKET_SECONDS
    }
    /// Total over the trailing window of hourly buckets.
    fn spent_today(&self, u: usize) -> i128 {
        let first = self.hour().saturating_sub(SPEND_WINDOW_BUCKETS - 1);
        self.spends[u].iter().filter(|(h, _)| *h >= first).map(|(_, a)| *a).sum()
    }
    /// Limit in force, counting a matured pending increase.
    fn effective_limit(&self, u: usize) -> i128 {
        match self.pending_limits[u] {
            Some((l, at)) if self.ts >= at => l,
            _ => self.limits[u],
        }
    }
    fn promote_limit(&mut self, u: usize) {
        if let Some((l, at)) = self.pending_limits[u] {
            if self.ts >= at {
                self.limits[u] = l;
                self.pending_limits[u] = None;
            }
        }
    }
    fn can_add_guardian(&self, g: usize) -> bool {
        !self.is_guardian(g) && self.guardians.len() < MAX_GUARDIANS
    }
    fn can_remove_guardian(&self, g: usize) -> bool {
        if !self.is_guardian(g) {
            return false;
        }
        match self.config {
            Some((t, _)) => self.guardians.len() as u32 - 1 >= t,
            None => true,
        }
    }
    /// Admin cancel window (issue #175).
    fn admin_may_cancel(&self, p: &Proposal) -> bool {
        let n = self.guardians.len();
        if n > 0 && p.approvals.len() * 3 >= n * 2 {
            return false;
        }
        match (p.ready_at, self.config) {
            (None, _) => true,
            (Some(r), Some((_, delay))) => self.seq < r.saturating_sub(delay / 2),
            (Some(_), None) => false,
        }
    }

    /// Applies `op`; returns whether the contract call should succeed.
    fn apply(&mut self, op: &Op) -> bool {
        match *op {
            Op::AddGuardian { caller, guardian } | Op::RemoveGuardian { caller, guardian } => {
                let add = matches!(op, Op::AddGuardian { .. });
                // The set is frozen while a recovery is pending (#175).
                if caller != self.admin || self.proposal.is_some() {
                    return false;
                }
                let valid = if add { self.can_add_guardian(guardian) } else { self.can_remove_guardian(guardian) };
                if !valid {
                    return false;
                }
                match self.config {
                    // Initial setup: immediate.
                    None => {
                        if add {
                            self.guardians.push(guardian);
                        } else {
                            self.guardians.retain(|g| *g != guardian);
                        }
                    }
                    // Configured: queued behind the recovery delay.
                    Some((_, delay)) => {
                        if self.guardian_change.is_some() {
                            return false;
                        }
                        self.guardian_change = Some((guardian, add, self.seq.saturating_add(delay)));
                    }
                }
                true
            }
            Op::ApplyGuardianChange => {
                let Some((guardian, add, ready_at)) = self.guardian_change else { return false };
                if self.proposal.is_some() || self.seq < ready_at {
                    return false;
                }
                // Re-validated at apply time; a failure leaves it queued.
                let valid = if add { self.can_add_guardian(guardian) } else { self.can_remove_guardian(guardian) };
                if !valid {
                    return false;
                }
                if add {
                    self.guardians.push(guardian);
                } else {
                    self.guardians.retain(|g| *g != guardian);
                }
                self.guardian_change = None;
                true
            }
            Op::CancelGuardianChange { caller } => {
                if caller != self.admin || self.guardian_change.is_none() {
                    return false;
                }
                self.guardian_change = None;
                true
            }
            Op::SetRecoveryConfig { caller, threshold, extra_delay } => {
                if caller != self.admin || self.proposal.is_some() || threshold <= 1 {
                    return false;
                }
                if self.guardians.len() < MIN_GUARDIANS_FOR_RECOVERY || threshold as usize > self.guardians.len() {
                    return false;
                }
                // extra_delay == 0 → exactly the minimum; the strategy never
                // goes below it, the dedicated unit tests cover that error.
                self.config = Some((threshold, GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS + extra_delay));
                true
            }
            Op::InitiateRecovery { guardian, new_admin } => {
                if !self.is_guardian(guardian) || self.config.is_none() || self.proposal.is_some() {
                    return false;
                }
                self.proposal = Some(Proposal { new_admin, approvals: vec![guardian], ready_at: None });
                true
            }
            Op::ApproveRecovery { guardian } => {
                if !self.is_guardian(guardian) {
                    return false;
                }
                let Some((t, delay)) = self.config else { return false };
                let seq = self.seq;
                let Some(p) = self.proposal.as_mut() else { return false };
                if p.approvals.contains(&guardian) {
                    return false;
                }
                p.approvals.push(guardian);
                if p.approvals.len() as u32 >= t && p.ready_at.is_none() {
                    p.ready_at = Some(seq.saturating_add(delay));
                }
                true
            }
            Op::RevokeApproval { guardian } => {
                if !self.is_guardian(guardian) {
                    return false;
                }
                let Some((t, _)) = self.config else { return false };
                let Some(p) = self.proposal.as_mut() else { return false };
                if !p.approvals.contains(&guardian) {
                    return false;
                }
                p.approvals.retain(|g| *g != guardian);
                if (p.approvals.len() as u32) < t {
                    p.ready_at = None;
                }
                true
            }
            Op::ExecuteRecovery => {
                let Some((t, _)) = self.config else { return false };
                let Some(p) = self.proposal.clone() else { return false };
                if (p.approvals.len() as u32) < t {
                    return false;
                }
                let Some(ready_at) = p.ready_at else { return false };
                if self.seq < ready_at || p.new_admin == self.admin {
                    return false;
                }
                self.admin = p.new_admin;
                self.proposal = None;
                // A change queued by the replaced admin is discarded (#175).
                self.guardian_change = None;
                true
            }
            Op::CancelRecovery { caller } => {
                if caller != self.admin {
                    return false;
                }
                let Some(p) = self.proposal.clone() else { return false };
                if !self.admin_may_cancel(&p) {
                    return false;
                }
                self.proposal = None;
                true
            }
            Op::SetSpendLimit { user, limit } => {
                if limit < 0 {
                    return false;
                }
                self.promote_limit(user);
                let current = self.limits[user];
                let is_decrease = limit != 0 && (current == 0 || limit <= current);
                if is_decrease || limit == current {
                    // Immediate, retroactively checked, drops a queued increase.
                    if limit != 0 && self.spent_today(user) > limit {
                        return false;
                    }
                    self.limits[user] = limit;
                    self.pending_limits[user] = None;
                } else {
                    // Increase (or clear to unlimited): delayed (#176).
                    self.pending_limits[user] = Some((limit, self.ts.saturating_add(SPEND_LIMIT_INCREASE_DELAY_SECS)));
                }
                true
            }
            Op::RecordSpend { user, amount } => {
                if amount <= 0 {
                    return false;
                }
                self.promote_limit(user);
                let limit = self.limits[user];
                let new_spent = self.spent_today(user) + amount;
                if limit != 0 {
                    let over = if self.bug { new_spent >= limit } else { new_spent > limit };
                    if over {
                        return false;
                    }
                }
                let hour = self.hour();
                self.spends[user].push((hour, amount));
                true
            }
            Op::AdvanceLedgers(n) => {
                self.seq += n;
                true
            }
            Op::AdvanceTime(s) => {
                self.ts += s;
                true
            }
        }
    }
}

struct Harness {
    env: Env,
    client: GlobeWalletClient<'static>,
    actors: std::vec::Vec<Address>,
    #[allow(dead_code)]
    xlm: String,
    /// Spend limits are keyed by token address (issue #173).
    xlm_token: Address,
}

impl Harness {
    fn new() -> (Self, Model) {
        let env = Env::default();
        env.mock_all_auths();
        env.budget().reset_unlimited();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let actors: std::vec::Vec<Address> = (0..ACTORS).map(|_| Address::generate(&env)).collect();
        client.initialize(&actors[0]);
        let xlm = String::from_str(&env, "XLM");
        // `extend_user_ttl` walks the allowlisted tokens, so the token the
        // limits are kept on must be a real, allowlisted SAC for the keeper
        // call after every step to keep its spend entries alive.
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let xlm_token = sac.address();
        let issuer_key = match soroban_sdk::xdr::ScAddress::from(&sac.issuer().address()) {
            soroban_sdk::xdr::ScAddress::Account(soroban_sdk::xdr::AccountId(
                soroban_sdk::xdr::PublicKey::PublicKeyTypeEd25519(soroban_sdk::xdr::Uint256(k)),
            )) => BytesN::from_array(&env, &k),
            _ => panic!("SAC issuer must be an account"),
        };
        client.propose_allowed_token(&actors[0], &xlm_token, &String::from_str(&env, "aaa"), &Some(issuer_key));
        let ready_at = client.pending_allowed_token(&xlm_token).unwrap().ready_at;
        env.ledger().with_mut(|l| l.sequence_number = ready_at);
        client.execute_allowed_token(&actors[0], &xlm_token);
        for a in &actors {
            client.add_asset(a, &AssetInfo { code: xlm.clone(), issuer: None });
        }
        let model = Model {
            seq: env.ledger().sequence(),
            ts: env.ledger().timestamp(),
            ..Model::default()
        };
        (Self { env, client, actors, xlm, xlm_token }, model)
    }

    fn call(&self, op: &Op) -> bool {
        let c = &self.client;
        let a = &self.actors;
        match *op {
            Op::AddGuardian { caller, guardian } => c.try_add_guardian(&a[caller], &a[guardian]).is_ok(),
            Op::RemoveGuardian { caller, guardian } => c.try_remove_guardian(&a[caller], &a[guardian]).is_ok(),
            Op::SetRecoveryConfig { caller, threshold, extra_delay } => c
                .try_set_recovery_config(&a[caller], &threshold, &(GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS + extra_delay))
                .is_ok(),
            Op::InitiateRecovery { guardian, new_admin } => c.try_initiate_recovery(&a[guardian], &a[new_admin]).is_ok(),
            Op::ApproveRecovery { guardian } => c.try_approve_recovery(&a[guardian]).is_ok(),
            Op::RevokeApproval { guardian } => c.try_revoke_recovery_approval(&a[guardian]).is_ok(),
            Op::ExecuteRecovery => c.try_execute_recovery().is_ok(),
            Op::CancelRecovery { caller } => c.try_cancel_recovery(&a[caller]).is_ok(),
            Op::ApplyGuardianChange => c.try_apply_guardian_change().is_ok(),
            Op::CancelGuardianChange { caller } => c.try_cancel_guardian_change(&a[caller]).is_ok(),
            Op::SetSpendLimit { user, limit } => c.try_set_spend_limit(&a[user], &self.xlm_token, &limit).is_ok(),
            Op::RecordSpend { user, amount } => c.try_record_spend(&a[user], &self.xlm_token, &amount).is_ok(),
            Op::AdvanceLedgers(n) => {
                self.env.ledger().with_mut(|l| l.sequence_number += n);
                true
            }
            Op::AdvanceTime(s) => {
                self.env.ledger().with_mut(|l| l.timestamp += s);
                true
            }
        }
    }

    fn idx(&self, addr: &Address) -> usize {
        self.actors.iter().position(|a| a == addr).expect("unknown address in contract state")
    }

    fn assert_matches(&self, m: &Model, step: usize, op: &Op) {
        let c = &self.client;
        // Exactly one admin, and it is the one the model expects.
        assert_eq!(self.idx(&c.admin()), m.admin, "admin diverged at step {step} ({op:?})");
        let guardians: std::vec::Vec<usize> = c.guardians().iter().map(|g| self.idx(&g)).collect();
        assert_eq!(guardians, m.guardians, "guardians diverged at step {step} ({op:?})");
        let cfg = c.recovery_config().map(|r| (r.threshold, r.delay_in_ledgers));
        assert_eq!(cfg, m.config, "recovery config diverged at step {step} ({op:?})");
        let proposal = c.recovery_proposal().map(|p| Proposal {
            new_admin: self.idx(&p.new_admin),
            approvals: p.approvals.iter().map(|g| self.idx(&g)).collect(),
            ready_at: p.ready_at,
        });
        assert_eq!(proposal, m.proposal, "recovery proposal diverged at step {step} ({op:?})");
        let change = c.pending_guardian_change().map(|ch| (self.idx(&ch.guardian), ch.add, ch.ready_at));
        assert_eq!(change, m.guardian_change, "guardian change diverged at step {step} ({op:?})");
        if let (Some(p), Some((t, delay))) = (&m.proposal, m.config) {
            // Quorum always arms the timelock; below quorum it is disarmed.
            assert_eq!(p.ready_at.is_some(), p.approvals.len() as u32 >= t, "timelock arming at step {step}");
            if let Some(r) = p.ready_at {
                assert!(r >= delay, "ready_at must include the delay");
            }
        }
        for (u, addr) in self.actors.iter().enumerate() {
            let limit = c.get_spend_limit(addr, &self.xlm_token);
            let spent = c.get_spent_today(addr, &self.xlm_token);
            assert_eq!(limit, m.effective_limit(u), "limit diverged for actor {u} at step {step} ({op:?})");
            let pending = c.pending_spend_limit(addr, &self.xlm_token).map(|p| (p.limit, p.effective_at));
            assert_eq!(pending, m.pending_limits[u], "pending limit diverged for actor {u} at step {step} ({op:?})");
            // Spends are tracked whether or not a limit is set (#179).
            assert_eq!(spent, m.spent_today(u), "spent diverged for actor {u} at step {step} ({op:?})");
            if limit > 0 {
                // Core invariant: the window never exceeds the limit in force.
                assert!(spent <= limit, "spent {spent} > limit {limit} at step {step}");
            }
        }
    }
}

fn run(ops: &[Op], bug: bool) {
    let (h, mut model) = Harness::new();
    model.bug = bug;
    for (step, op) in ops.iter().enumerate() {
        let before_admin = model.admin;
        let expected = model.apply(op);
        let actual = h.call(op);
        assert_eq!(actual, expected, "step {step}: {op:?} contract ok={actual}, model ok={expected}");
        if matches!(op, Op::ExecuteRecovery) && actual {
            // Recovery only executes after quorum + delay (checked in the
            // model's precondition) and always changes the admin.
            assert_ne!(before_admin, model.admin);
        }
        // Keeper (issue #185): keep every per-user entry alive between steps.
        for a in &h.actors {
            h.client.extend_user_ttl(a);
        }
        h.assert_matches(&model, step, op);
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        // Overridden by PROPTEST_CASES in CI / nightly.
        cases: 64,
        max_shrink_iters: 2_000,
        ..ProptestConfig::default()
    })]

    #[test]
    fn contract_matches_reference_model(ops in proptest::collection::vec(op_strategy(), 1..60)) {
        run(&ops, false);
    }
}

/// Seeds a sequence that sets up the guardian/recovery state deterministically
/// so even a tiny CI case budget exercises the full recovery path.
#[test]
fn full_recovery_path_matches_model() {
    let ops = vec![
        Op::AddGuardian { caller: 0, guardian: 1 },
        Op::AddGuardian { caller: 0, guardian: 2 },
        Op::AddGuardian { caller: 0, guardian: 3 },
        Op::SetRecoveryConfig { caller: 0, threshold: 2, extra_delay: 0 },
        Op::InitiateRecovery { guardian: 1, new_admin: 4 },
        Op::ExecuteRecovery, // not quorate
        Op::ApproveRecovery { guardian: 2 },
        Op::ExecuteRecovery, // timelock not elapsed
        Op::AdvanceLedgers(LEDGERS_PER_DAY / 2 - 1),
        Op::AdvanceLedgers(LEDGERS_PER_DAY / 2 - 1),
        Op::AdvanceLedgers(10),
        Op::ExecuteRecovery,
        Op::AddGuardian { caller: 0, guardian: 5 }, // old admin lost control
        Op::AddGuardian { caller: 4, guardian: 5 }, // queued behind the delay (#175)
        Op::ApplyGuardianChange,                     // not ready yet
        Op::AdvanceLedgers(LEDGERS_PER_DAY / 2 - 1),
        Op::AdvanceLedgers(LEDGERS_PER_DAY / 2 - 1),
        Op::AdvanceLedgers(10),
        Op::ApplyGuardianChange,
    ];
    run(&ops, false);
}

/// Test plan: an injected bug (off-by-one in the model's limit check) must
/// be caught by the harness.
#[test]
#[should_panic(expected = "model ok")]
fn harness_catches_injected_bug() {
    let ops = vec![
        Op::SetSpendLimit { user: 1, limit: 100 },
        Op::RecordSpend { user: 1, amount: 100 },
    ];
    run(&ops, true);
}
