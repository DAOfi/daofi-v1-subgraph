/* eslint-disable prefer-const */
import { Pair, Token, UniswapPair, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { convertTokenToDecimal, ZERO_BD, ONE_BD } from './helpers'
import { Pair as PairContract } from '../types/templates/Pair/Pair'

const WETH_ADDRESS = '0x80c2553261f77b00dcaadfd3612403ac7f67b6fb'
const USDT_WETH_PAIR = '0x372d9eb2695afa280d113b94e4a022ecadaaea76' // created block 10093341

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
  ['0xf4762ff096e046b3ae3abb428e255779d7befb16', '0xade4a5ce24f155d8f0720cfeb4f47f52f7dafd95'],// IDXM
  ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']// REFRACTION
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
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // lookuup pair
  let ethPairInfo = findETHPair(token.id)
  if (ethPairInfo.length) {
    let pair = Pair.load(ethPairInfo[1])
    let pairContract = PairContract.bind(Address.fromString(ethPairInfo[1]))
    let tokenQuote = Token.load(pair.tokenQuote)
    if (pair.tokenBase == token.id) {
      return convertTokenToDecimal(pairContract.price(), tokenQuote.decimals)
    }
    if (pair.tokenQuote == token.id) {
      return BigDecimal.fromString('1').div(convertTokenToDecimal(pairContract.price(), tokenQuote.decimals))
    }
  }
  return ZERO_BD // nothing was found return 0
}

export function getPairPrices(pairAddress: string): BigDecimal[] {
  let pair = Pair.load(pairAddress)
  let pairContract = PairContract.bind(Address.fromString(pairAddress))
  let tokenQuote = Token.load(pair.tokenQuote)
  let basePrice = convertTokenToDecimal(pairContract.price(), tokenQuote.decimals)
  return [basePrice, BigDecimal.fromString('1').div(basePrice)]
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
