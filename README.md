# Euler Refunds

Accounts eligible for refunds are available in [claims.json](./data/claims.json) file.

## Methodology and scripts

The scripts construct the state of all accounts before the platform was disabled. The EToken module was disabled at block `16818363`, and the block before was the last one where the view contract can be queried. DToken was disabled at block `16818853`, at which point all activity was halted. Between these blocks there was a number of borrows and repays executed, as well as a single burn. The final value of accounts serves as a basis for calculating claims in a fair and equitable way.

### Installation and configuration
- Install dependencies:
`npm i`
- create `.env` file and enter full archive RPC provider URL `RPC_URL=https://...`


### Reconstruction of data
All files in the `./data` folder can be reconstructed from chain:

#### Find all deposits into staking contracts at the block before EToken removal. After that eToken transfers were disabled, so no unstaking followed.
`npm run staked`

File created: `./data/staked.json`

#### Find all accounts and markets
Unzip `rawlogs.json.zip` in main folder and run

`npm run accounts`

- From raw logs find all accounts ever active and their markets by scanning `Deposit` and `Borrow` events
- Add accounts and markets from staking logs. E.g. some accounts never executed a transaction on primary, but deposited to and staked from a subaccount.
- Find the primary account and subaccounts
- Flag contract accounts (`isContract`)
The results are stored in `./data/accounts.json`

#### Fetch prices for settlement and redemption blocks
The prices for all markets, used for further calculations are fetched from the Exec contract. After the pause the Exec module was disabled, so for current prices, the script creates a hardhat network with a mainnet fork at the specified block. The original Exec deployed code is set on the fork network under Exec module implementation address, which allows fetching prices as if the Exec module was not disabled.
`npm run prices`

Files with TWAP prices are created, using block numbers defined in `./scripts/utils/constants.ts`:

`./data/prices_pause.json`

`./data/prices_current.json`

#### Find events between `EToken` and `DToken` upgrade
`npm run last-events` creates a file `./data/eventsBetweenUpgrades.json`

#### Construct the accounts state at the moment of disabling the platform.
This step creates a snapshot of final user balances at the moment of disabling the platform.

`npm run balances` 

creates three files:

`./data/balancesAllETokenUpgrade.json` - all accounts with non-zero deposits or borrows at a block before `EToken` upgrade, including the attacker contracts

`./data/balancesUsers.json` - final snapshot of eligible user accounts. Attacker accounts are removed, as well as refunded victim, the account of DAO operated liquidation bot and accounts with negative net value. The transactions between module upgrades are included. Data is sorted by descending account value.

`./data/balancesReserves.json` - virtual accounts representing reserve deposits. Reserves are not eligible for refunds. Their share is distributed to the depositors of the market in further calculations.

- call `doQueryBatch` for all accounts at a block before the `EToken` upgrade
- calculate the value of all subaccounts markets as deposits - liabilities in ETH at that block
- add staking balances
- calculate total value of primary account as a sum of subaccounts value: `subaccountsTotalValue`
- filter out staking contracts accounts
- filter out accounts with no balances
- add events between the token module upgrades. ***Values calculated at price from the block before EToken upgrade***
- create virtual reserve accounts

#### Fetch remaining balances of the euler contract (assets still deposited) and their value at a block before EToken upgrade.
`npm run current` 

creates `./data/currentEulerBalances.json`

#### Calculate claims
`npm run claims`

Calculates claims of remaining balances (tokens still held by the Euler contract) and claims from ETH and DAI returned by the attacker.
- remaining Euler balances are claimable by depositors of the assets, proportionally to their deposit amounts vs total market deposits.
- in case the remaining balances are larger than sum of all deposits, each depositor receives full claim of their deposit amount
- the remaining tokens claim value is deducted from ETH and DAI claims for each eligible account
- ETH and DAI claims are calculated proportionally to the final account value (adjusted by remaining token claims)
- The total amounts of refunded assets are declared as constants in [utils.ts](./utils.ts)
```js
export const TOTAL_REFUNDED_ETH = ".."
export const TOTAL_REFUNDED_DAI = ".."
export const TOTAL_REFUNDED_USDC = ".."
```

#### Generate merkle tree
`npm run gen-merkle`

Creates `./data/merkle-tree.json` file with a tree containing all account claims on remaining and returned assets.

#### Verify the data, by summing up all staking, deposit and borrow balances and matching them with the totals:
`npm run verify`
- sum of staking balances = `StakingContract.totalSupply()`
- sum of eToken balances = `eToken.totalSupply() - eToken.reserveBalance()`
- sum of eTokenUnderlying balances = `eToken.totalSupplyUnderlying() - eToken.reserveBalanceUnderlying()`
- sum of dToken balances = `dToken.totalSupply()`
- verify sum of claims matches total amounts recovered
- each account redemption share is equal


