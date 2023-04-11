// ETH refunded = 12 + 3012 + 11000 + (20000 * 2) + 7737.25 + (7738.05 * 3) + 0.0569100165 + 0.85013075191 + 0.05355134923 + 8080 + 2500
export const TOTAL_RETURNED_ETH = "95556.36059211764"
export const TOTAL_RETURNED_DAI = "43063729.35" 
export const DAI_INSURANCE = "1007321"
export const USDC_INSURANCE = "3396964"

export const TOTAL_REFUNDED_ETH = TOTAL_RETURNED_ETH
export const TOTAL_REFUNDED_DAI = String(Number(TOTAL_RETURNED_DAI) + Number(DAI_INSURANCE))
export const TOTAL_REFUNDED_USDC = USDC_INSURANCE

export const CLAIM_TO_NAV_CAP = "1.005"

export const ETOKEN_UPGRADE_BLOCK = 16818363
export const DTOKEN_UPGRADE_BLOCK = 16818853
export const PRE_BLOCK = 16817994

export const BLOCK_PAUSE = ETOKEN_UPGRADE_BLOCK - 1
export const BLOCK_REDEMPTION = 17027354

















export const ATTACKED_MARKETS = [
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', //wstETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', //USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', //WBTC
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', //WETH
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', //STETH
  '0x6b175474e89094c44da98b954eedeac495271d0f', //DAI
]

export const STAKING_CONTRACTS = [
  "0xe5afe81e63f0a52a3a03b922b30f73b8ce74d570", // USDC
  "0x7882f919e3acca984babd70529100f937d90f860", // USDT
  "0x229443bf7f1297192394b7127427db172a5bde9e", // WETH
]

export const STAKING_ETOKENS = {
  USDC: '0xeb91861f8a4e1c12333f42dce8fb0ecdc28da716',
  USDT: '0x4d19f33948b99800b6113ff3e83bec9b537c85d2',
  WETH: '0x1b808f49add4b8c6b5117d9681cf7312fcf0dc1d',
}

export const STAKING_TOKENS = {
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
}

export const ATTACK_ACCOUNTS = [
  '0x7db7099b00d1d24ef2814cfcde723eacd958b05b', // USDC
  '0x84273bba41cd0ec99f59b5b4c85783cf514e4e1a', // wstETH
  '0x1e4446016f3fddfe2ecc046cf91a8010a30e9a9b', // wstETH
  '0xb324581ee258aa67bc144ad27f79f8dcac569af0', // WBTC
  '0xa4c0afeca6273b012382970c1ed8690c2929988d', // stETH
  '0x0b812c74729b6abc723f22986c61d95344ff7aba', // WETH
  '0x583c21631c48d442b5c0e605d624f54a0b366c72', // DAI

  // LIQUIDATORS
  '0xd444a7ac5d1c5eb8ebc9dab83834a412e9b7be76', // USDC
  '0xcec2981d8047c401f2a4e972a7e5ada3f5ecf838', // wstETH
  '0x22c5cf8fc9891f8ef5a5e8630b95115018a09736', // wstETH
  '0xd041709eb1c61ce6ec9d46126ac0e4b50eade576', // WBTC
  '0x12df82a443c77eae9d5bb0f5c8d0ec706ecb338c', // stETH
  '0xa0b3ee897f233f385e5d61086c32685257d4f12b', // DAI
  '0xd3b7cea28feb5e537fca4e657e3f60129456eaf3', // WETH
]

export const COLLATERALS = [
  'wstETH',
  'USDC',
  'WBTC',
  'WETH',
  'stETH',
  'DAI',
  'cbETH',
  'USDT',
  'rETH',
]

export const STAKING_ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Staked",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
        {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
        }
    ],
    "stateMutability": "view",
    "type": "function"
  },
];

export const EXCLUDED_ACCOUNTS = [
  '0x2af24e5575045a582d9c53febd48724473e67407', // refund recipient
  '0xb1ae6893d748db81b7f53494e19d9fda39ba25a7', // liquidation bot
  '0x000000000000000000000000000000000000dead',
]

export const WETH_ADDR = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
export const DAI_ADDR = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const USDC_ADDR = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

export const CHAINLINK_ETH_USD_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const CHAINLINK_ABI = ['function latestAnswer() external view returns (int256)']