/* eslint-disable prefer-const */
import { Pair, Token, UniswapPair, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { convertTokenToDecimal, ZERO_BD, ONE_BD } from './helpers'
import { Pair as PairContract } from '../types/templates/Pair/Pair'

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDT_WETH_PAIR = '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852' // created block 10093341

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdtPair = UniswapPair.load(USDT_WETH_PAIR) // usdt is token1

  if (usdtPair !== null) {
    return usdtPair.token1Price
  } else {
    return ZERO_BD
  }
}

// whitelist [base token, pair address]
let WHITELIST: string[][] = [
  ['0xf7e8213cbcc88b64e4943b6aa9bd9752ac08b4f4', '0x3e0b2815ac13bbd73ca865b5ff183ec8dbbb98d3'],// IDXM
  ['0x21a870c7fce1bce5d88bdf845ac332c76204a9a0', '0x2c98813dea4aa80f0f160748450f0abfd51fb558'],// REFRACTION
  ['0x8cfd5ae0b3743da26cd36f86e77c301ede82009d', '0x9dB294D99BD3eAd20BCDdBfa65a9182c9ce89751'],// 3SEEDS
]

function findETHPair(address: string): string[] {
  for (let i = 0; i < WHITELIST.length; ++i) {
    if (WHITELIST[i][0] == address)
      return WHITELIST[i]
  }
  return []
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token | null): BigDecimal {
  let result = ZERO_BD

  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // lookuup pair
  let ethPairInfo = findETHPair(token.id)
  if (ethPairInfo.length) {
    let pair = Pair.load(ethPairInfo[1])
    let pairContract = PairContract.bind(Address.fromString(ethPairInfo[1]))
    let tokenQuote = Token.load(pair.tokenQuote)
    let price = pairContract.try_price()
    if (!price.reverted) {
      if (pair.tokenBase == token.id) {
        return convertTokenToDecimal(price.value, tokenQuote.decimals)
      }
      if (pair.tokenQuote == token.id) {
        return BigDecimal.fromString('1').div(convertTokenToDecimal(pairContract.price(), tokenQuote.decimals))
      }
    }
  }

  return result // nothing was found return 0
}

export function updatePair(pair: Pair | null): void {
  let pairContract = PairContract.bind(Address.fromString(pair.id))
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenBase = Token.load(pair.tokenBase)
  let price = pairContract.try_price()
  let supply = pairContract.try_supply()
  let reserves = pairContract.try_getReserves()
  if (!price.reverted && !supply.reverted && !reserves.reverted) {
    let basePrice = convertTokenToDecimal(price.value, tokenQuote.decimals)
    pair.tokenBasePrice = basePrice
    pair.tokenQuotePrice = BigDecimal.fromString('1').div(pair.tokenBasePrice)
    pair.supply = convertTokenToDecimal(supply.value, tokenBase.decimals)
    pair.reserveBase = convertTokenToDecimal(reserves.value.value0, tokenBase.decimals)
    pair.reserveQuote = convertTokenToDecimal(reserves.value.value1, tokenQuote.decimals)
  }
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmountBase: BigDecimal,
  tokenBase: Token,
  tokenAmountQuote: BigDecimal,
  tokenQuote: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let priceBase = tokenBase.derivedETH.times(bundle.ethPrice)
  let priceQuote = tokenQuote.derivedETH.times(bundle.ethPrice)
  let ethPair = findETHPair(tokenBase.id)
  if (ethPair.length && ethPair[1] === tokenQuote.id) {
    return tokenAmountBase.times(priceBase)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmountQuote: BigDecimal,
  tokenBase: Token,
  tokenAmount1: BigDecimal,
  tokenQuote: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let priceBase = tokenBase.derivedETH.times(bundle.ethPrice)
  let priceQuote = tokenQuote.derivedETH.times(bundle.ethPrice)
  let ethPair = findETHPair(tokenBase.id)
  if (ethPair.length) {
    return tokenAmountQuote.times(priceBase).plus(tokenAmount1.times(priceQuote))
  }

  // token not on whitelist
  return ZERO_BD
}
