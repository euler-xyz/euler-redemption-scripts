import { Euler } from "@eulerxyz/euler-sdk"
import fs from 'fs'

import * as dotenv from 'dotenv'
import { ethers, utils, BigNumber } from 'ethers'

import {
  ETOKEN_UPGRADE_BLOCK,
  DTOKEN_UPGRADE_BLOCK,
  convertToEth,
} from './utils'
import { settlementPrices } from './utils/prices'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)


const run = async () => {
  const allEvents = await (e as any).contracts.euler.queryFilter(
    "*", ETOKEN_UPGRADE_BLOCK, DTOKEN_UPGRADE_BLOCK // etoken - dtoken
  )

  let lastEvents = allEvents
    .filter(e => ['Borrow', 'Repay', 'Withdraw'].includes(e.event))
    .map(e =>({
      event: e.event,
      blockNumber: e.blockNumber,
      transaction: e.transactionHash,
      underlying: e.args.underlying.toLowerCase(),
      account: e.args.account,
      amount: e.args.amount.toString(),
    }));
  

  // NOTE: Conversion Rate at last ETokenBlock
  // TODO: check actual token transfer amounts in borrows
  lastEvents = await Promise.all(lastEvents.map(async ev => {
    const symbol = ev.underlying === '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' ? 'MKR' : await e.erc20(ev.underlying).symbol()
    const underlyingName = ev.underlying === '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2' ? 'MKR' : await e.erc20(ev.underlying).name()
    const decimals = await e.erc20(ev.underlying).decimals()
    const eTokenAddr = await e.contracts.markets.underlyingToEToken(ev.underlying, { blockTag: ETOKEN_UPGRADE_BLOCK })
    const dTokenAddr = await e.contracts.markets.underlyingToDToken(ev.underlying, { blockTag: ETOKEN_UPGRADE_BLOCK })
    let amountUnderlying
    if (ev.event === 'Withdraw') {
      // single Withdraw event as a result of burn
      // Unable to get the conversion rate at the time from chain, but amount underlying is the same as corresponding repay event
      ev.amount = BigNumber.from('903484005556000000000000')
      amountUnderlying = BigNumber.from('903484005556')
    } else {
      amountUnderlying = symbol === 'USDC' ? BigNumber.from(ev.amount).div(BigNumber.from(10).pow(12)) : ev.amount
    }

    const value = convertToEth(BigNumber.from(amountUnderlying), settlementPrices[ev.underlying], decimals)
    return {
      ...ev,
      symbol,
      underlyingName,
      eTokenAddr,
      dTokenAddr,
      amount: ev.amount.toString(),
      amountUnderlying: utils.formatUnits(amountUnderlying, decimals),
      value: utils.formatEther(value),
    }
  }))

  fs.writeFileSync('./data/eventsBetweenUpgrades.json', JSON.stringify(lastEvents, null, 2)) 
}

run()
