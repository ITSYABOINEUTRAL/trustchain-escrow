# Rent / Storage Reserve System

This document explains how the escrow contract charges rent for the storage it
occupies on the Stellar network, how integrators top up that rent, and how an
escrow expires when its rent reserve runs out.

The implementation lives in `contracts/escrow_contract/src/lib.rs`.

## Overview

Soroban charges for persistent storage. To keep an escrow alive, the contract
maintains a **rent reserve** (`rent_balance`) that is drawn down over time based
on how many storage entries the escrow occupies. When the reserve can no longer
cover the rent due, the escrow becomes eligible for expiry via `expire_escrow`.

The lifecycle is:

```
top_up_rent  ->  rent_balance  ->  collect_rent_due  ->  expire_escrow
```

## Constants

All rent constants are defined at the top of `contracts/escrow_contract/src/lib.rs`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `RENT_PERIOD_SECONDS` | `86_400` (1 day) | Length of one rent period, in seconds. |
| `RENT_RESERVE_PERIODS` | `30` | Number of periods a fresh escrow's reserve is expected to cover. |
| `RENT_PER_ENTRY_PER_PERIOD` | `1` (stroop) | Rent charged per active storage entry per period. |

## The rent formula

Rent is charged per active storage entry, per elapsed period:

```
rent_due = active_entries × RENT_PER_ENTRY_PER_PERIOD × periods_elapsed
```

where `periods_elapsed` is the number of whole `RENT_PERIOD_SECONDS` intervals
since the last collection (`last_rent_collection_at`).

## `EscrowMeta` rent fields

Two fields on `EscrowMeta` drive the rent system:

- **`rent_balance`** — the escrow's current rent reserve, in stroops. It is
  increased by `top_up_rent` and decreased by `collect_rent_due`. When it can no
  longer cover the rent due, the escrow is at risk of expiry.
- **`last_rent_collection_at`** — the ledger timestamp (seconds) of the last
  successful rent collection. It is the anchor used to compute
  `periods_elapsed` for the next collection.

## What `active_storage_entries` counts

`active_storage_entries` returns the number of persistent storage entries the
escrow currently occupies. This includes the `EscrowMeta` entry itself plus one
entry per milestone. Because each milestone is stored as its own granular
persistent entry (see the gas-optimization notes at the top of `lib.rs`), **the
milestone count directly affects rent**: an escrow with more milestones has more
active entries and therefore a higher `rent_due` per period.

This is why a 3-milestone escrow costs more to keep alive than a 1-milestone
escrow, and why integrators must size their top-ups to the number of milestones
they create.

## Functions

### `top_up_rent`

Adds stroops to the escrow's `rent_balance`. Integrators call this to extend the
life of an escrow. The amount added is credited directly to the reserve.

### `collect_rent_due`

Computes `rent_due` using the formula above (based on `active_storage_entries`
and the periods elapsed since `last_rent_collection_at`), deducts it from
`rent_balance`, and advances `last_rent_collection_at` to the current ledger
timestamp. If the reserve cannot cover the amount due, the escrow is left
underfunded and becomes eligible for expiry.

### `collect_rent`

Convenience entry point that performs a rent collection for the escrow. It
applies the same `rent_due` computation and reserve deduction as
`collect_rent_due`.

### `rent_due_per_period`

Returns the rent charged for a single period:

```
rent_due_per_period = active_entries × RENT_PER_ENTRY_PER_PERIOD
```

Use this to estimate how much a top-up buys: `periods_covered = top_up / rent_due_per_period`.

### `rent_has_expired`

Returns `true` when the escrow's `rent_balance` can no longer cover the rent due
for the elapsed periods — i.e. the reserve has run dry.

### `rent_expires_at`

Returns the ledger timestamp at which the current `rent_balance` will be
exhausted, given the current `active_storage_entries` and
`RENT_PER_ENTRY_PER_PERIOD`. Integrators can use this to schedule top-ups before
expiry.

### `expire_escrow`

Called once `rent_has_expired` is `true`. It transitions the escrow to an
expired state, releasing its storage. This is the terminal step of the rent
lifecycle and is why failing to top up rent causes escrows to expire
unexpectedly.

## Worked example: 3-milestone escrow for 30 days

Assume an escrow with 3 milestones. Its active storage entries are the
`EscrowMeta` entry plus one entry per milestone:

```
active_entries = 1 (meta) + 3 (milestones) = 4
```

Rent per period:

```
rent_due_per_period = 4 × RENT_PER_ENTRY_PER_PERIOD
                   = 4 × 1
                   = 4 stroops / period
```

To keep the escrow alive for 30 days, with `RENT_PERIOD_SECONDS = 86_400`
(1 day), that is 30 periods:

```
rent_due = active_entries × RENT_PER_ENTRY_PER_PERIOD × periods_elapsed
         = 4 × 1 × 30
         = 120 stroops
```

So a top-up of **120 stroops** keeps a 3-milestone escrow alive for 30 days.
Note that `RENT_RESERVE_PERIODS = 30` matches this horizon: a fresh escrow's
reserve is sized to cover 30 periods, and any additional milestones increase the
per-period cost, so integrators should top up proportionally when they add
milestones.

## Practical guidance

- Top up **before** `rent_expires_at` to avoid unexpected expiry.
- Size top-ups using `rent_due_per_period` and the number of periods you need.
- Remember that adding milestones increases `active_storage_entries` and thus
  the per-period rent.
- Monitor `rent_has_expired` and `rent_expires_at` off-chain to trigger top-ups
  proactively.
