/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from './helpers'

const WUSD_ADDRESS = '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d'

export function getEthPriceInUSD(): BigDecimal {
  return ONE_BD
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST = {
  // '0x71850b7e9ee3f13ab46d67167341e4bdc905eef9', // HONEY
  '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d': { 1, 1, 0], // WXDAI
  '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', 1, 1, 0], // USDC on xDai
  '0x4ecaba5870353805a9f068101a40e0f32ed605c6', 1, 1, 0], // Tether on xDai
  '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1', 21500, 1, 0] // Wrapped Ether on xDai
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('400000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WUSD_ADDRESS) {
    return ONE_BD
  }

  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(
      Address.fromString(token.id),
      Address.fromString(WHITELIST[i][0] as string),
      BigInt.fromI32(WHITELIST[i][1] as number),
      BigInt.fromI32(WHITELIST[i][2] as number),
      BigInt.fromI32(WHITELIST[i][3] as number)
    )
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.tokenBase == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let tokenQuote = Token.load(pair.tokenQuote)
        return pair.tokenQuotePrice.times(tokenQuote.derivedETH as BigDecimal) // return tokenQuote per our token * Eth per token 1
      }
      if (pair.tokenQuote == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let tokenBase = Token.load(pair.tokenBase)
        return pair.tokenBasePrice.times(tokenBase.derivedETH as BigDecimal) // return tokenBase per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
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

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  // if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
  //   let reserve0USD = pair.reserve0.times(priceBase)
  //   let reserve1USD = pair.reserve1.times(priceQuote)
  //   if (WHITELIST.includes(tokenBase.id) && WHITELIST.includes(tokenQuote.id)) {
  //     if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
  //       return ZERO_BD
  //     }
  //   }
  //   if (WHITELIST.includes(tokenBase.id) && !WHITELIST.includes(tokenQuote.id)) {
  //     if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
  //       return ZERO_BD
  //     }
  //   }
  //   if (!WHITELIST.includes(tokenBase.id) && WHITELIST.includes(tokenQuote.id)) {
  //     if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
  //       return ZERO_BD
  //     }
  //   }
  // }


  // take full value of the whitelisted token amount
  if (WHITELIST.includes(tokenBase.id) && !WHITELIST.includes(tokenQuote.id)) {
    return tokenAmountBase.times(priceBase)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(tokenBase.id) && WHITELIST.includes(tokenQuote.id)) {
    return tokenAmountQuote.times(priceQuote)
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
  tokenAmountBase: BigDecimal,
  tokenBase: Token,
  tokenAmountQuote: BigDecimal,
  tokenQuote: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let priceBase = tokenBase.derivedETH.times(bundle.ethPrice)
  let priceQuote = tokenQuote.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(tokenBase.id) && WHITELIST.includes(tokenQuote.id)) {
    return tokenAmountBase.times(priceBase).plus(tokenAmountQuote.times(priceQuote))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(tokenBase.id) && !WHITELIST.includes(tokenQuote.id)) {
    return tokenAmountBase.times(priceBase).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(tokenBase.id) && WHITELIST.includes(tokenQuote.id)) {
    return tokenAmountQuote.times(priceQuote).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
