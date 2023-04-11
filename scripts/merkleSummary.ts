import fs from 'fs'
import { ethers, BigNumber } from 'ethers'
import { root, proof } from './utils/merkle-tree.js';


const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const DAI =  '0x6b175474e89094c44da98b954eedeac495271d0f';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';


let merkleDist = JSON.parse(fs.readFileSync('./data/merkle-tree.json', 'utf8'));


console.log(`Root = ${root(merkleDist)}`);


let totals = {};

for (let d of merkleDist) {
    for (let tokenAmount of d[2]) {
        let tokenAddr = tokenAmount[0];
        let amount = tokenAmount[1];

        if (totals[tokenAddr] === undefined) totals[tokenAddr] = BigNumber.from(0);
        totals[tokenAddr] = totals[tokenAddr].add(amount);
    }
}

console.log("\n\n");

console.log(`WETH distributed = ${ethers.utils.formatUnits(totals[WETH], 18)}`);
console.log(`DAI  distributed = ${ethers.utils.formatUnits(totals[DAI], 18)}`);
console.log(`USDC distributed = ${ethers.utils.formatUnits(totals[USDC], 6)}`);

console.log("\n\n");


for (let tokenAddr of Object.keys(totals)) {
    if (tokenAddr === WETH || tokenAddr === DAI || tokenAddr === USDC) continue;

    console.log(`        transferToMerkleDist1(${ethers.utils.getAddress(tokenAddr)}, ${totals[tokenAddr].toString()});`);
}
