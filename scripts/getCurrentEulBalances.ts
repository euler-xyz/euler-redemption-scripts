import { Euler } from "@eulerxyz/euler-sdk"

import fs from 'fs'
import * as dotenv from 'dotenv'
import { ethers, utils, BigNumber } from 'ethers'

import balances from '../data/balancesAllETokenUpgrade.json'

import {
  forEachMarket,
  convertToEth,
} from './utils'
import { settlementPrices } from './utils/prices'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)

const run = async () => {
  const markets = {}

  forEachMarket(balances, m => {
    markets[m.symbol] = {
      symbol: m.symbol,
      name: m.name,
      underlying: m.underlying
    }
  })

  await Promise.all(Object.values(markets).map(async (m: any) => {
    let balance = await e.erc20(m.underlying).balanceOf(e.addresses.euler)
    let decimals = await e.erc20(m.underlying).decimals()

    m.balance = utils.formatUnits(balance, decimals)
    m.value = utils.formatEther(convertToEth(balance, settlementPrices[m.underlying], decimals))
  }))

  const totalValue = Object.values(markets).reduce((accu: any,  m: any) => accu.add(utils.parseEther(m.value)), BigNumber.from(0))

  const res = {
    totalValue: utils.formatEther(totalValue as any),
    markets: Object.values(markets).sort((a: any, b: any) => utils.parseEther(a.value).gt(utils.parseEther(b.value)) ? -1 : 1),
  }

  fs.writeFileSync('./data/currentEulerBalances.json', JSON.stringify(res, null, 2)) 
}

run()
