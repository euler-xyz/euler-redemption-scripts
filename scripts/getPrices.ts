import * as dotenv from 'dotenv'
import { providers, utils, constants } from 'ethers'
import { Euler } from "@eulerxyz/euler-sdk"

import fs from 'fs'
import {
  BLOCK_PAUSE,
  BLOCK_REDEMPTION,
} from './utils/constants'

import {
  forEachMarket,
  convertToEth,
} from './utils/utils'

import accounts from '../data/accounts.json'

dotenv.config()

const EXEC_MODULE_ID = 5
const EULER_ADDRESS = '0x27182842E098f60e3D576794A5bFFb0777E025d3'
const EXEC_PROXY = '0x59828FdF7ee634AaaD3f58B19fDBa3b03E2D9d80'

const provider = new  providers.JsonRpcProvider(process.env.RPC_URL);
const e = new Euler(provider)

const registerTasks = () => {
  const resetAtBlock = async block => {
    console.log('block: ', block);
    const params = [
      {
        forking: {
          jsonRpcUrl: process.env.RPC_URL,
          blockNumber: Number(block),
        },
      },
    ]
    await network.provider.request({
        method: "hardhat_reset",
        params,
    })
  }
  
  const setExecCode = async () => {
    const stringifyArgs = args => args.map(a =>JSON.stringify(a));
  
    const euler = await ethers.getContractAt('Euler', EULER_ADDRESS)
  
    const execImpl = await euler.moduleIdToImplementation(EXEC_MODULE_ID)
  
    const gitCommit = '0x' + '1'.repeat(64);
    await hre.run('set-code', {
        compile: false,
        name: 'Exec',
        address: execImpl,
        args: stringifyArgs([gitCommit]),
    })
  
    return ethers.getContractAt('Exec', EXEC_PROXY)
  }
  
  const fetchPrices = async (markets, exec) => {
    let promises = await Promise.all(markets.map(m => exec.getPrice(m)))
    let prices = promises.reduce((acc, { twap }, i) => {
      acc[markets[i]] = twap.toString()
      return acc
    }, {})
  
    prices = Object.fromEntries(
      Object.entries(prices).sort(([a], [b]) => a.localeCompare(b))
    )
  
    return prices
  }
  
  const toCsv = (prices, symbols, decimals) => {
    const p = Object.entries(symbols)
      .map(([underlying, symbol]: any) => ({
        underlying,
        symbol,
        price: utils.formatEther(convertToEth(utils.parseUnits('1', decimals[symbol]), prices[underlying], decimals[symbol]))
      }))
      .filter(p => p.symbol)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  
    return p.map(pr => `${pr.symbol},${pr.price}`).join('\n')
  }
  
  const fetchDecimalsAndSymbols = async (e, accounts) => {
    let underlyings = []
    const decimals = {}
    const symbols = {}
  
    forEachMarket(accounts, m => {
      underlyings.push(m)
    })
    underlyings = [...new Set(underlyings)]
  
    await Promise.all(underlyings.map(async (underlying: any) => {
      const res = await e.contracts.eulerGeneralView.doQuery({
        eulerContract: e.addresses.euler,
        account: constants.AddressZero,
        markets: [underlying]
      }, { blockTag: BLOCK_PAUSE })
  
      const symbol = res.markets[0].symbol
      symbols[underlying] = symbol
      decimals[symbol] = Number(res.markets[0].decimals.toString())
    }))
  
    return { decimals, symbols }
  }

  task("prices", "Fetch Euler prices from mainnet fork")
    .setAction(async () => {

      const {decimals, symbols} = await fetchDecimalsAndSymbols(e, accounts)
      const markets = []
      forEachMarket(accounts, m => {
        if (!markets.includes(m)) markets.push(m)
      })

      console.log('fetching pause prices...')
      await resetAtBlock(BLOCK_PAUSE)
      let exec = await setExecCode()
      const pricesPause = await fetchPrices(markets, exec)
      const pricesPauseCsv = toCsv(pricesPause, symbols, decimals)

      fs.writeFileSync('./data/prices_pause.json', JSON.stringify(pricesPause, null, 2))
      fs.writeFileSync('./data/prices_pause.csv', pricesPauseCsv)


      console.log('fetching redemption prices...')
      await resetAtBlock(BLOCK_REDEMPTION)
      exec = await setExecCode()
      const pricesRedemption = await fetchPrices(markets, exec)
      const pricesRedemptionCsv = toCsv(pricesRedemption, symbols, decimals)

      fs.writeFileSync('./data/prices_redemption.json', JSON.stringify(pricesRedemption, null, 2))
      fs.writeFileSync('./data/prices_redemption.csv', pricesRedemptionCsv)
  });


  task("set-code", "Set contract code at a given address")
    .addOptionalParam("name", "Contract name")
    .addParam("address", "Contract address")
    .addOptionalVariadicPositionalParam("args", "Constructor args")
    .addOptionalParam("artifacts", "Path to artifacts file which contains the init bytecode")
    .setAction(async ({ name, address, args = [], artifacts}) => {
      const snapshot = await network.provider.request({
        method: 'evm_snapshot',
        params: [],
      });
      let factory;

      if (name) {
        factory = await ethers.getContractFactory(name);
      } else {
        const signers = await ethers.getSigners();
        factory = ethers.ContractFactory
                    .fromSolidity(require(artifacts))
                    .connect(signers[0]);
      }
      args = args.map(a => {
        try { return JSON.parse(a) }
        catch { return a }
      });

      const tmpContract = await (await factory.deploy(...args)).deployed();
      const deployedBytecode = await network.provider.request({
        method: 'eth_getCode',
        params: [tmpContract.address, 'latest'],
      });

      await network.provider.request({
        method: 'evm_revert',
        params: [snapshot],
      });

      await network.provider.request({
        method: 'hardhat_setCode',
        params: [address, deployedBytecode],
      });
  });
}


export default registerTasks;