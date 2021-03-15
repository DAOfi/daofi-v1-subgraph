import { PairHourData } from './../types/schema'
/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  DAOfiFactory,
  Transaction,
  DAOfiDayData,
  PairDayData,
  TokenDayData,
  Swap as SwapEvent,
  Bundle
} from '../types/schema'
import { Pair as PairContract, Swap, Deposit, Withdraw, WithdrawFees } from '../types/templates/Pair/Pair'
import { updatePairDayData, updateTokenDayData, updateDAOfiDayData, updatePairHourData } from './dayUpdates'
import { getEthPriceInUSD, findEthPerToken, getTrackedVolumeUSD, getTrackedLiquidityUSD } from './pricing'
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  FACTORY_ADDRESS,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  ZERO_BD,
  BI_18,
  createLiquiditySnapshot
} from './helpers'

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenIn = Token.load(event.tokenIn)
  let tokenOut = Token.load(pair.tokenQuote)
  let amountIn = convertTokenToDecimal(event.params.amountIn, tokenBase.decimals)
  let amountOut = convertTokenToDecimal(event.params.amountOut, tokenQuote.decimals)

  // totals for volume updates
  let amount0Total = amount0Out.plus(amount0In)
  let amount1Total = amount1Out.plus(amount1In)

  // ETH/USD prices
  let bundle = Bundle.load('1')

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = tokenQuote.derivedETH
    .times(amount1Total)
    .plus(tokenBase.derivedETH.times(amount0Total))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, tokenBase as Token, amount1Total, tokenQuote as Token, pair as Pair)

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update tokenBase global volume and token liquidity stats
  tokenBase.tradeVolume = tokenBase.tradeVolume.plus(amount0In.plus(amount0Out))
  tokenBase.tradeVolumeXDAI = tokenBase.tradeVolumeXDAI.plus(trackedAmountUSD)
  tokenBase.untrackedVolumeXDAI = tokenBase.untrackedVolumeXDAI.plus(derivedAmountUSD)

  // update tokenQuote global volume and token liquidity stats
  tokenQuote.tradeVolume = tokenQuote.tradeVolume.plus(amount1In.plus(amount1Out))
  tokenQuote.tradeVolumeXDAI = tokenQuote.tradeVolumeXDAI.plus(trackedAmountUSD)
  tokenQuote.untrackedVolumeXDAI = tokenQuote.untrackedVolumeXDAI.plus(derivedAmountUSD)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeXDAI = pair.volumeXDAI.plus(trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.untrackedVolumeXDAI = pair.untrackedVolumeXDAI.plus(derivedAmountUSD)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)
  daofi.totalVolumeXDAI = daofi.totalVolumeXDAI.plus(trackedAmountUSD)
  daofi.totalVolumeETH = daofi.totalVolumeETH.plus(trackedAmountETH)
  daofi.untrackedVolumeXDAI = daofi.untrackedVolumeXDAI.plus(derivedAmountUSD)
  daofi.txCount = daofi.txCount.plus(ONE_BI)

  // save entities
  pair.save()
  tokenBase.save()
  tokenQuote.save()
  daofi.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
    transaction.save()
  }
  let swaps = transaction.swaps
  let swap = new SwapEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(swaps.length).toString())
  )

  // update swap event
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.transaction = transaction.id
  swap.sender = event.params.sender
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.logIndex = event.logIndex
  // use the tracked amount if we have it
  swap.amountXDAI = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  swap.save()

  // update the transaction
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)

  let timestamp = event.block.timestamp.toI32()
  // daily info
  let dayID = timestamp / 86400
  let dayPairID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  // hourly info
  let hourID = timestamp / 3600
  let hourPairID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(hourID).toString())

  // swap specific updating
  let daofiDayData = DAOfiDayData.load(dayID.toString())
  daofiDayData.dailyVolumeXDAI = daofiDayData.dailyVolumeXDAI.plus(trackedAmountUSD)
  daofiDayData.dailyVolumeETH = daofiDayData.dailyVolumeETH.plus(trackedAmountETH)
  daofiDayData.dailyVolumeUntracked = daofiDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  daofiDayData.save()

  // swap specific updating for pair
  let pairDayData = PairDayData.load(dayPairID)
  pairDayData.dailyVolumeTokenBase = pairDayData.dailyVolumeTokenBase.plus(amount0Total)
  pairDayData.dailyVolumeTokenQuote = pairDayData.dailyVolumeTokenQuote.plus(amount1Total)
  pairDayData.dailyVolumeXDAI = pairDayData.dailyVolumeXDAI.plus(trackedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  let pairHourData = PairHourData.load(hourPairID)
  pairHourData.hourlyVolumeTokenBase = pairHourData.hourlyVolumeTokenBase.plus(amount0Total)
  pairHourData.hourlyVolumeTokenQuote = pairHourData.hourlyVolumeTokenQuote.plus(amount1Total)
  pairHourData.hourlyVolumeXDAI = pairHourData.hourlyVolumeXDAI.plus(trackedAmountUSD)
  pairHourData.save()

  // swap specific updating for tokenBase
  let token0DayID = tokenBase.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let token0DayData = TokenDayData.load(token0DayID)
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
  token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(amount0Total.times(tokenQuote.derivedETH as BigDecimal))
  token0DayData.dailyVolumeXDAI = token0DayData.dailyVolumeXDAI.plus(
    amount0Total.times(tokenBase.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token0DayData.save()

  // swap specific updating
  let token1DayID = tokenQuote.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let token1DayData = TokenDayData.load(token1DayID)
  token1DayData = TokenDayData.load(token1DayID)
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
  token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(amount1Total.times(tokenQuote.derivedETH as BigDecimal))
  token1DayData.dailyVolumeXDAI = token1DayData.dailyVolumeXDAI.plus(
    amount1Total.times(tokenQuote.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token1DayData.save()
  let pair1 = Pair.load(event.address.toHex())
  let tokenBase = Token.load(pair1.baseToken)
  let tokenQuote = Token.load(pair1.quoteToken)
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)

  // reset factory liquidity by subtracting onluy tarcked liquidity
  daofi.totalLiquidityETH = daofi.totalLiquidityETH.minus(pair1.trackedReserveETH as BigDecimal)

  // reset token total liquidity amounts
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.minus(pair1.reserve0)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.minus(pair1.reserve1)

  pair1.reserve0 = convertTokenToDecimal(event.params.reserve0, tokenBase.decimals)
  pair1.reserve1 = convertTokenToDecimal(event.params.reserve1, tokenQuote.decimals)

  if (pair1.reserve1.notEqual(ZERO_BD))
    pair1.token0Price = pair1.reserve0.div(pair1.reserve1)
  else
    pair1.token0Price = ZERO_BD
  if (pair1.reserve0.notEqual(ZERO_BD))
    pair1.token1Price = pair1.reserve1.div(pair1.reserve0)
  else
    pair1.token1Price = ZERO_BD

  pair1.save()

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  tokenBase.derivedETH = findEthPerToken(tokenBase as Token)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote as Token)
  tokenBase.save()
  tokenQuote.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(pair1.reserve0, tokenBase as Token, pair1.reserve1, tokenQuote as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair1
  pair1.trackedReserveETH = trackedLiquidityETH
  pair1.reserveETH = pair1.reserve0
    .times(tokenBase.derivedETH as BigDecimal)
    .plus(pair1.reserve1.times(tokenQuote.derivedETH as BigDecimal))
  pair1.reserveXDAI = pair1.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  daofi.totalLiquidityETH = daofi.totalLiquidityETH.plus(trackedLiquidityETH)
  daofi.totalLiquidityXDAI = daofi.totalLiquidityETH.times(bundle.ethPrice)

  // now correctly set liquidity amounts for each token
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.plus(pair1.reserve0)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.plus(pair1.reserve1)

  // save entities
  pair1.save()
  daofi.save()
  tokenBase.save()
  tokenQuote.save()
}

export function handleDeposit(event: Deposit): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let mints = transaction.mints
  let mint = MintEvent.load(mints[mints.length - 1])

  let pair = Pair.load(event.address.toHex())
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)

  let tokenBase = Token.load(pair.baseToken)
  let tokenQuote = Token.load(pair.quoteToken)

  // update exchange info (except balances, sync will cover that)
  let token0Amount = convertTokenToDecimal(event.params.amount0, tokenBase.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, tokenQuote.decimals)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = tokenQuote.derivedETH
    .times(token1Amount)
    .plus(tokenBase.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  daofi.txCount = daofi.txCount.plus(ONE_BI)

  // save entities
  tokenBase.save()
  tokenQuote.save()
  pair.save()
  daofi.save()

  mint.sender = event.params.sender
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountXDAI = amountTotalUSD as BigDecimal
  mint.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, mint.to as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)
}

export function handleWithdraw(event: Withdraw): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1])

  let pair = Pair.load(event.address.toHex())
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)

  //update token info
  let tokenBase = Token.load(pair.baseToken)
  let tokenQuote = Token.load(pair.quoteToken)
  let token0Amount = convertTokenToDecimal(event.params.amount0, tokenBase.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, tokenQuote.decimals)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = tokenQuote.derivedETH
    .times(token1Amount)
    .plus(tokenBase.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  daofi.txCount = daofi.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global counter and save
  tokenBase.save()
  tokenQuote.save()
  pair.save()
  daofi.save()

  // update burn
  // burn.sender = event.params.sender
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountXDAI = amountTotalUSD as BigDecimal
  burn.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, burn.sender as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)
}

export function handleWithdrawFees(event: WithdrawFees): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1])

  let pair = Pair.load(event.address.toHex())
  let daofi = DAOfiFactory.load(FACTORY_ADDRESS)

  //update token info
  let tokenBase = Token.load(pair.baseToken)
  let tokenQuote = Token.load(pair.quoteToken)
  let token0Amount = convertTokenToDecimal(event.params.amount0, tokenBase.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, tokenQuote.decimals)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = tokenQuote.derivedETH
    .times(token1Amount)
    .plus(tokenBase.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  daofi.txCount = daofi.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global counter and save
  tokenBase.save()
  tokenQuote.save()
  pair.save()
  daofi.save()

  // update burn
  // burn.sender = event.params.sender
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountXDAI = amountTotalUSD as BigDecimal
  burn.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, burn.sender as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)
}