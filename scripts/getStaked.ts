const { providers, Contract, BigNumber } = require('ethers');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();
const { ETOKEN_UPGRADE_BLOCK, STAKING_ABI } = require('./utils/constants')


const STAKING_START_BLOCK = 16090873;
const stakingAddresses = [
    {
      address: "0x229443bf7F1297192394B7127427DB172a5bDe9E",
      symbol: "eWETH",
    },
    {
      address: "0xE5aFE81e63f0A52a3a03B922b30f73B8ce74D570",
      symbol: "eUSDC",
    },
    {
      address: "0x7882F919e3acCa984babd70529100F937d90F860",
      symbol: "eUSDT",
    },
];

​
const sleep = () => new Promise((resolve) => setTimeout(resolve, 2000));
​
(async () => {
    const provider = new providers.JsonRpcBatchProvider(process.env.RPC_URL);
    const stakingContracts = stakingAddresses.map((s) => new Contract(s.address, STAKING_ABI, provider));
​
    // get all the addresses that have ever staked
    const promises = [];
    for (let block = STAKING_START_BLOCK; block <= ETOKEN_UPGRADE_BLOCK; block += 10000) {
        promises.push(
            ...stakingContracts.map((c) => c.queryFilter(
                c.filters.Staked(null, null), block, Math.min(ETOKEN_UPGRADE_BLOCK, block + 9999)
            ))
        );
    }
​
    const userAddresses = [...new Set((await Promise.all(promises)).reduce((acc, batch) => {
        return [...acc, ...batch.map(l => l.args.user.toLowerCase())];
    }, []))];
​
    // get the balances of all the addresses that have ever staked before the hack
    const staked = {};
    const totalStaked = {};
    const totalStakedCheck = {};
    for (const stakingContract of stakingContracts) {
        await sleep();
​
        const symbol = stakingAddresses.find((s) => s.address === stakingContract.address).symbol;
        const balances = await Promise.all(userAddresses.map((a) => stakingContract.balanceOf(a, { blockTag: ETOKEN_UPGRADE_BLOCK })));
​
        userAddresses.forEach((a: any, i) => {
            if (!staked[a]) staked[a] = {};
​
            staked[a] = {
                ...staked[a],
                [symbol]: balances[i],
            }
        });
​
        totalStaked[symbol] = balances.reduce((acc, b) => acc.add(b), BigNumber.from(0));
        totalStakedCheck[symbol] = await stakingContract.totalSupply({ blockTag: ETOKEN_UPGRADE_BLOCK });
    }
​
    // verify that the total staked is correct
    for (const symbol of Object.keys(totalStaked)) {
        if (!totalStaked[symbol].eq(totalStakedCheck[symbol])) {
            console.log(`Total staked for ${symbol} is incorrect`);
        }
    }
​
    fs.writeFileSync(`./data/staked.json`, JSON.stringify(staked, null, 2));
})();