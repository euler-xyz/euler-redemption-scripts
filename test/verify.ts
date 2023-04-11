import { Euler } from "@eulerxyz/euler-sdk"
import fs from 'fs'

import * as dotenv from 'dotenv'
import { ethers, utils, BigNumber } from 'ethers'
import { assert } from 'chai'

import {
  ETOKEN_UPGRADE_BLOCK,
  STAKING_CONTRACTS,
  STAKING_ABI,
  forEachMarket,
  fetchDecimals,
  forEachSubaccount,
  forEachNetDeposit,
  TOTAL_REFUNDED_ETH,
  TOTAL_REFUNDED_DAI,
  TOTAL_REFUNDED_USDC,
  COLLATERALS,
  convertToEth,
  c1e18,
  DAI_ADDR,
  USDC_ADDR,
  CLAIM_TO_NAV_CAP,
} from '../scripts/utils'

import { settlementPrices, redemptionPrices } from '../scripts/utils/prices'

import balances from '../data/balancesAllETokenUpgrade.json'
import claims from '../data/claims.json'
import claimsReserves from '../data/claimsReservesVirtual.json'
import remainingAssets from '../data/currentEulerBalances.json'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)
let decimals = {}

e.addContract('stakingUSDC', STAKING_ABI, STAKING_CONTRACTS[0])
e.addContract('stakingUSDT', STAKING_ABI, STAKING_CONTRACTS[1])
e.addContract('stakingWETH', STAKING_ABI, STAKING_CONTRACTS[2])

const assertEqualish = (val1, val2, tolerance, msg) => {
  assert.isTrue(val1.sub(val2).abs().lt(utils.parseEther(tolerance)), msg)
}


const verifyStakingTotals = async balances => {
  let wethStakedETokenTotal = BigNumber.from(0)
  let usdcStakedETokenTotal = BigNumber.from(0)
  let usdtStakedETokenTotal = BigNumber.from(0)

  forEachMarket(balances, m => {
    if (m.symbol === 'WETH') wethStakedETokenTotal = wethStakedETokenTotal.add(utils.parseEther(m.stakedETokenBalance))
    if (m.symbol === 'USDC') usdcStakedETokenTotal = usdcStakedETokenTotal.add(utils.parseEther(m.stakedETokenBalance))
    if (m.symbol === 'USDT') usdtStakedETokenTotal = usdtStakedETokenTotal.add(utils.parseEther(m.stakedETokenBalance))
  })

  const wethTotalSupply = await e.contracts.stakingWETH.totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK })
  const usdcTotalSupply = await e.contracts.stakingUSDC.totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK })
  const usdtTotalSupply = await e.contracts.stakingUSDT.totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK })

  assert.isTrue(wethTotalSupply.eq(wethStakedETokenTotal))
  assert.isTrue(usdcTotalSupply.eq(usdcStakedETokenTotal))
  assert.isTrue(usdtTotalSupply.eq(usdtStakedETokenTotal))

  console.log('staking totals: ok');
}

const verifyETokenTotals = async balances => {
  const eTokenTotals = {}
  const eTokens = {}

  forEachMarket(balances, m => {
    if (!eTokenTotals[m.symbol]) eTokenTotals[m.symbol] = BigNumber.from(0)
    eTokenTotals[m.symbol] = eTokenTotals[m.symbol].add(utils.parseEther(m.stakedETokenBalance)).add(utils.parseEther(m.eTokenBalance))
    eTokens[m.symbol] = m.eTokenAddr
  })

  const totalSupplies = await Promise.all(Object.values(eTokens).map(
    async (u: any) => {
      const totalSupply = await e.eToken(u).totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK - 1})
      const reserves = await e.eToken(u).reserveBalance({ blockTag: ETOKEN_UPGRADE_BLOCK - 1})
      return totalSupply.sub(reserves)
    }
  ))
    
  Object.entries(eTokens).forEach(([symbol]: any, i) => {
    if (symbol === 'HMT') assertEqualish(eTokenTotals[symbol], totalSupplies[i], '1', symbol)
    else assertEqualish(eTokenTotals[symbol], totalSupplies[i], '0.00001', symbol)
  })

  console.log('eToken totals: ok');
}

const verifyUnderlyingTotals = async balances => {
  const underlyingTotals = {}
  const eTokens = {}
  
  forEachMarket(balances, m => {
    if (!underlyingTotals[m.symbol]) underlyingTotals[m.symbol] = BigNumber.from(0)
    underlyingTotals[m.symbol] = underlyingTotals[m.symbol]
      .add(utils.parseUnits(m.stakedETokenBalanceUnderlying, decimals[m.symbol]))
      .add(utils.parseUnits(m.eTokenBalanceUnderlying, decimals[m.symbol]))
    eTokens[m.symbol] = m.eTokenAddr
  })

  const totalSupplies = await Promise.all(Object.values(eTokens).map(
    async (u: any) => {
      const totalSupply = await e.eToken(u).totalSupplyUnderlying({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      const reserves = await e.eToken(u).reserveBalanceUnderlying({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      return totalSupply.sub(reserves)
    }
  ))

  Object.entries(eTokens).forEach(([symbol]: any, i) => {
    if (symbol === 'HMT') assertEqualish(underlyingTotals[symbol], totalSupplies[i], '2', symbol)
    else assertEqualish(underlyingTotals[symbol], totalSupplies[i], '0.00001', symbol)
  })

  console.log('underlying totals: ok');
}

const verifyBorrowTotals = async balances => {
  const underlyingTotals = {}
  const underlyings = {}

  forEachMarket(balances, m => {
    if (!underlyingTotals[m.symbol]) underlyingTotals[m.symbol] = BigNumber.from(0)
    underlyingTotals[m.symbol] = underlyingTotals[m.symbol]
      .add(utils.parseUnits(m.dTokenBalance, decimals[m.symbol]))
    underlyings[m.symbol] = m.underlying
  })

 
  const totalSupplies = await Promise.all(Object.values(underlyings).map(
    async (u: any) => {
      const dTokenAddr = await e.contracts.markets.underlyingToDToken(u, { blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      const totalSupply = await e.dToken(dTokenAddr).totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      return totalSupply
    }
  ))
    
  Object.entries(underlyings).forEach(([symbol]: any, i) => {
    assertEqualish(underlyingTotals[symbol], totalSupplies[i], '0.00001', symbol)
  })

  console.log('dToken totals: ok');
}

const verifyValueTotals = async balances => {
  let totalAccountValue = BigNumber.from(0)
  const accountValue = {}
  const marketValue = {}
  const eTokens = {}
  let totalDeposits = BigNumber.from(0)
  const marketTotalDeposits = {}

  // get TVL on block before EToken
  forEachMarket(balances, m => {
    eTokens[m.symbol] = {
      underlying: m.underlying,
      eTokenAddr: m.eTokenAddr,
      dTokenAddr: m.dTokenAddr,
    }
    if (!marketValue[m.symbol]) marketValue[m.symbol] = BigNumber.from(0)
    marketValue[m.symbol] = marketValue[m.symbol].add(utils.parseEther(m.totalValue))
  })

  await Promise.all(
    Object.entries(eTokens).map(async ([symbol, m]: any) => {
      const totalSupply = await e.eToken(m.eTokenAddr).totalSupplyUnderlying({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      const reserves = await e.eToken(m.eTokenAddr).reserveBalanceUnderlying({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })
      const totalBorrows = await e.dToken(m.dTokenAddr).totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK - 1 })

      marketTotalDeposits[symbol] = convertToEth(
        totalSupply.sub(reserves).sub(totalBorrows),
        settlementPrices[m.underlying],
        decimals[symbol]
      )

      totalDeposits = totalDeposits.add(marketTotalDeposits[symbol])
    })
  )

  // check subaccount values match account totals

  forEachSubaccount(balances, (a, primary) => {
    if (!accountValue[primary]) accountValue[primary] = BigNumber.from(0)

    accountValue[primary] = accountValue[primary].add(utils.parseEther(a.totalValue))
    totalAccountValue = totalAccountValue.add(utils.parseEther(a.totalValue))
  })

  Object.entries(balances).forEach(([primary]) => {
    assert.isTrue(accountValue[primary].eq(utils.parseEther(balances[primary].subaccountsTotalValue)), `subaccount sum ${primary}`)
  })

  // check markets value

  Object.entries(marketValue).forEach(([symbol, v]: any) => {
    // rounding errors are magnified for <18 decimal tokens
    if (['USDC', 'USDT', 'WBTC', 'GUSD'].includes(symbol))
      assertEqualish(v, marketTotalDeposits[symbol], '0.1', `market value ${symbol}`)
    else
      assertEqualish(v, marketTotalDeposits[symbol], '0.00001', `market value ${symbol}`)
  })

  // check account values match TVL
  assertEqualish(totalDeposits, totalAccountValue, '0.1', 'total value')

  // check total deposits match euler balances

  Object.keys(eTokens).forEach(symbol => {

  })

  console.log('value totals: ok');
}

const verifyRemainingClaimsTotals = claims => {
  let totalClaimsOnSubaccounts = BigNumber.from(0)
  let totalAccountClaims = BigNumber.from(0)
  remainingAssets.markets.forEach(m => {

    // sum up all deposits and claims

    let totalDeposits = BigNumber.from(0)
    let totalValue = BigNumber.from(0)
    let totalClaimsAmount = BigNumber.from(0)
    let totalClaimsValue = BigNumber.from(0)

    forEachMarket(claims, b => {
      if (b.symbol === m.symbol) {
        const netDeposit = utils.parseUnits(b.eTokenBalanceUnderlying, decimals[m.symbol])
          .sub(utils.parseUnits(b.dTokenBalance, decimals[m.symbol]))
        if (netDeposit.gt(0)) {
          totalDeposits = totalDeposits.add(netDeposit)
          totalValue = totalValue.add(utils.parseEther(b.totalValue))
        }
      }
    }) 

    Object.values(claims).forEach((c: any) => {
      if (c.claims.remaining?.[m.symbol]) {
        totalClaimsAmount = totalClaimsAmount.add(utils.parseUnits(c.claims.remaining[m.symbol].claimAmount, decimals[m.symbol]))
        totalClaimsValue = totalClaimsValue.add(utils.parseEther(c.claims.remaining[m.symbol].claimValue))
      }
    })

    // if available balances cover all claims, sum of all claims is equal to sum of all deposits
    const eulerBalance = utils.parseUnits(m.balance, decimals[m.symbol])
    if (eulerBalance.gt(totalDeposits)) {
      assert.isTrue(totalClaimsAmount.eq(totalDeposits), `total deposits and total claims amounts mismatch ${m.symbol}`)
      assertEqualish(totalClaimsValue, totalValue, '0.0000001', `total deposits and total claims values mismatch ${m.symbol}`)
    }
    // if available balances are not sufficient to cover all claims, sum of all claims is equal to available balance
    else {
      if (COLLATERALS.includes(m.symbol)) return // remaining dust collateral balances will be added to the general claims pool
      const eulerValue = utils.parseEther(m.value)
      assertEqualish(totalClaimsAmount, eulerBalance, '0.0000001', `total claims and available balance amounts mismatch ${m.symbol}`)
      assert.isTrue(totalClaimsAmount.lte(eulerBalance), `total claims are greater than balance ${m.symbol}`)
      assertEqualish(totalClaimsValue, eulerValue, '0.0000001', `total claims and available balance values mismatch ${m.symbol}`)
    }

    totalClaimsOnSubaccounts = totalClaimsOnSubaccounts.add(totalClaimsValue)
  })

  Object.values(claims).forEach((a: any) => {
    totalAccountClaims = totalAccountClaims.add(utils.parseEther(a.claims.totalRemainingClaimsValue || '0'))
  })
  assertEqualish(totalClaimsOnSubaccounts, totalAccountClaims, '0.0000001', `total claims on sub-accounts don't match totals on accounts`)

  console.log('remaining claims totals: ok');
}

const verifyReturnedClaimsTotals = (claims, claimsReserves) => {
  const returnedEth = utils.parseEther(TOTAL_REFUNDED_ETH)
  const returnedDai = utils.parseEther(TOTAL_REFUNDED_DAI)
  const returnedUsdc = utils.parseUnits(TOTAL_REFUNDED_USDC, 6)

  // check all claims sum up to returned value
  let totalEthClaim = {}
  let totalDaiClaim = {}
  let totalUsdcClaim = {}

  forEachNetDeposit(claims, (d, underlying) => {
    if (!d.reserveClaims) return
    if(!totalEthClaim[underlying]) totalEthClaim[underlying] = BigNumber.from(0)
    if(!totalDaiClaim[underlying]) totalDaiClaim[underlying] = BigNumber.from(0)
    if(!totalUsdcClaim[underlying]) totalUsdcClaim[underlying] = BigNumber.from(0)

    totalEthClaim[underlying] = totalEthClaim[underlying].add(utils.parseEther(d.reserveClaims.ethClaimAmount))
    totalDaiClaim[underlying] = totalDaiClaim[underlying].add(utils.parseEther(d.reserveClaims.daiClaimAmount))
    totalUsdcClaim[underlying] = totalUsdcClaim[underlying].add(utils.parseUnits(d.reserveClaims.usdcClaimAmount, 6))
  })

  let totalUndistributedEth = BigNumber.from(0)
  let totalUndistributedDai = BigNumber.from(0)
  let totalUndistributedUsdc = BigNumber.from(0)

  Object.values(claimsReserves).forEach((r: any) => {
    const underlying = r.id0.markets[0].underlying
    const symbol = r.id0.markets[0].symbol
    const reserveEthClaim = utils.parseEther(r.claims.returned.ethClaimAmount)
    const reserveDaiClaim = utils.parseEther(r.claims.returned.daiClaimAmount)
    const reserveUsdcClaim = utils.parseUnits(r.claims.returned.usdcClaimAmount, 6)

    if (!totalEthClaim[underlying]) {
      totalUndistributedEth = totalUndistributedEth.add(reserveEthClaim)
      totalUndistributedDai = totalUndistributedDai.add(reserveDaiClaim)
      totalUndistributedUsdc = totalUndistributedUsdc.add(reserveUsdcClaim)
    } else {
      assertEqualish(totalEthClaim[underlying], reserveEthClaim, '0.000001', `Total reserve ETH claims for ${symbol}`)
      assertEqualish(totalDaiClaim[underlying], reserveDaiClaim, '0.000001', `Total reserve DAI claims for ${symbol}`)
      assertEqualish(totalUsdcClaim[underlying], reserveUsdcClaim, '0.1', `Total reserve USDC claims for ${symbol}`)
    }
  })

  // PUNK and MATIC markets have non zero claims, but no depositors with net asset deposit > 0
  const maticClaims = claimsReserves.reserveMATIC.claims.returned
  const punkClaims = claimsReserves.reservePUNK.claims.returned
  assert.isTrue(
    totalUndistributedEth.eq(
      utils.parseEther(maticClaims.ethClaimAmount).add(utils.parseEther(punkClaims.ethClaimAmount)),
    ),
    'undistributed eth'
  )
  assert.isTrue(
    totalUndistributedDai.eq(
      utils.parseEther(maticClaims.daiClaimAmount).add(utils.parseEther(punkClaims.daiClaimAmount)),
    ),
    'undistributed dai'
  )
  assert.isTrue(
    totalUndistributedUsdc.eq(
      utils.parseUnits(maticClaims.usdcClaimAmount, 6).add(utils.parseUnits(punkClaims.usdcClaimAmount, 6)),
    ),
    'undistributed usdc'
  )

  // check all claims sum up to returned value

  const totalEthClaims = Object.values(claims).reduce(
    (accu: any, a: any) => accu.add(utils.parseEther(a.claims.returned.ethClaimAmount)),
    BigNumber.from(0)
  ) as any

  assertEqualish(totalEthClaims.add(totalUndistributedEth), returnedEth, '0.000001', 'Total ETH claims')
  assert.isTrue(totalEthClaims.lte(returnedEth))

  const totalDaiClaims = Object.values(claims).reduce(
    (accu: any, a: any) => accu.add(utils.parseEther(a.claims.returned.daiClaimAmount)),
    BigNumber.from(0)
  ) as any

  assertEqualish(totalDaiClaims.add(totalUndistributedDai), returnedDai, '1', 'Total DAI claims')
  assert.isTrue(totalDaiClaims.lte(returnedDai))

  const totalUsdcClaims = Object.values(claims).reduce(
    (accu: any, a: any) => accu.add(utils.parseUnits(a.claims.returned.usdcClaimAmount, 6)),
    BigNumber.from(0)
  ) as any

  assertEqualish(totalUsdcClaims.add(totalUndistributedUsdc), returnedUsdc, '1', 'Total USDC claims')
  assert.isTrue(totalUsdcClaims.lte(returnedUsdc))

  // check all sub-acc claims sum up to returned value

  let totalEthClaimsSubacc = BigNumber.from(0)
  let totalDaiClaimsSubacc = BigNumber.from(0)
  let totalUsdcClaimsSubacc = BigNumber.from(0)

  forEachSubaccount(claims, s => {
    totalEthClaimsSubacc = totalEthClaimsSubacc
      .add(utils.parseEther(s.claims.returned.ethClaimAmount))
    totalDaiClaimsSubacc = totalDaiClaimsSubacc
      .add(utils.parseEther(s.claims.returned.daiClaimAmount))
    totalUsdcClaimsSubacc = totalUsdcClaimsSubacc
      .add(utils.parseUnits(s.claims.returned.usdcClaimAmount, 6))
  })

  assertEqualish(totalEthClaimsSubacc.add(totalUndistributedEth), returnedEth, '0.000001', 'Total ETH claims')
  assert.isTrue(totalEthClaimsSubacc.lte(returnedEth))

  assertEqualish(totalDaiClaimsSubacc.add(totalUndistributedDai), returnedDai, '1', 'Total DAI claims')
  assert.isTrue(totalDaiClaimsSubacc.lte(returnedDai))

  assertEqualish(totalUsdcClaimsSubacc.add(totalUndistributedUsdc), returnedUsdc, '1', 'Total USDC claims')
  assert.isTrue(totalUsdcClaimsSubacc.lte(returnedUsdc))

  // check total returned claims value

  const totalReturnedValue = returnedEth
    .add(convertToEth(returnedDai, redemptionPrices[DAI_ADDR], 18))
    .add(convertToEth(returnedUsdc, redemptionPrices[USDC_ADDR], 6))

  const totalUndistributedValue = totalUndistributedEth
    .add(convertToEth(totalUndistributedDai, redemptionPrices[DAI_ADDR], 18))
    .add(convertToEth(totalUndistributedUsdc, redemptionPrices[USDC_ADDR], 6))


  const sumTotalReturnedClaimsValueAtRedemption = Object.values(claims).reduce(
    (accu: any, a: any) => accu.add(utils.parseEther(a.claims.totalReturnedClaimsValueAtRedemption)),
    BigNumber.from(0)
  ) as BigNumber

  assertEqualish(sumTotalReturnedClaimsValueAtRedemption.add(totalUndistributedValue), totalReturnedValue, '0.0001', 'Total returned value at redemption')

  console.log('returned claims totals: ok');
}

const verifyNAVRedemption = claims => {
  const daiRedemptionPrice = redemptionPrices[DAI_ADDR]
  const usdcRedemptionPrice = redemptionPrices[USDC_ADDR]
  
  let shareRedeemed = BigNumber.from(0)

  Object.keys(claims).forEach(primary => {
    let accountTotalNetValue = BigNumber.from(0)
    let accountTotalValueRedeemed = BigNumber.from(0)

    Object.keys(claims[primary]).forEach(subacc => {
      if (!subacc.startsWith('id')) return

      // net value of the subaccount after positions are settled in proportional manner
      const subaccDeposits = claims[primary][subacc].deposits.deposits
      const subaccTotalNetValue = Object.keys(subaccDeposits).reduce((accu, underlying) => 
        accu.add(utils.parseEther(subaccDeposits[underlying].netDepositAmount)
          .mul(redemptionPrices[underlying]).div(c1e18))
      , BigNumber.from(0))

      // redeemed value for the subaccount (without including reserves, caps and forgone profit)
      const subaccReturned = claims[primary][subacc].claims.returnedNAV

      const subaccTotalValueRedeemed = utils.parseEther(subaccReturned.ethClaimAmount)
        .add(convertToEth(utils.parseEther(subaccReturned.daiClaimAmount), daiRedemptionPrice, 18))
        .add(convertToEth(utils.parseUnits(subaccReturned.usdcClaimAmount, 6), usdcRedemptionPrice, 6))

      accountTotalNetValue = accountTotalNetValue.add(subaccTotalNetValue)
      accountTotalValueRedeemed = accountTotalValueRedeemed.add(subaccTotalValueRedeemed)

      if (subaccTotalNetValue.lt(utils.parseEther('0.0001'))) return // skip subaccounts with very small balances

      // initialize shareRedeemed when passing for the first time
      if (shareRedeemed.eq(0)) {
        shareRedeemed = subaccTotalValueRedeemed.mul(c1e18).div(subaccTotalNetValue)
      }

      // each subaccount should be able to buy back the same share of its net value after redemption
      assertEqualish(
        subaccTotalValueRedeemed.mul(c1e18).div(subaccTotalNetValue), 
        shareRedeemed, 
        '0.0001', 
        'Subaccount share redeemed'
      )
    })

    if (accountTotalNetValue.lt(utils.parseEther('0.0001'))) return // skip accounts with very small balances

    // each account should be able to buy back the same share of its net value after redemption
    assertEqualish(
      accountTotalValueRedeemed.mul(c1e18).div(accountTotalNetValue),
      shareRedeemed, 
      '0.0001', 
      'Account share redeemed'
    )
  })

  console.log('share redeemed: ok\t', utils.formatEther(shareRedeemed));
}

const verifyForegoneProfit = claims => {
  forEachSubaccount(claims, s => {
    const currentNAV = utils.parseEther(s.currentNAV)
    const currentNAVRedemption = utils.parseEther(s.currentNAVRedemption || '0')
    const forgoneProfit = utils.parseEther(s.forgoneProfit || '0')
    const claimsValue = utils.parseEther(s.claims.returned.ethClaimAmount)
      .add(convertToEth(utils.parseEther(s.claims.returned.daiClaimAmount), redemptionPrices[DAI_ADDR], 18))
      .add(convertToEth(utils.parseUnits(s.claims.returned.usdcClaimAmount, 6), redemptionPrices[USDC_ADDR], 6))

    const due = currentNAV.add(forgoneProfit)

    // all non dust accounts are fully compensated
    if (due.gt(utils.parseEther("1").div(100))) {
      assert.isTrue(claimsValue.gte(due))
      const minClaimToNav = utils.parseEther(CLAIM_TO_NAV_CAP).sub(c1e18).mul(90).div(100)

      const nav = forgoneProfit.gt(0) ? currentNAVRedemption : currentNAV
      assert.isTrue(claimsValue.sub(nav).mul(c1e18).div(nav).gt(minClaimToNav))
    }
  })

  console.log('forgone profit: ok');
}

const run = async () => {
  decimals = await fetchDecimals(e, balances)

  await verifyStakingTotals(balances)
  await verifyETokenTotals(balances)
  await verifyUnderlyingTotals(balances)
  await verifyBorrowTotals(balances)
  await verifyValueTotals(balances)
  verifyRemainingClaimsTotals(claims)
  verifyNAVRedemption(claims)
  verifyReturnedClaimsTotals(claims, claimsReserves)
  verifyForegoneProfit(claims)
}

run()
