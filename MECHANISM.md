## Summary

The 2023-03-13 attack on Euler extracted the majority of funds held by the protocol and converted them into ETH and DAI. Much of this has been recovered and will now be distributed back to Euler users according to the scheme outlined below. 

### Update Summary

This final mechanism for redemption builds upon an earlier plan and contains a number of important updates designed to address feedback. Specifically, once every ordinary depositor has been accounted for, any additive effects of exchange rate fluctuations, insurance payouts, and reserves are no longer socialised for the benefit of all users, but are instead allocated to those with open positions that had otherwise foregone trading profit as a result of the protocol becoming paused. Specifics for how this is achieved are highlighted below.

## Calculations

### Asset Values

* For each sub-account, Euler simulates the repayment of all liabilities at the block the protocol was disabled. The on-chain oracle price (either Uniswap or Chainlink, depending on the market) as defined in the smart contract at this time is used to determine the ETH value of the assets and liabilities, and each of the sub-account’s assets (including non-collateral assets) is proportionally used to repay the liability, assuming no slippage.
  * Self-collateralised positions are treated the same as other positions
  * Staked ETokens are handled equivalently to their underlying ETokens
  * The protocol reserves are not eligible for any redemption, and instead will be used to cover bad debt for dust sub-accounts, and the remainder will be proportionally allocated to depositors on the respective markets
  * Markets that have bad debt in excess of reserves (a few long-tail markets that suffered oracle attacks) will have the bad debt proportionally distributed amongst depositors in the market
* The previous step leaves each sub-account with a basket of various assets. The net asset value (NAV) of the sub-account is computed by converting each item in the basket to ETH using a secure pricing method snapshot taken at a pre-announced future "redemption" block.
  * A sub-account with negative NAV will be considered to have a NAV of 0.
* Additionally, each sub-account also has an alternate NAV computed by simulating the repayment of all liabilities using the same methodology as above, except using the price at the redemption block for the liquidation prices. A user's "foregone profit" is defined as `max(alternateNAV - NAV, 0)`.

### Allocation

* Remaining balances currently held by the Euler contract will be claimable by depositors as original tokens, proportional to their deposit amounts vs total market deposits.
  * In case the remaining balances are larger than the sum of all deposits, each depositor will be able to claim the full deposited amount of tokens.
  * The value of the claimed tokens (using Euler prices as described above) will be deducted from the sub-account's NAV prior to the simulated repay.
* All sub-account NAVs will be summed to get the total NAV. Each sub-account will be allocated claims on the recovered ETH, DAI, and USDC according to its proportion of the total NAV.
* If at redemption time prices the value of claims allocated to a sub-account exceed `NAV * 1.005`, the claims on the recovered ETH, DAI, and USDC will be capped at this value, and the excess will be added to the foregone profit allocation.
* After all sub-accounts have had their claims capped, the foregone profit allocation will be proportionally distributed to each sub-account with non-zero foregone profit.

### Full-Accounts

* Each account’s claimable basket is computed by summing up the claimable amounts of each sub-account.

## Mechanism

A smart contract will be created that contains the funds due to all EOAs. This contract will have a root of a merkle tree embedded. In order to claim the redemption, an EOA will need to pass in two items:

* The claim information for the account along with a merkle proof of validity
* An acceptance token that is individually computed for each account, and confirms that the account holder agrees with the terms and conditions.

## Smart Contract Accounts

There are 141 affected smart contract accounts. Smart contracts can not necessarily execute the claim method on the merkle distributor contract. Furthermore, claims can not necessarily be sent directly to smart contracts without causing problems with their internal accounting.

For these reasons, smart contracts will have to be handled on a case-by-case basis. Representatives of the Euler Foundation will communicate with Affected protocols and smart contract wallet holders can contact this email address for guidance given their particular situations: contact@euler.foundation

### Multi-Sig Wallets

Multi-sig wallets are a special sub-case of smart contract accounts that can invoke the claiming method on the merkle distributor contract, after their signatories agree on the terms and conditions. All addresses that are confirmed to be multi-sig wallets will be added to the initial merkle distribution.

### Instadapp Accounts

Instadapp Accounts are a special sub-case of smart contract accounts that have a list of authorities (either EOA or multi-sigs) in control, but they cannot invoke the claiming method on the merkle distributor contract themselves. Hence, instead of adding the Instadapp Accounts addresses to the merkle distribution, they will be substituted with the first corresponding authority address that is able to invoke the claiming method on the merkle distributor contract and claim on behalf of Instadapp Account address.

## Funds Recovered

Recovered funds include all those returned to the Euler DAO Treasury address following negotiations, totaling 95,556.36059211764 ETH and 43,063,729.35 DAI. Unrecovered funds at this point include funds sent by the attacker to Tornado Cash, totaling 1,100 ETH and those sent to an address owned by the Ronin attacker, totalling 100 ETH. Another 100 ETH were returned by the attacker directly to a user, who in turn returned 12 ETH to the Euler DAO Treasury (included above). The DAO Treasury address also holds 3,396,964 USDC and 1,007,321 DAI from Sherlock protocol insurance payouts.
