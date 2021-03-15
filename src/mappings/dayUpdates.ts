import { PairHourData } from './../types/schema'
/* eslint-disable prefer-const */
import { BigInt, BigDecimal, EthereumEvent } from '@graphprotocol/graph-ts'
import { Pair, Bundle, Token, DAOfiFactory, DAOfiDayData, PairDayData, TokenDayData } from '../types/schema'
import { ONE_BI, ZERO_BD, ZERO_BI, FACTORY_ADDRESS } from './helpers'

export function updateDAOfiDayData(event: EthereumEvent): void {
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let daofiDayData = DAOfiDayData.load(dayID.toString())
  if (daofiDayData == null) {
    let daofiDayData = new DAOfiDayData(dayID.toString())
    daofiDayData.date = dayStartTimestamp
    daofiDayData.dailyVolumeXDAI = ZERO_BD
    daofiDayData.dailyVolumeETH = ZERO_BD
    daofiDayData.totalVolumeXDAI = ZERO_BD
    daofiDayData.totalVolumeETH = ZERO_BD
    daofiDayData.dailyVolumeUntracked = ZERO_BD
    daofiDayData.totalLiquidityXDAI = ZERO_BD
    daofiDayData.totalLiquidityETH = ZERO_BD
    daofiDayData.txCount = ZERO_BI
    daofiDayData.save()
  }
  daofiDayData = DAOfiDayData.load(dayID.toString())
  daofiDayData.totalLiquidityXDAI = daofi.totalLiquidityXDAI
  daofiDayData.totalLiquidityETH = daofi.totalLiquidityETH
  daofiDayData.txCount = daofi.txCount
  daofiDayData.save()
}

export function updatePairDayData(event: EthereumEvent): void {
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
    pairDayData.totalSupply = pair.totalSupply
    pairDayData.date = dayStartTimestamp
    pairDayData.token0 = pair.token0
    pairDayData.token1 = pair.token1
    pairDayData.pairAddress = event.address
    pairDayData.reserve0 = ZERO_BD
    pairDayData.reserve1 = ZERO_BD
    pairDayData.reserveXDAI = ZERO_BD
    pairDayData.dailyVolumeTokenBase = ZERO_BD
    pairDayData.dailyVolumeTokenQuote = ZERO_BD
    pairDayData.dailyVolumeXDAI = ZERO_BD
    pairDayData.dailyTxns = ZERO_BI
    pairDayData.save()
  }
  pairDayData = PairDayData.load(dayPairID)
  pairDayData.totalSupply = pair.totalSupply
  pairDayData.reserve0 = pair.reserve0
  pairDayData.reserve1 = pair.reserve1
  pairDayData.reserveXDAI = pair.reserveXDAI
  pairDayData.dailyTxns = pairDayData.dailyTxns.plus(ONE_BI)
  pairDayData.save()
}

export function updatePairHourData(event: EthereumEvent): void {
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
    pairHourData.reserve0 = ZERO_BD
    pairHourData.reserve1 = ZERO_BD
    pairHourData.reserveXDAI = ZERO_BD
    pairHourData.hourlyVolumeTokenBase = ZERO_BD
    pairHourData.hourlyVolumeTokenQuote = ZERO_BD
    pairHourData.hourlyVolumeXDAI = ZERO_BD
    pairHourData.hourlyTxns = ZERO_BI
    pairHourData.save()
  }
  pairHourData = PairHourData.load(hourPairID)
  pairHourData.reserve0 = pair.reserve0
  pairHourData.reserve1 = pair.reserve1
  pairHourData.reserveXDAI = pair.reserveXDAI
  pairHourData.hourlyTxns = pairHourData.hourlyTxns.plus(ONE_BI)
  pairHourData.save()
}

export function updateTokenDayData(token: Token, event: EthereumEvent): void {
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
    tokenDayData.priceXDAI = token.derivedETH.times(bundle.ethPrice)
    tokenDayData.dailyVolumeToken = ZERO_BD
    tokenDayData.dailyVolumeETH = ZERO_BD
    tokenDayData.dailyVolumeXDAI = ZERO_BD
    tokenDayData.dailyTxns = ZERO_BI
    tokenDayData.totalLiquidityToken = ZERO_BD
    tokenDayData.totalLiquidityETH = ZERO_BD
    tokenDayData.totalLiquidityXDAI = ZERO_BD
    tokenDayData.save()
  }
  tokenDayData = TokenDayData.load(tokenDayID)
  tokenDayData.priceXDAI = token.derivedETH.times(bundle.ethPrice)
  tokenDayData.totalLiquidityToken = token.totalLiquidity
  tokenDayData.totalLiquidityETH = token.totalLiquidity.times(token.derivedETH as BigDecimal)
  tokenDayData.totalLiquidityXDAI = tokenDayData.totalLiquidityETH.times(bundle.ethPrice)
  tokenDayData.dailyTxns = tokenDayData.dailyTxns.plus(ONE_BI)
  tokenDayData.save()

  /**
   * @todo test if this speeds up sync
   */
  // updateStoredTokens(tokenDayData as TokenDayData, dayID)
  // updateStoredPairs(tokenDayData as TokenDayData, dayPairID)
}
