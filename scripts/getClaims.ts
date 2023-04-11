import { Euler } from "@eulerxyz/euler-sdk"

import fs from 'fs'
import * as dotenv from 'dotenv'
import { ethers, utils, BigNumber } from 'ethers'
import { cloneDeep } from 'lodash'

import {
  TOTAL_REFUNDED_ETH,
  TOTAL_REFUNDED_DAI,
  TOTAL_REFUNDED_USDC,
  c1e18,
  forEachMarket,
  fetchDecimals,
  COLLATERALS,
  convertToEth,
  convertReturnedToEth,
  forEachSubaccount,
  forEachNetDeposit,
  USDC_ADDR,
  CLAIM_TO_NAV_CAP,
  DAI_ADDR,
  CHAINLINK_ABI,
  CHAINLINK_ETH_USD_ADDRESS,
  BLOCK_PAUSE,
  BLOCK_REDEMPTION,
} from './utils'
import { settlementPrices, redemptionPrices } from './utils/prices'

import balancesUsers from '../data/balancesUsers.json'
import balancesReserves from '../data/balancesReserves.json'
import currentEulerBalances from '../data/currentEulerBalances.json'

import contractNames from "../integrations/contractAccountsNames.json";
import instaAccounts from "../integrations/instaAccounts.json";
import nexusAccounts from "../integrations/nexusAccounts.json";

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)

let decimals
const annotateAccounts = c => {
  const claims = cloneDeep(c)

  // annotate multisigs
  for (const name of ["GnosisSafeProxy", "GnosisSafe", "BaseWallet"]) {
    for (const account of contractNames[name]) {
        if (claims[account]) claims[account].contractType = "multisig";
    }
  }

  // annotate insta accounts
  for (const account of contractNames.InstaAccountV2) {
    if (!claims[account]) continue;
    
    claims[account].contractType = "instadapp";

    // find corresponding authority. if it's a contract, find the next authority.
    // if the only authority is a contract, use the contract as the authority
    // (all of them are multisigs except for 0xa0d3707c569ff8c87fa923d3823ec5d81c98be78)
    for (let i = 0; i < instaAccounts[account].authorities.length; i++) {
        const authority = instaAccounts[account].authorities[i];
        claims[account].authority = authority.address;

        if (!authority.isContract) break;
    }
  }

  // annotate nexus mutual clients
  for (let account in nexusAccounts) {
    if (!claims[account]) continue;

    claims[account].accountType = "nexus";
    claims[account].claimedFromNexus = nexusAccounts[account];
  }

  fs.writeFileSync('./data/claimsAnnotated.json', JSON.stringify(claims, null, 2));
}

const run = async () => {

  // initially include reserves in the redemption to later distribute the value to depositors in those markets
  const balances = {
    ...balancesUsers,
    ...balancesReserves,
  }

  decimals = await fetchDecimals(e, balances)


  // distribute remaining Euler balances proportionally to depositors


  // calculate total deposits per market
  const totalUserDeposits = {}
  const reserveDeposits = {}
  forEachMarket(balances, (m, primary) => {
    if (!totalUserDeposits[m.underlying]) totalUserDeposits[m.underlying] = BigNumber.from(0)
    const deposit = utils.parseUnits(m.eTokenBalanceUnderlying, decimals[m.symbol])
      .sub(utils.parseUnits(m.dTokenBalance, decimals[m.symbol])) // mint

    if (deposit.lte(0)) return

    if (balances[primary].isReserves) {
      reserveDeposits[m.underlying] = deposit
    } else {
      totalUserDeposits[m.underlying] = totalUserDeposits[m.underlying].add(deposit)
    }
  })

  // calculate remaining token claims per sub-account and account
  const remainingBalances = currentEulerBalances.markets
    // remaining collateral tier balances (<3 ETH total) will become a part of the main distribution
    .filter(m => m.balance !== '0.0' && !COLLATERALS.includes(m.symbol))

  forEachMarket(balances, (m, primary, subaccId) => {
    const remaining = remainingBalances.find(r => r.underlying === m.underlying)
    if (!remaining) return

    let totalMarketDeposits = totalUserDeposits[m.underlying]

    // reserves are not participating in remaining claims, but their 'virtual' claim is
    // necessary for NAV calculations
    if (balances[primary].isReserves && reserveDeposits[m.underlying]) {
      totalMarketDeposits = totalMarketDeposits.add(reserveDeposits[m.underlying])
    }

    const deposit = utils.parseUnits(m.eTokenBalanceUnderlying, decimals[m.symbol])
      .sub(utils.parseUnits(m.dTokenBalance, decimals[m.symbol])) // mint

    if (deposit.lte(0)) return

    const claimPercentage = deposit.mul(c1e18).div(totalMarketDeposits)
    const available = utils.parseUnits(remaining.balance, decimals[m.symbol])

    // if available tokens cover all deposits, cap the claim to the deposit value
    let availableAdj = available.gt(totalMarketDeposits) ? totalMarketDeposits : available

    const subacc = balances[primary][subaccId]

    if (!subacc.claims) subacc.claims = {
      remaining: {},
      totalRemainingClaimsValue: BigNumber.from(0),
    }

    const claimAmount = deposit.mul(availableAdj).div(totalMarketDeposits)
    const claimValue = convertToEth(claimAmount, settlementPrices[m.underlying], decimals[m.symbol])
    const claimValueRedemption = convertToEth(claimAmount, redemptionPrices[m.underlying], decimals[m.symbol])

    subacc.claims.remaining[m.symbol] = {
      deposits: utils.formatUnits(deposit, decimals[m.symbol]),
      totalDeposits: utils.formatUnits(totalMarketDeposits, decimals[m.symbol]),
      totalAvailable: remaining.balance,
      percentage: utils.formatEther(claimPercentage),
      claimAmount: utils.formatUnits(claimAmount, decimals[m.symbol]),
      claimValue: utils.formatEther(claimValue),
      claimValueAtRedemption: utils.formatEther(claimValueRedemption),
      underlying: m.underlying,
      decimals: decimals[m.symbol],
    }
    subacc.claims.totalRemainingClaimsValue = subacc.claims.totalRemainingClaimsValue.add(claimValue)

    if (!balances[primary].claims) balances[primary].claims = {
      remaining: {},
      totalRemainingClaimsValue: BigNumber.from(0),
      totalRemainingClaimsValueAtRedemption: BigNumber.from(0),
    }
    if (!balances[primary].claims.remaining[m.symbol]) balances[primary].claims.remaining[m.symbol] = {
      claimAmount: BigNumber.from(0),
      claimValue: BigNumber.from(0),
      decimals: decimals[m.symbol],
      underlying: m.underlying,
    }

    const claim = balances[primary].claims.remaining[m.symbol]
    claim.claimAmount = claim.claimAmount.add(claimAmount)
    claim.claimValue = claim.claimValue.add(claimValue)

    balances[primary].claims.totalRemainingClaimsValue = balances[primary].claims.totalRemainingClaimsValue.add(claimValue)
    balances[primary].claims.totalRemainingClaimsValueAtRedemption = balances[primary].claims.totalRemainingClaimsValueAtRedemption.add(claimValueRedemption)
  })

  // format remaining token claims
  forEachSubaccount(balances, subacc => {
    if (!subacc.claims) return
    subacc.claims.totalRemainingClaimsValue = utils.formatEther(subacc.claims.totalRemainingClaimsValue)
  })
  Object.values(balances).forEach((a: any) => {
    if (!a.claims) return
    a.claims.totalRemainingClaimsValue = utils.formatEther(a.claims.totalRemainingClaimsValue)
    a.claims.totalRemainingClaimsValueAtRedemption = utils.formatEther(a.claims.totalRemainingClaimsValueAtRedemption)
    Object.entries(a.claims.remaining).forEach(([symbol, c]: any) => {
      c.claimAmount = utils.formatUnits(c.claimAmount, decimals[symbol])
      c.claimValue = utils.formatEther(c.claimValue)
    })
  })

  // calculate net asset deposit amounts and net asset values
  let totalCurrentNAV = BigNumber.from(0)

  let totalForegoneProfit = BigNumber.from(0)
  forEachSubaccount(balances, (subacc, primary) => {
    const deposits = {}
    let totalDepositsValueSettlement = BigNumber.from(0)
    let totalDebtValueSettlement = BigNumber.from(0)
    let totalDepositsValueRedemption = BigNumber.from(0)
    let totalDebtValueRedemption = BigNumber.from(0)

    subacc.markets.forEach(m => {
      if (!deposits[m.underlying]) deposits[m.underlying] = { symbol: m.symbol }

      deposits[m.underlying].depositAmount = utils.parseUnits(m.eTokenBalanceUnderlying, decimals[m.symbol])
        .add(utils.parseUnits(m.stakedETokenBalanceUnderlying, decimals[m.symbol]))

      totalDepositsValueSettlement = totalDepositsValueSettlement.add(
        convertToEth(deposits[m.underlying].depositAmount, settlementPrices[m.underlying], decimals[m.symbol])
      )
      totalDebtValueSettlement = totalDebtValueSettlement.add(
        convertToEth(utils.parseUnits(m.dTokenBalance, decimals[m.symbol]), settlementPrices[m.underlying], decimals[m.symbol])
      )

      totalDepositsValueRedemption = totalDepositsValueRedemption.add(
        convertToEth(deposits[m.underlying].depositAmount, redemptionPrices[m.underlying], decimals[m.symbol])
      )
      totalDebtValueRedemption = totalDebtValueRedemption.add(
        convertToEth(utils.parseUnits(m.dTokenBalance, decimals[m.symbol]), redemptionPrices[m.underlying], decimals[m.symbol])
      )
    })

    // calculate net deposit amounts removing debt proportionally, after adjusting for remaining claims
    // also calculate current net asset value
    let currentNAV = BigNumber.from(0)
    let currentNAVRedemption = BigNumber.from(0)
    Object.entries(deposits).forEach(([underlying, d]: any) => {
      const depositAmount = deposits[underlying].depositAmount
      const remainingClaimsAmount = subacc.claims?.remaining[d.symbol]
        ? utils.parseUnits(subacc.claims?.remaining[d.symbol].claimAmount, decimals[d.symbol])
        : BigNumber.from(0)

      const totalRemainingClaimsValue = subacc.claims?.remaining
        ? utils.parseEther(subacc.claims.totalRemainingClaimsValue)
        : BigNumber.from(0)

      let netDepositAmount = totalDepositsValueSettlement.sub(totalRemainingClaimsValue).gt(0)
        ? depositAmount.sub(remainingClaimsAmount)
          .mul(c1e18.sub(totalDebtValueSettlement.mul(c1e18).div(totalDepositsValueSettlement.sub(totalRemainingClaimsValue))))
          .div(c1e18)
        : BigNumber.from(0)

      if (netDepositAmount.lt(0)) {
        console.log('Negative net deposit amount sub-acc:', subacc.address);
        netDepositAmount = BigNumber.from(0)
      }

      let netDepositAmountRedemption = totalDepositsValueRedemption.sub(totalRemainingClaimsValue).gt(0)
        ? depositAmount.sub(remainingClaimsAmount)
          .mul(c1e18.sub(totalDebtValueRedemption.mul(c1e18).div(totalDepositsValueRedemption.sub(totalRemainingClaimsValue))))
          .div(c1e18)
        : BigNumber.from(0)

      if (netDepositAmountRedemption.lt(0)) {
        netDepositAmountRedemption = BigNumber.from(0)
      }

      deposits[underlying].netDepositAmount = netDepositAmount
      deposits[underlying].netDepositAmountRedemption = netDepositAmountRedemption

      currentNAV = currentNAV.add(convertToEth(netDepositAmount, redemptionPrices[underlying.toLowerCase()], decimals[d.symbol]))
      currentNAVRedemption = currentNAVRedemption.add(convertToEth(netDepositAmountRedemption, redemptionPrices[underlying.toLowerCase()], decimals[d.symbol]))
    })

    // format values
    Object.values(deposits).forEach((d: any) => {
      d.depositAmount = utils.formatUnits(d.depositAmount, decimals[d.symbol])
      d.netDepositAmount = utils.formatUnits(d.netDepositAmount, decimals[d.symbol])
      d.netDepositAmountRedemption = utils.formatUnits(d.netDepositAmountRedemption, decimals[d.symbol])
    })

    subacc.deposits = {
      totalDepositsValue: utils.formatEther(totalDepositsValueSettlement),
      totalDebtValue: utils.formatEther(totalDebtValueSettlement),
      deposits
    }

    subacc.currentNAV = utils.formatEther(currentNAV)
    if (currentNAVRedemption.gt(0))
      subacc.currentNAVRedemption = utils.formatEther(currentNAVRedemption)

    let foregoneProfit = currentNAVRedemption.sub(currentNAV)
    if (balances[primary].isReserves || foregoneProfit.lt(0)) foregoneProfit = BigNumber.from(0)

    subacc.foregoneProfit = utils.formatEther(foregoneProfit)

    if (!balances[primary].currentNAV) balances[primary].currentNAV = BigNumber.from(0)
    if (!balances[primary].foregoneProfit) balances[primary].foregoneProfit = BigNumber.from(0)
    balances[primary].currentNAV = balances[primary].currentNAV.add(currentNAV)
    balances[primary].foregoneProfit = balances[primary].foregoneProfit.add(foregoneProfit)

    totalCurrentNAV = totalCurrentNAV.add(currentNAV) 
    totalForegoneProfit = totalForegoneProfit.add(foregoneProfit)
  })

  // calculate due claim amounts
  forEachSubaccount(balances, (subacc, primary) => {
    let currentNAV = utils.parseEther(subacc.currentNAV)

    if (currentNAV.lt(0)) {
      //throw new Error(`Negative NAV ${primary}`);
      currentNAV = BigNumber.from(0)
      console.log(`Negative NAV ${primary}`)
    }
    // calculate percentage of total value
    const percentage = currentNAV.mul(c1e18).div(totalCurrentNAV)

    // calculate claim amounts in returned tokens
    const ethClaimAmount = utils.parseEther(TOTAL_REFUNDED_ETH).mul(percentage).div(c1e18)
    const daiClaimAmount = utils.parseUnits(TOTAL_REFUNDED_DAI, 18).mul(percentage).div(c1e18)
    const usdcClaimAmount = utils.parseUnits(TOTAL_REFUNDED_USDC, 6).mul(percentage).div(c1e18)

    if (!subacc.claims) subacc.claims = {}


    subacc.claims.returned = { 
      currentNAV: utils.formatEther(currentNAV),
      percentage: utils.formatEther(percentage),
      ethClaimAmount: ethClaimAmount,
      daiClaimAmount: daiClaimAmount,
      usdcClaimAmount: usdcClaimAmount,
    }

    const claimValue = convertReturnedToEth(redemptionPrices, ethClaimAmount, daiClaimAmount, usdcClaimAmount)

    const factor = currentNAV.gt(0)
      ? claimValue.mul(c1e18).div(currentNAV)
      : BigNumber.from(0)

    subacc.claims.returnedNAV = {
      ...subacc.claims.returned,
      ethClaimAmount: utils.formatEther(ethClaimAmount),
      daiClaimAmount: utils.formatEther(daiClaimAmount),
      usdcClaimAmount: utils.formatUnits(usdcClaimAmount, 6),
      claimsToNav: utils.formatEther(factor),
    }

    if (!balances[primary].claims) balances[primary].claims = {}
    if (!balances[primary].claims.returned) balances[primary].claims.returned = {
      ethClaimAmount: BigNumber.from(0),
      daiClaimAmount: BigNumber.from(0),
      usdcClaimAmount: BigNumber.from(0),
    }

    // account totals will be summed up again, but are necessary for reserve distribution at this point
    const o = balances[primary].claims.returned
    o.ethClaimAmount = o.ethClaimAmount.add(ethClaimAmount)
    o.daiClaimAmount = o.daiClaimAmount.add(daiClaimAmount)
    o.usdcClaimAmount = o.usdcClaimAmount.add(usdcClaimAmount)
  })

  // distribute reserve claims to depositors of the market

  const totalNetDepositAmounts = {}
  forEachNetDeposit(balances, (deposit, underlying, primary) => {
    if (balances[primary].isReserves) return

    if (!totalNetDepositAmounts[underlying]) totalNetDepositAmounts[underlying] = BigNumber.from(0)

    totalNetDepositAmounts[underlying] = totalNetDepositAmounts[underlying].add(
      utils.parseUnits(deposit.netDepositAmount, decimals[deposit.symbol])
    )
  })

  Object.values(balances)
    .filter((acc: any) => acc.isReserves)
    .forEach((reserves: any) => {
      forEachNetDeposit(balances, (d, underlying, primary, subaccId) => {
        if (balances[primary].isReserves) return
        if (reserves.id0.markets[0].underlying !== underlying) return
        if (totalNetDepositAmounts[underlying].eq(0)) return

        const netDepositAmount = utils.parseUnits(d.netDepositAmount, decimals[d.symbol])
        const percentage = netDepositAmount.mul(c1e18).div(totalNetDepositAmounts[underlying])

        const ethClaimAmount = reserves.claims.returned.ethClaimAmount.mul(netDepositAmount).div(totalNetDepositAmounts[underlying])
        const daiClaimAmount = reserves.claims.returned.daiClaimAmount.mul(netDepositAmount).div(totalNetDepositAmounts[underlying])
        const usdcClaimAmount = reserves.claims.returned.usdcClaimAmount.mul(netDepositAmount).div(totalNetDepositAmounts[underlying])

        d.reserveClaims = {
          percentage: utils.formatEther(percentage),
          ethClaimAmount: utils.formatEther(ethClaimAmount),
          daiClaimAmount: utils.formatEther(daiClaimAmount),
          usdcClaimAmount: utils.formatUnits(usdcClaimAmount, 6),
        }

        // add to subacc claims
        if (!balances[primary][subaccId].claims.reserves) balances[primary][subaccId].claims.reserves = {
          ethClaimAmount: BigNumber.from(0),
          daiClaimAmount: BigNumber.from(0),
          usdcClaimAmount: BigNumber.from(0),
        }
        let o = balances[primary][subaccId].claims.reserves
        o.ethClaimAmount = o.ethClaimAmount.add(ethClaimAmount)
        o.daiClaimAmount = o.daiClaimAmount.add(daiClaimAmount)
        o.usdcClaimAmount = o.usdcClaimAmount.add(usdcClaimAmount)

        o = balances[primary][subaccId].claims.returned

        o.ethClaimAmount = o.ethClaimAmount.add(ethClaimAmount)
        o.daiClaimAmount = o.daiClaimAmount.add(daiClaimAmount)
        o.usdcClaimAmount = o.usdcClaimAmount.add(usdcClaimAmount)
      })
    })

  // cap the claims to nav factor
  let totalSurplusEth = BigNumber.from(0)
  let totalSurplusDai = BigNumber.from(0)
  let totalSurplusUsdc = BigNumber.from(0)
  const cap = utils.parseEther(CLAIM_TO_NAV_CAP)
  forEachSubaccount(balances, (subacc, primary) => {
    if (balances[primary].isReserves) return

    let ethClaim = subacc.claims.returned.ethClaimAmount
    let daiClaim = subacc.claims.returned.daiClaimAmount
    let usdcClaim = subacc.claims.returned.usdcClaimAmount
    let ethClaimCapped
    let daiClaimCapped
    let usdcClaimCapped

    const claimValue = convertReturnedToEth(redemptionPrices, ethClaim, daiClaim, usdcClaim)

    const currentNAV = utils.parseEther(subacc.currentNAV)
    const initialFactor = currentNAV.gt(0)
      ? claimValue.mul(c1e18).div(currentNAV)
      : BigNumber.from(0)

    if (currentNAV.gt(0) && initialFactor.gt(cap)) {
      const cappedClaimValue = currentNAV.mul(cap).div(c1e18)
      ethClaimCapped = ethClaim.mul(cappedClaimValue).div(claimValue)
      daiClaimCapped = daiClaim.mul(cappedClaimValue).div(claimValue)
      usdcClaimCapped = usdcClaim.mul(cappedClaimValue).div(claimValue)

      totalSurplusEth = totalSurplusEth.add(ethClaim.sub(ethClaimCapped))
      totalSurplusDai = totalSurplusDai.add(daiClaim.sub(daiClaimCapped))
      totalSurplusUsdc = totalSurplusUsdc.add(usdcClaim.sub(usdcClaimCapped))

      const claimValueCapped = convertReturnedToEth(redemptionPrices, ethClaimCapped, daiClaimCapped, usdcClaimCapped)

      const factor = claimValueCapped.mul(c1e18).div(currentNAV)
      subacc.claims.returnedPreCap = {
        ...subacc.claims.returned,
        ethClaimAmount: utils.formatEther(subacc.claims.returned.ethClaimAmount),
        daiClaimAmount: utils.formatEther(subacc.claims.returned.daiClaimAmount),
        usdcClaimAmount: utils.formatUnits(subacc.claims.returned.usdcClaimAmount, 6),
      }
      subacc.claims.returned = {
        ethClaimAmount: ethClaimCapped,
        daiClaimAmount: daiClaimCapped,
        usdcClaimAmount: usdcClaimCapped,
        totalValueAtRedemption: utils.formatEther(claimValueCapped),
        claimsToNav: utils.formatEther(factor),
      }
    } else {
      subacc.claims.returned.totalValueAtRedemption = utils.formatEther(claimValue)
      subacc.claims.returned.claimsToNav = utils.formatEther(initialFactor)
    }
  })

  // redistribute surplusto accounts with foregone profit

  forEachSubaccount(balances, (subacc, primary) => {
    if (balances[primary].isReserves) return 
    if (subacc.foregoneProfit === '0.0') return

    subacc.claims.returnedPreForegoneProfit = {
      ...subacc.claims.returned,
      ethClaimAmount: utils.formatEther(subacc.claims.returned.ethClaimAmount),
      daiClaimAmount: utils.formatEther(subacc.claims.returned.daiClaimAmount),
      usdcClaimAmount: utils.formatUnits(subacc.claims.returned.usdcClaimAmount, 6),
    }

    delete subacc.claims.returned.claimsToNav

    const ethShare = utils.parseEther(subacc.foregoneProfit).mul(totalSurplusEth).div(totalForegoneProfit)
    const daiShare = utils.parseEther(subacc.foregoneProfit).mul(totalSurplusDai).div(totalForegoneProfit)
    const usdcShare = utils.parseEther(subacc.foregoneProfit).mul(totalSurplusUsdc).div(totalForegoneProfit)

    subacc.claims.returned.ethClaimAmount = subacc.claims.returned.ethClaimAmount.add(ethShare)
    subacc.claims.returned.daiClaimAmount = subacc.claims.returned.daiClaimAmount.add(daiShare)
    subacc.claims.returned.usdcClaimAmount = subacc.claims.returned.usdcClaimAmount.add(usdcShare)


    const surplusValue = convertReturnedToEth(redemptionPrices, ethShare, daiShare, usdcShare)

    subacc.claims.returnedSurplus = {
      ethClaimAmount: utils.formatEther(ethShare),
      daiClaimAmount: utils.formatEther(daiShare),
      usdcClaimAmount: utils.formatUnits(usdcShare, 6),
      totalValue: utils.formatEther(surplusValue),
    }

    const claimValue = convertReturnedToEth(
      redemptionPrices,
      subacc.claims.returned.ethClaimAmount,
      subacc.claims.returned.daiClaimAmount,
      subacc.claims.returned.usdcClaimAmount
    )

    subacc.claims.returned.totalValueAtRedemption = utils.formatEther(claimValue)
  })
 
  // re-calculate total returned claims per account
  Object.values(balances).forEach((a: any) => {
    a.claims.returned = {
      ethClaimAmount: BigNumber.from(0),
      daiClaimAmount: BigNumber.from(0),
      usdcClaimAmount: BigNumber.from(0),
    }
  })
  forEachSubaccount(balances, (subacc, primary) => {
    let o = balances[primary].claims.returned
    o.ethClaimAmount = o.ethClaimAmount.add(subacc.claims.returned.ethClaimAmount)
    o.daiClaimAmount = o.daiClaimAmount.add(subacc.claims.returned.daiClaimAmount)
    o.usdcClaimAmount = o.usdcClaimAmount.add(subacc.claims.returned.usdcClaimAmount)
  })

  // format subaccount claims
  forEachSubaccount(balances, (subacc, primary) => {
    subacc.claims.returned.ethClaimAmount = utils.formatEther(subacc.claims.returned.ethClaimAmount) 
    subacc.claims.returned.daiClaimAmount = utils.formatEther(subacc.claims.returned.daiClaimAmount) 
    subacc.claims.returned.usdcClaimAmount = utils.formatUnits(subacc.claims.returned.usdcClaimAmount, 6)

    if (subacc.claims.reserves) {
      subacc.claims.reserves.ethClaimAmount = utils.formatEther(subacc.claims.reserves.ethClaimAmount) 
      subacc.claims.reserves.daiClaimAmount = utils.formatEther(subacc.claims.reserves.daiClaimAmount) 
      subacc.claims.reserves.usdcClaimAmount = utils.formatUnits(subacc.claims.reserves.usdcClaimAmount, 6)
    }
  })

  // format total account claims
  Object.values(balances).forEach((a: any) => {
    a.claims.totalReturnedClaimsValueAtRedemption = utils.formatEther(
      convertReturnedToEth(
        redemptionPrices,
        a.claims.returned.ethClaimAmount,
        a.claims.returned.daiClaimAmount,
        a.claims.returned.usdcClaimAmount,
      )
    )

    a.currentNAV = utils.formatEther(a.currentNAV)
    a.foregoneProfit = utils.formatEther(a.foregoneProfit)
    a.claims.returned.daiClaimValue = utils.formatEther(
      convertToEth(a.claims.returned.daiClaimAmount, redemptionPrices[DAI_ADDR], 18), 
    )
    a.claims.returned.usdcClaimValue = utils.formatEther(
      convertToEth(a.claims.returned.usdcClaimAmount, redemptionPrices[USDC_ADDR], 6), 
    )

    a.claims.returned.ethClaimAmount = utils.formatEther(a.claims.returned.ethClaimAmount)
    a.claims.returned.daiClaimAmount = utils.formatEther(a.claims.returned.daiClaimAmount)
    a.claims.returned.usdcClaimAmount = utils.formatUnits(a.claims.returned.usdcClaimAmount, 6)
  })


  e.addContract('chainlinkEthUsd', CHAINLINK_ABI, CHAINLINK_ETH_USD_ADDRESS)
  const settlementEthPrice = await e.contracts.chainlinkEthUsd.latestAnswer({ blockTag: BLOCK_PAUSE })
  const redemptionEthPrice = await e.contracts.chainlinkEthUsd.latestAnswer({ blockTag: BLOCK_REDEMPTION })

  console.log('\n')
  console.log(`USD/ETH settlement price at block ${BLOCK_PAUSE}: `, utils.formatUnits(settlementEthPrice, 8));
  console.log(`USD/ETH redemption price at block ${BLOCK_REDEMPTION}: `, utils.formatUnits(redemptionEthPrice, 8));

  const userClaims = Object.fromEntries(
    Object.entries(balances).filter(([_, a]: any) => !a.isReserves)
  )

  fs.writeFileSync('./data/claims.json', JSON.stringify(userClaims, null, 2)) 

  const reserveClaims = Object.fromEntries(
    Object.entries(balances).filter(([_, a]: any) => a.isReserves)
  )

  fs.writeFileSync('./data/claimsReservesVirtual.json', JSON.stringify(reserveClaims, null, 2)) 

  annotateAccounts(userClaims)
}

run()
