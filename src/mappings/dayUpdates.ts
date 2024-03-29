import { PairHourData } from './../types/schema'
/* eslint-disable prefer-const */
import { BigInt, BigDecimal, ethereum } from '@graphprotocol/graph-ts'
import { Pair, Bundle, Token, Factory, DaofiDayData, PairDayData, TokenDayData } from '../types/schema'
import { ONE_BI, ZERO_BD, ZERO_BI, FACTORY_ADDRESS } from './helpers'

export function updateDAOfiDayData(event: ethereum.Event): void {
  let daofi = Factory.load(FACTORY_ADDRESS)
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let daofiDayData = DaofiDayData.load(dayID.toString())
  if (daofiDayData == null) {
    let daofiDayData = new DaofiDayData(dayID.toString())
    daofiDayData.date = dayStartTimestamp
    daofiDayData.dailyVolumeUSD = ZERO_BD
    daofiDayData.dailyVolumeETH = ZERO_BD
    daofiDayData.totalVolumeUSD = ZERO_BD
    daofiDayData.totalVolumeETH = ZERO_BD
    daofiDayData.totalLiquidityUSD = ZERO_BD
    daofiDayData.totalLiquidityETH = ZERO_BD
    daofiDayData.txCount = ZERO_BI
    daofiDayData.save()
  }
  daofiDayData = DaofiDayData.load(dayID.toString())
  daofiDayData.totalLiquidityUSD = daofi.totalLiquidityUSD
  daofiDayData.totalLiquidityETH = daofi.totalLiquidityETH
  daofiDayData.txCount = daofi.txCount
  daofiDayData.save()
}

export function updatePairDayData(event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let dayPairID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let pair = Pair.load(event.address.toHexString())
  let pairDayData = PairDayData.load(dayPairID)
  if (pairDayData == null) {
    let pairDayData = new PairDayData(dayPairID)
    let pair = Pair.load(event.address.toHexString())
    pairDayData.date = dayStartTimestamp
    pairDayData.tokenBase = pair.tokenBase
    pairDayData.tokenQuote = pair.tokenQuote
    pairDayData.supply = ZERO_BD
    pairDayData.pairAddress = event.address
    pairDayData.reserveBase = ZERO_BD
    pairDayData.reserveQuote = ZERO_BD
    pairDayData.reserveUSD = ZERO_BD
    pairDayData.dailyVolumeTokenBase = ZERO_BD
    pairDayData.dailyVolumeTokenQuote = ZERO_BD
    pairDayData.dailyVolumeUSD = ZERO_BD
    pairDayData.dailyTxns = ZERO_BI
    pairDayData.save()
  }
  pairDayData = PairDayData.load(dayPairID)
  pairDayData.supply = pair.supply
  pairDayData.reserveBase = pair.reserveBase
  pairDayData.reserveQuote = pair.reserveQuote
  pairDayData.reserveUSD = pair.reserveUSD
  pairDayData.dailyTxns = pairDayData.dailyTxns.plus(ONE_BI)
  pairDayData.save()
}

export function updatePairHourData(event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let hourIndex = timestamp / 3600 // get unique hour within unix history
  let hourStartUnix = hourIndex * 3600 // want the rounded effect
  let hourPairID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(hourIndex).toString())
  let pair = Pair.load(event.address.toHexString())
  let pairHourData = PairHourData.load(hourPairID)
  if (pairHourData == null) {
    let pairHourData = new PairHourData(hourPairID)
    pairHourData.hourStartUnix = hourStartUnix
    pairHourData.pair = event.address.toHexString()
    pairHourData.reserveBase = ZERO_BD
    pairHourData.reserveQuote = ZERO_BD
    pairHourData.supply = ZERO_BD
    pairHourData.reserveUSD = ZERO_BD
    pairHourData.hourlyVolumeTokenBase = ZERO_BD
    pairHourData.hourlyVolumeTokenQuote = ZERO_BD
    pairHourData.hourlyVolumeUSD = ZERO_BD
    pairHourData.hourlyTxns = ZERO_BI
    pairHourData.save()
  }
  pairHourData = PairHourData.load(hourPairID)
  pairHourData.reserveBase = pair.reserveBase
  pairHourData.reserveQuote = pair.reserveQuote
  pairHourData.reserveUSD = pair.reserveUSD
  pairHourData.supply = pair.supply
  pairHourData.hourlyTxns = pairHourData.hourlyTxns.plus(ONE_BI)
  pairHourData.save()
}

export function updateTokenDayData(token: Token, event: ethereum.Event): void {
  let bundle = Bundle.load('1')
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let tokenDayID = token.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  let tokenDayData = TokenDayData.load(tokenDayID)
  if (tokenDayData == null) {
    let tokenDayData = new TokenDayData(tokenDayID)
    tokenDayData.date = dayStartTimestamp
    tokenDayData.token = token.id
    tokenDayData.priceUSD = token.derivedETH.times(bundle.ethPrice)
    tokenDayData.dailyVolumeToken = ZERO_BD
    tokenDayData.dailyVolumeETH = ZERO_BD
    tokenDayData.dailyVolumeUSD = ZERO_BD
    tokenDayData.dailyTxns = ZERO_BI
    tokenDayData.totalLiquidityToken = ZERO_BD
    tokenDayData.totalLiquidityETH = ZERO_BD
    tokenDayData.totalLiquidityUSD = ZERO_BD
    tokenDayData.save()
  }
  tokenDayData = TokenDayData.load(tokenDayID)
  tokenDayData.priceUSD = token.derivedETH.times(bundle.ethPrice)
  tokenDayData.totalLiquidityToken = token.totalLiquidity
  tokenDayData.totalLiquidityETH = token.totalLiquidity.times(token.derivedETH as BigDecimal)
  tokenDayData.totalLiquidityUSD = tokenDayData.totalLiquidityETH.times(bundle.ethPrice)
  tokenDayData.dailyTxns = tokenDayData.dailyTxns.plus(ONE_BI)
  tokenDayData.save()

  /**
   * @todo test if this speeds up sync
   */
  // updateStoredTokens(tokenDayData as TokenDayData, dayID)
  // updateStoredPairs(tokenDayData as TokenDayData, dayPairID)
}
