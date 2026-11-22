#![no_std]

//! # token-wrapper
//!
//! Thin wrapper around the Soroban token interface that adds
//! allowance-gated transfers for the GlobeWallet protocol.
//! Enables the globe-wallet contract to move tokens on behalf
//! of users who have granted a per-session allowance.
//!
//! ## Authorization model (issue #174)
//! Allowances are scoped to `(owner, spender, token_id)`: approving a
//! spender for one token grants nothing for any other token. The wrapper is
//! a **bookkeeping** layer, not a delegated-spending layer — it does not hold
//! a SAC allowance of its own, so the underlying `token.transfer(from, ..)`
//! still requires `from`'s authorization. Concretely, for
//! `globe-wallet::send` the user signs one auth tree covering `send` and the
//! nested token `transfer`; the wallet contract (the `spender`) is
//! authorized implicitly as the direct caller. Session-key style delegated
//! spending (owner does not sign each transfer) is out of scope and is
//! documented in `contract/docs/design/token-wrapper-auth-model.md`.
//!
//! ## Decimal-aware amounts (issue #277)
//! SEP-41 tokens may use any number of decimals (SACs use 7, but e.g. USDC
//! uses 6 and some tokens use 18). Raw `i128` base units therefore mean
//! different things per token. `approve` and `transfer_from` accept an
//! optional `decimals` hint; when supplied it is validated against the
//! token's own `decimals()` and stored with the allowance so callers can
//! reason about the amount in normalised units. `approve_normalised` and
//! `transfer_from_normalised` take a whole-token amount and scale it by the
//! token's decimals, so a numeric limit means the same value regardless of
//! the token's precision.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol,
};

// Named WrapperDataKey rather than DataKey: globe-wallet links this crate,
// so this type lands in globe-wallet's contract spec too, and two types
// called DataKey break the generated TypeScript bindings. Only variant
// names are stored on-chain, so the rename does not change storage keys.
#[contracttype]
pub enum WrapperDataKey {
    /// Legacy `(owner, spender)` allowance that applied to *every* token.
    /// No longer read or written (issue #174): existing entries are inert
    /// and archive on their own TTL, so a legacy approval can never be used
    /// to move a token the owner did not approve. Owners re-approve per
    /// token. Kept only so the variant's discriminant stays stable.
    Allowance(Address, Address),
    /// (owner, spender, token_id) → (amount, expiry_ledger)
    TokenAllowance(Address, Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Allowance {
    pub amount: i128,
    pub expiry_ledger: u32,
}

// ── Errors ────────────────────────────────────────────────────────────────────
//
// Code namespace for token-wrapper contract errors. Codes start at 2001,
// reserved range 2001-2999, kept distinct from globe-wallet's WalletError
// range (1001-1030+, see contracts/globe-wallet/src/lib.rs) so a raw
// `Error(Contract, #N)` code is unambiguous about which contract raised it
// without also needing the contract address alongside it.

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum WrapperError {
    AllowanceExpired = 2001,
    InsufficientAllowance = 2002,
    InvalidAmount = 2003,
    InvalidExpiry = 2004,
    /// Supplied `decimals` hint does not match the token's `decimals()`.
    DecimalsMismatch = 2005,
    /// Token reports more decimals than the wrapper can safely scale.
    UnsupportedDecimals = 2006,
}

/// Upper bound on token decimals we will scale by. 18 covers the widest
/// SEP-41 tokens in practice; anything larger risks `i128` overflow when
/// scaling whole-token amounts and is rejected explicitly.
pub const MAX_DECIMALS: u32 = 18;

#[contract]
pub struct TokenWrapper;

#[contractimpl]
impl TokenWrapper {
    /// Grant a spender allowance over the caller's tokens.
    ///
    /// **Overwrite semantics:** calling `approve` for an existing
    /// `(owner, spender)` pair **replaces** the previous allowance
    /// wholesale — it does **not** add to the remaining balance.
    /// If a spender has already used part of their allowance and
    /// the owner calls `approve` again, the new `amount` becomes the
    /// *total* allowance, not an increment on top of what's left.
    ///
    /// The allowance applies to `token_id` only (issue #174).
    ///
    /// `expiry_ledger` must be in the future.
    ///
    /// `decimals` is an optional hint (issue #277). When `Some`, it must
    /// match the token's own `decimals()` or the call fails with
    /// `DecimalsMismatch`, so a caller can never silently set a limit that
    /// means the wrong value for the token. Pass `None` to skip the check.
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        token_id: Address,
        amount: i128,
        expiry_ledger: u32,
        decimals: Option<u32>,
    ) -> Result<(), WrapperError> {
        owner.require_auth();
        if amount < 0 {
            return Err(WrapperError::InvalidAmount);
        }
        if expiry_ledger <= env.ledger().sequence() {
            return Err(WrapperError::InvalidExpiry);
        }
        if let Some(hint) = decimals {
            let actual = read_decimals(&env, &token_id)?;
            if hint != actual {
                return Err(WrapperError::DecimalsMismatch);
            }
        }
        let key = WrapperDataKey::TokenAllowance(owner.clone(), spender.clone(), token_id.clone());
        env.storage()
            .persistent()
            .set(&key, &Allowance { amount, expiry_ledger });
        // Allowance carries an explicit `expiry_ledger` contract; storage TTL
        // must never expire *before* that ledger or the allowance would vanish
        // early through archival rather than through its own stated semantics.
        let extend_to = expiry_ledger.saturating_sub(env.ledger().sequence());
        env.storage().persistent().extend_ttl(&key, extend_to, extend_to);
        env.events().publish(
            (Symbol::new(&env, "approved"),),
            (owner, spender, token_id, amount, expiry_ledger),
        );
        Ok(())
    }

    /// Grant an allowance expressed in **whole tokens** (issue #277).
    ///
    /// Reads the token's `decimals()` and scales `whole_amount` by
    /// `10^decimals` before storing the base-unit allowance, so a limit of
    /// `100` means 100 tokens whether the token uses 6, 7 or 18 decimals.
    /// `whole_amount` must be non-negative and the scaled value must fit in
    /// `i128`.
    pub fn approve_normalised(
        env: Env,
        owner: Address,
        spender: Address,
        token_id: Address,
        whole_amount: i128,
        expiry_ledger: u32,
    ) -> Result<(), WrapperError> {
        owner.require_auth();
        if whole_amount < 0 {
            return Err(WrapperError::InvalidAmount);
        }
        if expiry_ledger <= env.ledger().sequence() {
            return Err(WrapperError::InvalidExpiry);
        }
        let decimals = read_decimals(&env, &token_id)?;
        let amount = scale_amount(whole_amount, decimals)?;
        let key = WrapperDataKey::TokenAllowance(owner.clone(), spender.clone(), token_id.clone());
        env.storage()
            .persistent()
            .set(&key, &Allowance { amount, expiry_ledger });
        let extend_to = expiry_ledger.saturating_sub(env.ledger().sequence());
        env.storage().persistent().extend_ttl(&key, extend_to, extend_to);
        env.events().publish(
            (Symbol::new(&env, "approved"),),
            (owner, spender, token_id, amount, expiry_ledger),
        );
        Ok(())
    }

    /// Return current allowance for (owner, spender, token_id).
    pub fn allowance(env: Env, owner: Address, spender: Address, token_id: Address) -> Allowance {
        let key = WrapperDataKey::TokenAllowance(owner, spender, token_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Allowance { amount: 0, expiry_ledger: 0 })
    }

    /// Permissionless TTL keeper for one allowance (issue #185).
    ///
    /// Re-extends the `(owner, spender, token_id)` entry so storage never archives it
    /// before its own `expiry_ledger`. Values are untouched, so no auth is
    /// needed — anyone (the backend keeper job) may pay for it. Returns the
    /// number of ledgers the entry was extended to live for (0 when the pair
    /// has no allowance or it has already expired, in which case there is
    /// nothing worth keeping alive).
    pub fn extend_allowance_ttl(env: Env, owner: Address, spender: Address, token_id: Address) -> u32 {
        let key = WrapperDataKey::TokenAllowance(owner.clone(), spender.clone(), token_id.clone());
        let current: Option<Allowance> = env.storage().persistent().get(&key);
        let extend_to = match current {
            Some(a) if a.expiry_ledger >= env.ledger().sequence() => {
                a.expiry_ledger.saturating_sub(env.ledger().sequence())
            }
            _ => 0,
        };
        if extend_to > 0 {
            env.storage().persistent().extend_ttl(&key, extend_to, extend_to);
            env.events().publish(
                (Symbol::new(&env, "allowance_ttl_extended"),),
                (owner, spender, token_id, extend_to),
            );
        }
        extend_to
    }

    /// Transfer tokens from `from` to `to` using a previously granted allowance.
    ///
    /// Decrements the `(from, spender, token_id)` allowance; fails if expired
    /// or insufficient. An allowance granted for a different token never
    /// applies (`InsufficientAllowance`, issue #174).
    /// An allowance is usable through and including its `expiry_ledger`.
    ///
    /// `decimals` is an optional hint (issue #277); when `Some` it must match
    /// the token's `decimals()` or the call fails with `DecimalsMismatch`.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        token_id: Address,
        from: Address,
        to: Address,
        amount: i128,
        decimals: Option<u32>,
    ) -> Result<(), WrapperError> {
        spender.require_auth();
        if amount <= 0 {
            return Err(WrapperError::InvalidAmount);
        }
        if let Some(hint) = decimals {
            let actual = read_decimals(&env, &token_id)?;
            if hint != actual {
                return Err(WrapperError::DecimalsMismatch);
            }
        }
        let key = WrapperDataKey::TokenAllowance(from.clone(), spender.clone(), token_id.clone());
        let current: Allowance = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Allowance { amount: 0, expiry_ledger: 0 });
        if current.amount == 0 && current.expiry_ledger == 0 {
            return Err(WrapperError::InsufficientAllowance);
        }
        if current.expiry_ledger < env.ledger().sequence() {
            return Err(WrapperError::AllowanceExpired);
        }
        if current.amount < amount {
            return Err(WrapperError::InsufficientAllowance);
        }
        let new_allowance = Allowance {
            amount: current.amount - amount,
            expiry_ledger: current.expiry_ledger,
        };
        env.storage().persistent().set(&key, &new_allowance);
        let extend_to = current.expiry_ledger.saturating_sub(env.ledger().sequence());
        env.storage().persistent().extend_ttl(&key, extend_to, extend_to);
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&from, &to, &amount);
        env.events().publish(
            (Symbol::new(&env, "transferred_from"),),
            (spender, token_id, from, to, amount),
        );
        Ok(())
    }

    /// Transfer **whole tokens** from `from` to `to` using an allowance
    /// (issue #277). Reads the token's `decimals()` and scales `whole_amount`
    /// by `10^decimals` before checking and decrementing the allowance, so a
    /// spend of `1` means one whole token regardless of the token's precision.
    pub fn transfer_from_normalised(
        env: Env,
        spender: Address,
        token_id: Address,
        from: Address,
        to: Address,
        whole_amount: i128,
    ) -> Result<(), WrapperError> {
        spender.require_auth();
        if whole_amount <= 0 {
            return Err(WrapperError::InvalidAmount);
        }
        let decimals = read_decimals(&env, &token_id)?;
        let amount = scale_amount(whole_amount, decimals)?;
        let key = WrapperDataKey::TokenAllowance(from.clone(), spender.clone(), token_id.clone());
        let current: Allowance = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Allowance { amount: 0, expiry_ledger: 0 });
        if current.amount == 0 && current.expiry_ledger == 0 {
            return Err(WrapperError::InsufficientAllowance);
        }
        if current.expiry_ledger < env.ledger().sequence() {
            return Err(WrapperError::AllowanceExpired);
        }
        if current.amount < amount {
            return Err(WrapperError::InsufficientAllowance);
        }
        let new_allowance = Allowance {
            amount: current.amount - amount,
            expiry_ledger: current.expiry_ledger,
        };
        env.storage().persistent().set(&key, &new_allowance);
        let extend_to = current.expiry_ledger.saturating_sub(env.ledger().sequence());
        env.storage().persistent().extend_ttl(&key, extend_to, extend_to);
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&from, &to, &amount);
        env.events().publish(
            (Symbol::new(&env, "transferred_from"),),
            (spender, token_id, from, to, amount),
        );
        Ok(())
    }
}

/// Read a token's `decimals()` and reject values above `MAX_DECIMALS` so
/// scaling can never overflow `i128`.
fn read_decimals(env: &Env, token_id: &Address) -> Result<u32, WrapperError> {
    let token_client = token::Client::new(env, token_id);
    let decimals = token_client.decimals();
    if decimals > MAX_DECIMALS {
        return Err(WrapperError::UnsupportedDecimals);
    }
    Ok(decimals)
}

/// Scale a whole-token amount by `10^decimals`, returning `InvalidAmount` on
/// overflow rather than panicking.
fn scale_amount(whole_amount: i128, decimals: u32) -> Result<i128, WrapperError> {
    let factor = 10i128
        .checked_pow(decimals)
        .ok_or(WrapperError::UnsupportedDecimals)?;
    whole_amount
        .checked_mul(factor)
        .ok_or(WrapperError::InvalidAmount)
}
