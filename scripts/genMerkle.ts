import fs from 'fs'
import { ethers } from 'ethers'
import claims from "../data/claimsAnnotated.json";


let currIndex = 0;
let output = [];

for (let address of Object.keys(claims)) {
    let claim = claims[address];


    // Special handling for contract addresses

    if (claims[address].isContract && !claims[address].contractType) {
        // Unknown contract: exclude from merkle tree
        continue;
    } else if (claims[address].contractType === "instadapp") {
        // Instadapp accounts should use the authority address
        address = claims[address].authority;
    } else if (claims[address].contractType === "multisig") {
        // Just a multisig, nothing has to be done
    }


    let tokenAmounts = [];

    let pushTokenAmount = (tokenAddr, amount, decimals) => {
        let rawAmount = ethers.utils.parseUnits(amount, decimals);
        if (rawAmount.eq(0)) return;
        tokenAmounts.push([tokenAddr.toLowerCase(), rawAmount.toString()]);
    };

    // WETH
    pushTokenAmount('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', claim.claims.returned.ethClaimAmount, 18);

    // DAI
    pushTokenAmount('0x6b175474e89094c44da98b954eedeac495271d0f', claim.claims.returned.daiClaimAmount, 18);

    // USDC
    pushTokenAmount('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', claim.claims.returned.usdcClaimAmount, 6);

    // Remaining tokens

    for (let sym of Object.keys(claim.claims.remaining || {})) {
        let rem = claim.claims.remaining[sym];
        pushTokenAmount(rem.underlying, rem.claimAmount, rem.decimals);
    }


    output.push([currIndex, address, tokenAmounts]);
    currIndex++;
}

fs.writeFileSync('./data/merkle-tree.json', JSON.stringify(output, null, 2));
