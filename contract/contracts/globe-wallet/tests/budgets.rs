//! Resource budgets per entry point (issue #188).
//!
//! Measures host CPU instructions and memory bytes for every public entry
//! point of globe-wallet and token-wrapper using the test env's `Budget`,
//! compares them with `budgets/baseline.json`, writes a Markdown diff and
//! fails on any regression above `TOLERANCE_PCT` (5%).
//!
//! Numbers are only meaningful against the WASM build (native Rust calls
//! cost almost nothing in the host). CI therefore builds the release WASM
//! and points `GLOBE_WALLET_WASM` / `TOKEN_WRAPPER_WASM` at it. Without
//! those variables the harness still runs every entry point and writes the
//! report, but skips the regression gate.
//!
//! * `UPDATE_BUDGETS=1` rewrites the baseline from the current measurements.
//! * `BUDGET_REPORT=path.md` sets where the Markdown diff goes (default
//!   `target/budget-report.md`).
//!
//! Every entry point is measured on a "warm" path (state it needs already
//! exists) so an extra storage read/write shows up as a CPU/memory jump.

use globe_wallet::{AssetInfo, DataKey, GlobeWallet, GlobeWalletClient, Role};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env, String,
};
use std::collections::BTreeMap;
use token_wrapper::{TokenWrapper, TokenWrapperClient};

const TOLERANCE_PCT: f64 = 5.0;
const BASELINE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/budgets/baseline.json");

#[derive(Clone, Copy, Debug, PartialEq)]
struct Cost {
    cpu: u64,
    mem: u64,
}

struct Recorder<'a> {
    env: &'a Env,
    results: BTreeMap<std::string::String, Cost>,
}

impl<'a> Recorder<'a> {
    fn measure<R>(&mut self, name: &str, f: impl FnOnce() -> R) -> R {
        self.env.budget().reset_default();
        let r = f();
        let cost = Cost {
            cpu: self.env.budget().cpu_instruction_cost(),
            mem: self.env.budget().memory_bytes_cost(),
        };
        assert!(
            self.results.insert(name.to_string(), cost).is_none(),
            "entry point {name} measured twice"
        );
        r
    }
}

fn register_wallet(env: &Env) -> Address {
    match std::env::var("GLOBE_WALLET_WASM") {
        Ok(path) => {
            let wasm = std::fs::read(&path).expect("read GLOBE_WALLET_WASM");
            env.register_contract_wasm(None, wasm.as_slice())
        }
        Err(_) => env.register_contract(None, GlobeWallet),
    }
}

fn register_wrapper(env: &Env) -> Address {
    match std::env::var("TOKEN_WRAPPER_WASM") {
        Ok(path) => {
            let wasm = std::fs::read(&path).expect("read TOKEN_WRAPPER_WASM");
            env.register_contract_wasm(None, wasm.as_slice())
        }
        Err(_) => env.register_contract(None, TokenWrapper),
    }
}

/// Every entry point, in call order. Keep in sync with the contracts:
/// `all_entry_points_are_budgeted` below fails if one is missing.
fn measure_all() -> BTreeMap<std::string::String, Cost> {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let wallet_id = register_wallet(&env);
    let w = GlobeWalletClient::new(&env, &wallet_id);
    let wrapper_id = register_wrapper(&env);
    let tw = TokenWrapperClient::new(&env, &wrapper_id);
    let mut r = Recorder { env: &env, results: BTreeMap::new() };

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let g: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(&env)).collect();
    let new_admin = Address::generate(&env);
    let xlm = String::from_str(&env, "XLM");
    let usdc = String::from_str(&env, "USDC");

    // ── admin ──
    r.measure("globe_wallet.initialize", || w.initialize(&admin));
    r.measure("globe_wallet.admin", || w.admin());
    r.measure("globe_wallet.propose_admin", || w.propose_admin(&admin, &new_admin));
    r.measure("globe_wallet.pending_admin", || w.pending_admin());
    r.measure("globe_wallet.cancel_admin_transfer", || w.cancel_admin_transfer(&admin));
    r.measure("globe_wallet.transfer_admin", || w.transfer_admin(&admin, &new_admin));
    r.measure("globe_wallet.accept_admin", || w.accept_admin(&new_admin));
    let admin = new_admin.clone();
    r.measure("globe_wallet.storage_layout", || w.storage_layout());
    r.measure("globe_wallet.migrate_storage_layout", || w.migrate_storage_layout(&admin));

    // ── upgrade (execute_upgrade needs an uploaded WASM; see upgrade_compat.rs) ──
    let hash = BytesN::from_array(&env, &[7u8; 32]);
    r.measure("globe_wallet.propose_upgrade", || {
        w.propose_upgrade(&admin, &hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS)
    });
    r.measure("globe_wallet.pending_upgrade", || w.pending_upgrade());

    // ── guardians & recovery ──
    for x in &g[..3] {
        w.add_guardian(&admin, x);
    }
    r.measure("globe_wallet.add_guardian", || w.add_guardian(&admin, &g[3]));
    r.measure("globe_wallet.guardians", || w.guardians());
    r.measure("globe_wallet.set_recovery_config", || {
        w.set_recovery_config(&admin, &2, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS)
    });
    r.measure("globe_wallet.recovery_config", || w.recovery_config());
    let target = Address::generate(&env);
    r.measure("globe_wallet.initiate_recovery", || w.initiate_recovery(&g[0], &target));
    r.measure("globe_wallet.approve_recovery", || w.approve_recovery(&g[1]));
    r.measure("globe_wallet.revoke_recovery_approval", || w.revoke_recovery_approval(&g[1]));
    r.measure("globe_wallet.recovery_proposal", || w.recovery_proposal());
    r.measure("globe_wallet.cancel_recovery", || w.cancel_recovery(&admin));
    // Recovery is configured, so guardian changes are timelocked (#175).
    r.measure("globe_wallet.remove_guardian", || w.remove_guardian(&admin, &g[3]));
    r.measure("globe_wallet.pending_guardian_change", || w.pending_guardian_change());
    r.measure("globe_wallet.cancel_guardian_change", || w.cancel_guardian_change(&admin));
    w.remove_guardian(&admin, &g[3]);
    env.ledger().with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
    r.measure("globe_wallet.apply_guardian_change", || w.apply_guardian_change());
    w.initiate_recovery(&g[0], &target);
    w.approve_recovery(&g[1]);
    env.ledger().with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
    r.measure("globe_wallet.execute_recovery", || w.execute_recovery());
    let admin = target;

    // ── assets & limits ──
    w.add_asset(&user, &AssetInfo { code: xlm.clone(), issuer: None });
    r.measure("globe_wallet.add_asset", || {
        w.add_asset(&user, &AssetInfo { code: usdc.clone(), issuer: Some(Address::generate(&env)) })
    });
    r.measure("globe_wallet.get_assets", || w.get_assets(&user));
    r.measure("globe_wallet.remove_asset", || w.remove_asset(&user, &usdc));
    let xlm_token = Address::generate(&env);
    r.measure("globe_wallet.set_spend_limit", || w.set_spend_limit(&user, &xlm_token, &1_000_000));
    r.measure("globe_wallet.get_spend_limit", || w.get_spend_limit(&user, &xlm_token));
    // An increase is queued (#176).
    w.set_spend_limit(&user, &xlm_token, &2_000_000);
    r.measure("globe_wallet.pending_spend_limit", || w.pending_spend_limit(&user, &xlm_token));
    r.measure("globe_wallet.cancel_pending_spend_limit", || {
        w.cancel_pending_spend_limit(&user, &user, &xlm_token)
    });
    r.measure("globe_wallet.record_spend", || w.record_spend(&user, &xlm_token, &10));
    r.measure("globe_wallet.get_spent_today", || w.get_spent_today(&user, &xlm_token));
    r.measure("globe_wallet.get_spend_allowance", || w.get_spend_allowance(&user, &xlm_token));
    r.measure("globe_wallet.is_limit_archived", || w.is_limit_archived(&user, &xlm_token));
    r.measure("globe_wallet.extend_user_ttl", || w.extend_user_ttl(&user));
    r.measure("globe_wallet.migrate_user_assets", || w.migrate_user_assets(&admin, &user));
    // Legacy (user, asset_code) limit + record from before #173.
    let legacy_token = Address::generate(&env);
    env.as_contract(&wallet_id, || {
        env.storage().persistent().set(&DataKey::SpendLimit(user.clone(), xlm.clone()), &5_000_i128);
    });
    r.measure("globe_wallet.migrate_spend_limit", || {
        w.migrate_spend_limit(&admin, &user, &xlm, &legacy_token)
    });

    // ── token wiring ──
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token_id = sac.address();
    let issuer_key = match soroban_sdk::xdr::ScAddress::from(&sac.issuer().address()) {
        soroban_sdk::xdr::ScAddress::Account(soroban_sdk::xdr::AccountId(
            soroban_sdk::xdr::PublicKey::PublicKeyTypeEd25519(soroban_sdk::xdr::Uint256(k)),
        )) => BytesN::from_array(&env, &k),
        _ => panic!("SAC issuer must be an account"),
    };
    token::StellarAssetClient::new(&env, &token_id).mint(&user, &1_000_000);
    r.measure("globe_wallet.set_token_wrapper", || w.set_token_wrapper(&admin, &wrapper_id));
    r.measure("globe_wallet.get_token_wrapper", || w.get_token_wrapper());
    let sac_code = String::from_str(&env, "aaa");
    r.measure("globe_wallet.propose_allowed_token", || {
        w.propose_allowed_token(&admin, &token_id, &sac_code, &Some(issuer_key.clone()))
    });
    let ready_at = r.measure("globe_wallet.pending_allowed_token", || w.pending_allowed_token(&token_id))
        .unwrap()
        .ready_at;
    env.ledger().with_mut(|l| l.sequence_number = ready_at);
    r.measure("globe_wallet.execute_allowed_token", || w.execute_allowed_token(&admin, &token_id));
    r.measure("globe_wallet.allowed_token_info", || w.allowed_token_info(&token_id));
    let other_sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let other_key = match soroban_sdk::xdr::ScAddress::from(&other_sac.issuer().address()) {
        soroban_sdk::xdr::ScAddress::Account(soroban_sdk::xdr::AccountId(
            soroban_sdk::xdr::PublicKey::PublicKeyTypeEd25519(soroban_sdk::xdr::Uint256(k)),
        )) => BytesN::from_array(&env, &k),
        _ => panic!("SAC issuer must be an account"),
    };
    w.propose_allowed_token(&admin, &other_sac.address(), &sac_code, &Some(other_key));
    r.measure("globe_wallet.cancel_allowed_token", || w.cancel_allowed_token(&admin, &other_sac.address()));
    r.measure("globe_wallet.is_token_allowed", || w.is_token_allowed(&token_id));
    r.measure("globe_wallet.get_allowed_tokens", || w.get_allowed_tokens());
    r.measure("globe_wallet.allowed_tokens", || w.allowed_tokens());
    let expiry = env.ledger().sequence() + 10_000;
    r.measure("token_wrapper.approve", || tw.approve(&user, &wallet_id, &token_id, &500_000, &expiry, &None));
    r.measure("token_wrapper.allowance", || tw.allowance(&user, &wallet_id, &token_id));
    r.measure("token_wrapper.extend_allowance_ttl", || tw.extend_allowance_ttl(&user, &wallet_id, &token_id));
    let to = Address::generate(&env);
    r.measure("globe_wallet.send", || w.send(&user, &token_id, &to, &100));
    let spender = Address::generate(&env);
    tw.approve(&user, &spender, &token_id, &1_000, &expiry, &None);
    r.measure("token_wrapper.transfer_from", || tw.transfer_from(&spender, &token_id, &user, &to, &10, &None));

    // ── roles & pause (#190, #191) ──
    let pauser = Address::generate(&env);
    r.measure("globe_wallet.grant_role", || w.grant_role(&admin, &Role::Pauser, &pauser));
    r.measure("globe_wallet.has_role", || w.has_role(&Role::Pauser, &pauser));
    r.measure("globe_wallet.pause", || w.pause(&pauser));
    r.measure("globe_wallet.is_paused", || w.is_paused());
    r.measure("globe_wallet.unpause", || w.unpause(&pauser));
    r.measure("globe_wallet.revoke_role", || w.revoke_role(&admin, &Role::Pauser, &pauser));
    r.measure("globe_wallet.set_pauser", || w.set_pauser(&admin, &Some(pauser.clone())));
    r.measure("globe_wallet.pauser", || w.pauser());
    r.measure("globe_wallet.pause_sends", || w.pause_sends(&pauser));
    r.measure("globe_wallet.is_send_paused", || w.is_send_paused());
    r.measure("globe_wallet.unpause_sends", || w.unpause_sends(&admin));

    r.measure("globe_wallet.remove_allowed_token", || w.remove_allowed_token(&admin, &token_id));

    r.results
}

/// Minimal parser for the flat `{"name": {"cpu": N, "mem": N}, ...}` file
/// this harness writes — avoids pulling in a JSON dependency.
fn parse_baseline(text: &str) -> BTreeMap<std::string::String, Cost> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix('"') else { continue };
        let Some((name, rest)) = rest.split_once('"') else { continue };
        let num = |field: &str| -> Option<u64> {
            let idx = rest.find(&format!("\"{field}\":"))? + field.len() + 3;
            rest[idx..]
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<std::string::String>()
                .parse()
                .ok()
        };
        if let (Some(cpu), Some(mem)) = (num("cpu"), num("mem")) {
            out.insert(name.to_string(), Cost { cpu, mem });
        }
    }
    out
}

fn render_baseline(results: &BTreeMap<std::string::String, Cost>) -> std::string::String {
    let body: std::vec::Vec<std::string::String> = results
        .iter()
        .map(|(k, c)| format!("  \"{k}\": {{ \"cpu\": {}, \"mem\": {} }}", c.cpu, c.mem))
        .collect();
    format!("{{\n{}\n}}\n", body.join(",\n"))
}

fn pct(new: u64, old: u64) -> f64 {
    if old == 0 {
        if new == 0 { 0.0 } else { f64::INFINITY }
    } else {
        (new as f64 - old as f64) * 100.0 / old as f64
    }
}

/// Returns (markdown report, list of regressions).
fn compare(
    current: &BTreeMap<std::string::String, Cost>,
    baseline: &BTreeMap<std::string::String, Cost>,
) -> (std::string::String, std::vec::Vec<std::string::String>) {
    let mut md = std::string::String::from(
        "## Contract resource budgets\n\n| Entry point | CPU (base → now) | Δ CPU | Mem (base → now) | Δ Mem |\n|---|---|---|---|---|\n",
    );
    let mut regressions = std::vec::Vec::new();
    for (name, now) in current {
        match baseline.get(name) {
            Some(base) => {
                let (dc, dm) = (pct(now.cpu, base.cpu), pct(now.mem, base.mem));
                let flag = if dc > TOLERANCE_PCT || dm > TOLERANCE_PCT { " ❌" } else { "" };
                if !flag.is_empty() {
                    regressions.push(format!("{name}: cpu {dc:+.1}%, mem {dm:+.1}%"));
                }
                md.push_str(&format!(
                    "| `{name}`{flag} | {} → {} | {dc:+.1}% | {} → {} | {dm:+.1}% |\n",
                    base.cpu, now.cpu, base.mem, now.mem
                ));
            }
            None => md.push_str(&format!("| `{name}` (new) | – → {} | – | – → {} | – |\n", now.cpu, now.mem)),
        }
    }
    for name in baseline.keys().filter(|k| !current.contains_key(*k)) {
        md.push_str(&format!("| `{name}` (removed) | | | | |\n"));
    }
    (md, regressions)
}

#[test]
fn contract_budgets_within_tolerance() {
    let current = measure_all();
    let baseline = std::fs::read_to_string(BASELINE_PATH).map(|t| parse_baseline(&t)).unwrap_or_default();
    let (md, regressions) = compare(&current, &baseline);

    let report = std::env::var("BUDGET_REPORT").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/budget-report.md").to_string()
    });
    if let Some(dir) = std::path::Path::new(&report).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&report, &md).expect("write budget report");

    if std::env::var("UPDATE_BUDGETS").as_deref() == Ok("1") {
        std::fs::write(BASELINE_PATH, render_baseline(&current)).expect("write baseline");
        return;
    }
    let wasm_mode = std::env::var("GLOBE_WALLET_WASM").is_ok();
    if wasm_mode {
        assert!(regressions.is_empty(), "budget regressions > {TOLERANCE_PCT}%:\n{}", regressions.join("\n"));
    }
}

/// Every public entry point must have a budget (acceptance criterion).
#[test]
fn all_entry_points_are_budgeted() {
    let measured = measure_all();
    let expected_missing = ["globe_wallet.execute_upgrade"]; // covered by upgrade_compat.rs
    let spec = [
        "initialize", "admin", "pending_admin", "transfer_admin", "propose_admin", "accept_admin",
        "cancel_admin_transfer", "propose_upgrade", "execute_upgrade", "pending_upgrade",
        "add_guardian", "remove_guardian", "guardians", "set_recovery_config", "recovery_config",
        "initiate_recovery", "approve_recovery", "revoke_recovery_approval", "execute_recovery",
        "cancel_recovery", "recovery_proposal", "add_asset", "remove_asset", "get_assets",
        "set_spend_limit", "get_spend_limit", "is_limit_archived", "extend_user_ttl",
        "get_spent_today", "get_spend_allowance", "record_spend", "set_token_wrapper",
        "get_token_wrapper", "propose_allowed_token", "execute_allowed_token", "cancel_allowed_token",
        "pending_allowed_token", "allowed_token_info", "remove_allowed_token", "is_token_allowed",
        "get_allowed_tokens", "allowed_tokens", "send", "migrate_user_assets",
        "storage_layout", "migrate_storage_layout", "apply_guardian_change", "cancel_guardian_change",
        "pending_guardian_change", "pending_spend_limit", "cancel_pending_spend_limit",
        "migrate_spend_limit", "grant_role", "revoke_role", "has_role", "pause", "unpause", "is_paused",
        "set_pauser", "pauser", "pause_sends", "unpause_sends", "is_send_paused",
    ];
    for f in spec {
        let key = format!("globe_wallet.{f}");
        if expected_missing.contains(&key.as_str()) {
            continue;
        }
        assert!(measured.contains_key(&key), "no budget for {key}");
    }
    for f in ["approve", "allowance", "transfer_from", "extend_allowance_ttl"] {
        assert!(measured.contains_key(&format!("token_wrapper.{f}")), "no budget for token_wrapper.{f}");
    }
}

/// Test plan: an extra storage read must trip the gate. Simulated by
/// comparing a measurement against a baseline that is 10% cheaper.
#[test]
fn regression_detector_flags_extra_cost() {
    let mut base = BTreeMap::new();
    base.insert("x".to_string(), Cost { cpu: 1_000, mem: 1_000 });
    let mut now = BTreeMap::new();
    now.insert("x".to_string(), Cost { cpu: 1_100, mem: 1_000 });
    let (_, regressions) = compare(&now, &base);
    assert_eq!(regressions.len(), 1);
    now.insert("x".to_string(), Cost { cpu: 1_040, mem: 1_000 });
    assert!(compare(&now, &base).1.is_empty());
    let parsed = parse_baseline(&render_baseline(&base));
    assert_eq!(parsed, base);
}
