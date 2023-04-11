import { BigNumber } from 'ethers'
import axios from 'axios'

import { DAI_ADDR, USDC_ADDR } from './constants'

export const c1e18 = BigNumber.from(10).pow(18)

const TOKENLIST_URL = 'https://raw.githubusercontent.com/euler-xyz/euler-tokenlist/master/euler-tokenlist.json'

export const convertToEth = (val, price, decimals) => {
  return val.mul(BigNumber.from(10).pow(18 - decimals)).mul(price).div(c1e18)
}

export const convertReturnedToEth = (prices, ethAmount, daiAmount, usdcAmount) => {
  return ethAmount
    .add(convertToEth(daiAmount, prices[DAI_ADDR], 18))
    .add(convertToEth(usdcAmount, prices[USDC_ADDR], 6))
}

export const forEachMarket = (balances, cb) => {
  Object.entries(balances).forEach(([primary, account]) => {
    Object.entries(account).forEach(([key, val]: any) => {
      if (key.startsWith('id')) {
        balances[primary][key].markets.forEach(m => cb(m, primary, key))
      }
    })
  })
}

export const forEachSubaccount = (balances, cb) => {
  Object.entries(balances).forEach(([primary, account]) => {
    Object.entries(account).forEach(([key, val]: any) => {
      if (key.startsWith('id')) {
        cb(val, primary)
      }
    })
  })
}

export const forEachNetDeposit = (balances, cb) => {
  Object.entries(balances).forEach(([primary, account]) => {
    Object.entries(account).forEach(([key, val]: any) => {
      if (key.startsWith('id')) {
        Object.entries(val.deposits.deposits).forEach(([underlying, deposit]) => cb(deposit, underlying, primary, key))
      }
    })
  })
}

export const fetchDecimals = async (e, balances) => {
  const underlyings = {}
  const decimals = {}

  forEachMarket(balances, m => {
    underlyings[m.symbol] = m.underlying
  })

  await Promise.all(Object.entries(underlyings).map(async ([symbol, addr]: any) => {
    const dec = await e.erc20(addr).decimals()
    decimals[symbol] = Number(dec.toString())
  }))

  return decimals
}

export const fetchTotalSupplyUnderlying = async (e, balances, block) => {
  const eTokens = {}
  const res = { totalSupplies: {}, reserveBalances: {} }

  forEachMarket(balances, m => {
    eTokens[m.symbol] = m.eTokenAddr
  })

  await Promise.all(Object.entries(eTokens).map(async ([symbol, addr]: any) => {
    res.totalSupplies[symbol]= await e.eToken(addr).totalSupplyUnderlying({ blockTag: block })
    res.reserveBalances[symbol]= await e.eToken(addr).reserveBalanceUnderlying({ blockTag: block })
  }))

  return res
}

export const ETH_USD_PRICE_AT_ATTACK = 1595.7

export const getRemovedAccounts = (balancesAll, balances) => {
  const accountsRemoved = {}
  Object.keys(balancesAll).forEach(k => {
    if (!balances[k]) accountsRemoved[k] = balancesAll[k]
  })
  // fs.writeFileSync('./data/accountsRemoved.json', JSON.stringify(accountsRemoved, null, 2)) 

  return accountsRemoved
}

export const getTokenList = async () => {
  const res = await axios.get(TOKENLIST_URL)
  return res.data.tokens
}
