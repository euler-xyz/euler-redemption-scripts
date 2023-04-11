const ethers = require('ethers');


function processDistribution(dist) {
    if (dist.length === 0) throw("can't have merkle tree with no items");
    return dist.map(d => ethers.utils.defaultAbiCoder.encode(["uint256", "address", "tuple(address, uint256)[]"], d)).sort();
}

function hashLevel(level) {
    let nextLevel = [];

    for (let i = 0; i < level.length; i += 2) {
        if (i === level.length - 1) nextLevel.push(level[i]); // odd number of nodes at this level
        else nextLevel.push(ethers.utils.keccak256(ethers.utils.concat([level[i], level[i+1]].sort())));
    }

    return nextLevel;
}

function root(items) {
    let level = processDistribution(items).map(d => ethers.utils.keccak256(d));

    while (level.length > 1) {
        level = hashLevel(level);
    }

    return level[0];
}

function proof(items, index) {
    let level = processDistribution(items).map(d => ethers.utils.keccak256(d));

    let witnesses = [];

    while (level.length > 1) {
        let nextIndex = Math.floor(index / 2);

        if (nextIndex * 2 === index) { // left side
            if (index < level.length - 1) { // only if we're not the last in a level with odd number of nodes
                witnesses.push(level[index + 1]);
            }
        } else { // right side
            witnesses.push(level[index - 1]);
        }

        index = nextIndex;
        level = hashLevel(level);
    }

    return witnesses;
}


module.exports = {
    root,
    proof,
};
