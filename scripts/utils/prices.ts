import pricesPause from '../../data/prices_pause.json'
import pricesRedemption from '../../data/prices_redemption.json'

export const settlementPrices = sanitizePrices(pricesPause) as Record<string, string>
export const redemptionPrices = sanitizePrices(pricesRedemption) as Record<string, string>


function sanitizePrices(prices) {
  return Object.fromEntries(
    Object.entries(prices).map(([key, val]) => [key.toLowerCase(), val])
  ) 
} 