import { utils } from "@eulerxyz/euler-sdk"
import json from 'big-json'
import fs from 'fs'

import * as dotenv from 'dotenv'
import { ethers } from 'ethers'
import { chunk, union } from 'lodash'


import { STAKING_TOKENS, getTokenList } from './utils'

import staked from '../data/staked.json'

dotenv.config()

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

const BATCH_SIZE = 20

const isPrimary = async address => {
  const nonce = await provider.getTransactionCount(address)
  if (nonce > 0) return true
  const code = await provider.getCode(address)
  if (code != '0x') return true

  return false
}

const getSubaccounts = async (accounts, group) => {
  let primary
  for (let account of group) {
    if (await isPrimary(account.address)) {
      primary = account.address
      break
    }
  }

  const res = group.reduce((accu, a) => {
    accu[`id${utils.getSubAccountId(primary, a.address)}`] = a
    return accu
  }, {})

  accounts[primary] = Object.fromEntries(
    Object.entries(res).sort(([a], [b]) => a.localeCompare(b))
  )
}

const processGroups = async groups => {
  const accounts = {}
  const withSubaccounts = []
  groups.forEach(g => {
    if (g.length === 1) {
      accounts[g[0].address] = { id0: g[0] }
    } else {
      withSubaccounts.push(g)
    }
  })

  console.log('with subaccounts: ', withSubaccounts.length);

  let cnt = 0
  for (let batch of chunk(withSubaccounts, BATCH_SIZE)) {
    await Promise.all(batch.map(group => getSubaccounts(accounts, group)))
    console.log('with subaccounts processed', (cnt+=BATCH_SIZE));
  }

  return accounts
}

const addStakedFromSubaccount = accounts => {
  const getStakedMarkets = s => {
    const markets = []
    if (s.eUSDC.hex !== '0x00') markets.push(STAKING_TOKENS.USDC)
    if (s.eUSDT.hex !== '0x00') markets.push(STAKING_TOKENS.USDT)
    if (s.eWETH.hex !== '0x00') markets.push(STAKING_TOKENS.WETH)
    return markets
  }

  Object.entries(staked)
    .filter(([_, s]) => s.eUSDC.hex !== '0x00' || s.eWETH.hex !== '0x00' || s.eUSDT.hex !== '0x00')
    .forEach(([a, s]) => {
      if (!accounts[a]) {
        accounts[a] = {
          id0: {
            address: a,
            markets: getStakedMarkets(s)
          }
        }
      } else {
        accounts[a].id0.markets = union(accounts[a].id0.markets, getStakedMarkets(s))
      }
    })

  return accounts
}

const getPrimaryType = async accounts => {
  let cnt = 0
  for (let batch of chunk(Object.keys(accounts), BATCH_SIZE)) {
    await Promise.all(batch.map((async primary => {
      const code = await provider.getCode(primary)
      accounts[primary].isContract = code !== '0x'
    })))
    console.log('primary type processed', (cnt+=BATCH_SIZE));
  }

  return accounts
}

const fetchAccounts = async rawlogs => {
  const tokenList = await getTokenList()
  const logs = rawlogs.filter(l => ['Deposit', 'Borrow'].includes(l.name))

  const addresses = [...new Set(logs.map(l => l.account.toLowerCase()))].sort()

  let accounts = {}
  let cache = []
  let groups = []

  logs.forEach(l => {
    if (!accounts[l.account]) accounts[l.account] = { markets: [] }
    if (!accounts[l.account].markets.includes(l.underlying) && tokenList.some(t => t.address === l.underlying.toLowerCase()))
      accounts[l.account].markets.push(l.underlying.toLowerCase())
  })

  ;[...addresses, '0x00'].forEach((a: string, i) => {
    if (i == 0 || utils.isRealSubAccount(a, cache[0])) {
      cache.push(a)
      return
    }
    const group = cache.map(a => ({address: a, markets: accounts[a].markets}))
    groups.push(group)

    cache = [a]
  })

  console.log('groups: ', groups.reduce((accu, g) => accu + g.length, 0))
  accounts = await processGroups(groups)

  accounts = addStakedFromSubaccount(accounts)

  accounts = await getPrimaryType(accounts)

  // sort keys
  accounts = Object.fromEntries(
    Object.entries(accounts).sort(([a], [b]) => a.localeCompare(b))
  )

  fs.writeFileSync('./data/accounts.json', JSON.stringify(accounts, null, 2)) 
}

const run = () => {
  const readStream = fs.createReadStream('./rawlogs.json');
  const parseStream = json.createParseStream();

  parseStream.on('data', function(rawlogs: any) {
    fetchAccounts(rawlogs)
  });

  readStream.pipe(parseStream);
}

run()