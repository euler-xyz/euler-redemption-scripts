import { Euler } from "@eulerxyz/euler-sdk"

import fs from 'fs'
import * as dotenv from 'dotenv'
import { ethers, utils, BigNumber } from 'ethers'
import { chunk, uniqWith } from 'lodash'


import accounts from '../data/accounts.json'
import finalEvents from '../data/eventsBetweenUpgrades.json'

import {
  ATTACK_ACCOUNTS,
  STAKING_CONTRACTS,
  STAKING_ETOKENS,
  c1e18,
  convertToEth,
  forEachSubaccount,
  ETOKEN_UPGRADE_BLOCK,
  EXCLUDED_ACCOUNTS,
  fetchDecimals,
  getTokenList,
  forEachMarket,
  PRE_BLOCK,
} from './utils'
import { settlementPrices } from './utils/prices'

import staked from '../data/staked.json'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)

const BATCH_SIZE = 20

const blockFilter = { blockTag: ETOKEN_UPGRADE_BLOCK - 1 }

let decimals


// NOTE: On last EToken block
const getConversionRates = async () => {
  const USDC = await e.eToken(STAKING_ETOKENS.USDC).convertBalanceToUnderlying(c1e18, blockFilter)
  const USDT = await e.eToken(STAKING_ETOKENS.USDT).convertBalanceToUnderlying(c1e18, blockFilter)
  const WETH = await e.eToken(STAKING_ETOKENS.WETH).convertBalanceToUnderlying(c1e18, blockFilter)
  return { USDC, USDT, WETH }
}

const getPrice = (market: any) => {
  const price = settlementPrices?.[market.underlying.toLowerCase()] || market.twap;

  if (!price) throw 'Unable to get settlement price, unexpected underlying ' + market.underlying.toLowerCase();

  return price;
}

const fetchBalances = async (accounts) => {
  const tokenList = await getTokenList()
  const conversionRates = await getConversionRates()

  let balances = {}
  let totalStakedValue = BigNumber.from(0)
  const queryRaw = []

  for (let batch of chunk(Object.entries(accounts), BATCH_SIZE)) {
    const batchAccounts = batch
      .reduce((accu, [primary, val]) => {
        accu.push(...Object.values(val).filter(val => typeof val === 'object').map((v: any) => ({...v, primary})))
        return accu
      }, [])

    // filter out staking contracts
    const queryBatch = batchAccounts
      .map(a => ({
        eulerContract: e.addresses.euler,
        account: a.address,
        markets: a.markets,
      }))

    let res 
    try {
      res = await e.contracts.eulerGeneralView.doQueryBatch(queryBatch, blockFilter)
    } catch {
      res = await e.contracts.eulerGeneralView.doQueryBatch(queryBatch, blockFilter)
    }
    queryRaw.push(res)

    res.forEach((r, i) => {
      const uniqueMarkets = uniqWith(r.markets, (a, b) => a.underlying === b.underlying)

      const markets = uniqueMarkets
        .filter(m => tokenList.some(t => t.address === m.underlying.toLowerCase()))
        .map(m => {
          const borrowValue = utils.formatEther(convertToEth(m.dTokenBalance, getPrice(m), m.decimals))

          let stakedETokenBalance = BigNumber.from(0)
          let stakedETokenBalanceUnderlying = BigNumber.from(0)
          let stakedValue = '0.0'

          const st = staked[queryBatch[i].account]?.[`e${m.symbol}`]

          if (st && st.hex !== '0x00') {
            stakedETokenBalance = BigNumber.from(st.hex)
            stakedETokenBalanceUnderlying = stakedETokenBalance.mul(conversionRates[m.symbol]).div(c1e18)
            const stakedInEth = convertToEth(stakedETokenBalanceUnderlying, getPrice(m), m.decimals)
            stakedValue = utils.formatEther(stakedInEth)
            totalStakedValue = totalStakedValue.add(stakedInEth)
          }

          const depositValue = utils.formatEther(
            convertToEth(m.eTokenBalanceUnderlying.add(stakedETokenBalanceUnderlying), getPrice(m), m.decimals)
          )

          const totalValue = utils.formatEther(
            convertToEth(
              m.eTokenBalanceUnderlying.add(stakedETokenBalanceUnderlying).sub(m.dTokenBalance), getPrice(m), m.decimals
            )
          )
          return {
            underlying: m.underlying.toLowerCase(),
            symbol: m.symbol,
            name: m.name,
            eTokenAddr: m.eTokenAddr,
            eTokenBalance: utils.formatEther(m.eTokenBalance),
            eTokenBalanceUnderlying: utils.formatUnits(m.eTokenBalanceUnderlying, m.decimals),
            dTokenAddr: m.dTokenAddr,
            dTokenBalance: utils.formatUnits(m.dTokenBalance, m.decimals),
            stakedETokenBalance: utils.formatEther(stakedETokenBalance),
            stakedETokenBalanceUnderlying: utils.formatUnits(stakedETokenBalanceUnderlying, m.decimals),
            stakedValue,
            depositValue,
            borrowValue,
            totalValue,
        }})
        .filter(m => m.totalValue != '0.0')

      const totalValue = markets.reduce((accu, m) => {
        return accu.add(utils.parseEther(m.totalValue))
      }, BigNumber.from(0))

      const primary = batchAccounts[i].primary

      if (STAKING_CONTRACTS.includes(primary)) return

      if (!balances[primary]) balances[primary] = accounts[primary]

      const [id, subAcc]: any = Object.entries(balances[primary]).find(([id, a]: any) => a.address === batchAccounts[i].address)

      balances[primary][id] = {
        address: subAcc.address,
        markets,
        totalValue: utils.formatUnits(totalValue),
      }
    })

    console.log('fetched', Object.keys(balances).length);
  }

  // subaccount totals

  Object.entries(balances).forEach(([primary, accounts]) => {
    const subaccountsTotalValue = utils.formatEther(
      Object.values(accounts)
        .filter(a => typeof a === 'object')
        .reduce((accu, a) => accu.add(utils.parseEther(a.totalValue)), BigNumber.from(0))
    )

    balances[primary] = {
      subaccountsTotalValue,
      ...balances[primary]
    }
  })

  // filter out empty and sort by address

  balances = Object.fromEntries(
    Object.entries(balances)
      .filter(([_, a]: any) => a.subaccountsTotalValue !== '0.0')
      .sort(([a], [b]) => a.localeCompare(b))
  )

  return balances
}

const getUserBalances = (accounts: any) => {
  accounts = Object.fromEntries(
    Object.entries(accounts)
      .filter(([addr]) => !ATTACK_ACCOUNTS.includes(addr))
      .sort((a: any, b: any) => utils.parseEther(a[1].subaccountsTotalValue).gt(utils.parseEther(b[1].subaccountsTotalValue)) ? -1 : 1)
  )

  return accounts
}

const addFinalTransactions = async balances => {
  finalEvents.forEach(e => {
    forEachSubaccount(balances, (subacc, primary) => {
      if (subacc.address === e.account.toLowerCase()) {
        if (e.event === 'Borrow') {
          const market = subacc.markets.find(m => m.underlying === e.underlying)
          if (market) {
            const d = decimals[e.symbol]
            market.dTokenBalance = utils.formatUnits(
              utils.parseUnits(market.dTokenBalance, d).add(utils.parseUnits(e.amountUnderlying, d)), d
            )
            market.borrowValue = utils.formatEther(
              utils.parseEther(market.borrowValue).add(utils.parseEther(e.value))
            )
            market.totalValue = utils.formatEther(
              utils.parseEther(market.totalValue).sub(utils.parseEther(e.value))
            )
          } else {
            subacc.markets.push({
              underlying: e.underlying,
              symbol: e.symbol,
              name: e.underlyingName,
              eTokenAddr: e.eTokenAddr,
              eTokenBalance: '0.0',
              eTokenBalanceUnderlying: '0.0',
              dTokenAddr: e.dTokenAddr,
              dTokenBalance: e.amountUnderlying,
              stakedETokenBalance: '0.0',
              stakedETokenBalanceUnderlying: '0.0',
              stakedValue: '0.0',
              depositValue: '0.0',
              borrowValue: e.value,
              totalValue: `-${e.value}`,
            })
          }
          subacc.totalValue = utils.formatEther(
            utils.parseEther(subacc.totalValue).sub(utils.parseEther(e.value))
          )
          balances[primary].subaccountsTotalValue = utils.formatEther(
            utils.parseEther(balances[primary].subaccountsTotalValue).sub(utils.parseEther(e.value))
          )
        }
        if (e.event === 'Repay') {
          const d = decimals[e.symbol]

          const market = subacc.markets.find(m => m.underlying === e.underlying)
          if (!market) throw 'Unexpected event ' + e.transaction

          market.dTokenBalance = utils.formatUnits(
            utils.parseUnits(market.dTokenBalance, d).sub(utils.parseUnits(e.amountUnderlying, d)), d
          )
          market.borrowValue = utils.formatEther(
            utils.parseEther(market.borrowValue).sub(utils.parseEther(e.value))
          )
          market.totalValue = utils.formatEther(
            utils.parseEther(market.totalValue).add(utils.parseEther(e.value))
          )

          subacc.totalValue = utils.formatEther(
            utils.parseEther(subacc.totalValue).add(utils.parseEther(e.value))
          )
          balances[primary].subaccountsTotalValue = utils.formatEther(
            utils.parseEther(balances[primary].subaccountsTotalValue).add(utils.parseEther(e.value))
          )
        }
        if (e.event === 'Withdraw') {
          const d = decimals[e.symbol]

          const market = subacc.markets.find(m => m.underlying === e.underlying)
          if (!market) throw 'Unexpected event ' + e.transaction

          market.eTokenBalance = utils.formatEther(
            utils.parseEther(market.eTokenBalance).sub(BigNumber.from(e.amount))
          )
          market.eTokenBalanceUnderlying = utils.formatUnits(
            utils.parseUnits(market.eTokenBalanceUnderlying, d).sub(utils.parseUnits(e.amountUnderlying, d)), d
          )
          market.depositValue = utils.formatEther(
            utils.parseEther(market.depositValue).sub(utils.parseEther(e.value))
          )
          market.totalValue = utils.formatEther(
            utils.parseEther(market.totalValue).sub(utils.parseEther(e.value))
          )

          subacc.totalValue = utils.formatEther(
            utils.parseEther(subacc.totalValue).sub(utils.parseEther(e.value))
          )
          balances[primary].subaccountsTotalValue = utils.formatEther(
            utils.parseEther(balances[primary].subaccountsTotalValue).sub(utils.parseEther(e.value))
          )
        }
      }
    })
  })

  return balances
}

const removeExcluded = balances => {
  return Object.fromEntries(
    Object.entries(balances)
      .filter(([primary]) => !EXCLUDED_ACCOUNTS.includes(primary))
      .filter(([_, a]: any) => utils.parseEther(a.subaccountsTotalValue).gt(0))
  )
}

const getReserveAccounts = async (balances) => {
  const markets = {}
  const reserveAccounts = {}

  forEachMarket(balances, m => {
    markets[m.symbol] = m
  })

  await Promise.all(Object.values(markets).map(async (m: any) => {
    const reserveBalance = await e.eToken(m.eTokenAddr).reserveBalance({ blockTag: PRE_BLOCK })
    const reserveBalanceUnderlying = await e.eToken(m.eTokenAddr).reserveBalanceUnderlying({ blockTag: PRE_BLOCK })

    const reserveValue = utils.formatEther(convertToEth(reserveBalanceUnderlying, settlementPrices[m.underlying], decimals[m.symbol]))

    reserveAccounts[`reserve${m.symbol}`] = {
      subaccountsTotalValue: reserveValue,
      isReserves: true,
      id0: {
        address: '',
        totalValue: reserveValue,
        markets: [
          {
            underlying: m.underlying,
            symbol: m.symbol,
            name: m.underlyingName,
            eTokenAddr: m.eTokenAddr,
            eTokenBalance: utils.formatEther(reserveBalance),
            eTokenBalanceUnderlying: utils.formatUnits(reserveBalanceUnderlying, decimals[m.symbol]),
            dTokenAddr: m.dTokenAddr,
            dTokenBalance: '0.0',
            stakedETokenBalance: '0.0',
            stakedETokenBalanceUnderlying: '0.0',
            stakedValue: '0.0',
            depositValue: reserveValue,
            borrowValue: '0.0',
            totalValue: reserveValue,
          }
        ]
      }
    }
  }))

  return reserveAccounts
}

const run = async () => {

  let balances = await fetchBalances(accounts)
  decimals = await fetchDecimals(e, balances)

  console.log('Total non-empty accounts: ', Object.keys(balances).length);
  fs.writeFileSync('./data/balancesAllETokenUpgrade.json', JSON.stringify(balances, null, 2)) 

  balances = getUserBalances(balances)
  // add transactions executed between e/dToken upgrades 
  balances = await addFinalTransactions(balances)
  // remove refunded victim, liquidation bot and bad debt accounts
  balances = removeExcluded(balances)

  console.log('Total eligible user accounts: ', Object.keys(balances).length);
  fs.writeFileSync('./data/balancesUsers.json', JSON.stringify(balances, null, 2))
  
  const reserveAccounts = await getReserveAccounts(balances)
  fs.writeFileSync('./data/balancesReserves.json', JSON.stringify(reserveAccounts, null, 2))
}

run()
