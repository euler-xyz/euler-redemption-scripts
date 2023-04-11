import { Euler, utils as eUtils } from "@eulerxyz/euler-sdk"
import fs from 'fs'

import * as dotenv from 'dotenv'
import { ethers, utils } from 'ethers'
import { assert } from 'chai'
import { uniqWith } from 'lodash'

import {
  ETOKEN_UPGRADE_BLOCK,
  convertToEth,
  getTokenList
} from '../scripts/utils'

import balances from '../data/balancesAllETokenUpgrade.json'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)

const verifyAccount = async primary => {
  const queryBatch = Object.keys(balances[primary])
    .map(k => {
      if (!k.startsWith('id')) return
      const markets = balances[primary][k].markets.map(m => m.underlying)
      
      return {
        eulerContract: e.addresses.euler,
        account: balances[primary][k].address,
        markets,
      }
    }).filter(Boolean)
  const res = await e.contracts.eulerGeneralView.doQueryBatch(queryBatch, { blockTag: ETOKEN_UPGRADE_BLOCK - 1 })


  for (const [i, acc] of queryBatch.entries()) {
    const parsedMarkets = balances[primary][`id${eUtils.getSubAccountId(primary, queryBatch[i].account)}`].markets
    const value = res[i].markets.map(m => convertToEth(m.eTokenBalanceUnderlying, m.twap, m.decimals).add(convertToEth(m.eTokenBalanceUnderlying, m.twap, m.decimals)))
    // console.log('value: ', value);

    let resMarkets = res[i].markets
      .filter((m, i) => value[i].gt(0) || m.dTokenBalance.gt(0))
      .filter(m => tokenList.some(tl => tl.address === m.underlying.toLowerCase()))
    resMarkets = uniqWith(resMarkets, (a, b) => a.underlying === b.underlying)
    // console.log('resMarkets: ', resMarkets);


    const stakingOnlyMarkets = parsedMarkets.filter(m => 
      m.eTokenBalance === '0.0' && m.dTokenBalance === '0.0' && m.stakedEtokenBalance !== '0.0'  
    )


    assert.equal(Object.keys(parsedMarkets).length, resMarkets.length + stakingOnlyMarkets.length, `markets length ${primary}, id${i}`)
    resMarkets.forEach(m => {
      const parsedMarket = parsedMarkets.find(pm => pm.underlying === m.underlying.toLowerCase())
      assert.isTrue(
        m.eTokenBalance.eq(utils.parseEther(parsedMarket.eTokenBalance)),
        `eToken balance mismatch  ${primary}, id${i}, ${m.symbol}`
      )
      assert.isTrue(
        m.dTokenBalance.eq(utils.parseUnits(parsedMarket.dTokenBalance, m.decimals)),
        `eToken balance mismatch  ${primary}, id${i}, ${m.symbol}`
      )
    })
  }
}

let tokenList
const run = async () => {
  tokenList = await getTokenList()
  for (const [i, primary] of Object.entries(Object.keys(balances))) {
    console.log(i, primary);
    await verifyAccount(primary)
  }
}

run()
