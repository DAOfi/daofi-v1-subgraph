import { PairHourData } from './../types/schema'
/* eslint-disable prefer-const */
import { log, BigInt, BigDecimal, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  Factory,
  Transaction,
  DaofiDayData,
  PairDayData,
  TokenDayData,
  Swap as SwapEvent,
  Deposit as DepositEvent,
  Withdraw as WithdrawEvent,
  Bundle
} from '../types/schema'
import { Swap, Deposit, Withdraw, WithdrawFees } from '../types/templates/Pair/Pair'
import { updatePairDayData, updateTokenDayData, updateDAOfiDayData, updatePairHourData } from './dayUpdates'
import { getPairPrices, getEthPriceInUSD, findEthPerToken, getTrackedVolumeUSD, getTrackedLiquidityUSD } from './pricing'
import {
  createUser,
  convertTokenToDecimal,
  FACTORY_ADDRESS,
  ONE_BI,
  createLiquidityPosition,
  ZERO_BD,
  createLiquiditySnapshot,
} from './helpers'

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenIn = Token.load(event.params.tokenIn.toHexString())
  let tokenOut = Token.load(event.params.tokenOut.toHexString())
  let amountIn = convertTokenToDecimal(event.params.amountIn, tokenBase.decimals)
  let amountOut = convertTokenToDecimal(event.params.amountOut, tokenQuote.decimals)
  let isBuy = event.params.tokenOut.toHexString() === pair.tokenBase
  let zero = BigDecimal.fromString('0')
  // totals for volume updates
  let amountBaseTotal = isBuy ? amountOut : amountIn
  let amountQuoteTotal = isBuy ? amountIn : amountOut
  let amountBaseIn = isBuy ? zero : amountIn
  let amountQuoteIn = isBuy ? amountIn : zero
  let amountBaseOut = isBuy ? amountOut : zero
  let amountQuoteOut = isBuy ? zero : amountOut


  // ETH/USD prices
  let bundle = Bundle.load('1')

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = tokenQuote.derivedETH
    .times(amountQuoteTotal)
    .plus(tokenBase.derivedETH.times(amountBaseTotal))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amountBaseTotal, tokenBase as Token, amountQuoteTotal, tokenQuote as Token, pair as Pair)

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update tokenBase global volume and token liquidity stats
  tokenBase.tradeVolume = tokenBase.tradeVolume.plus(amountBaseIn.plus(amountBaseOut))
  tokenBase.tradeVolumeUSD = tokenBase.tradeVolumeUSD.plus(trackedAmountUSD)

  // update tokenQuote global volume and token liquidity stats
  tokenQuote.tradeVolume = tokenQuote.tradeVolume.plus(amountQuoteIn.plus(amountQuoteOut))
  tokenQuote.tradeVolumeUSD = tokenQuote.tradeVolumeUSD.plus(trackedAmountUSD)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
  pair.volumeTokenBase = pair.volumeTokenBase.plus(amountBaseTotal)
  pair.volumeTokenQuote = pair.volumeTokenQuote.plus(amountQuoteTotal)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let factory = Factory.load(FACTORY_ADDRESS)
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(trackedAmountUSD)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(trackedAmountETH)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // save entities
  pair.save()
  tokenBase.save()
  tokenQuote.save()
  factory.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.deposits = []
    transaction.swaps = []
    transaction.withdrawals = []
    transaction.feeWithdrawals = []
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
  swap.amountIn = amountBaseIn.plus(amountQuoteIn)
  swap.amountOut = amountBaseOut.plus(amountQuoteOut)
  swap.tokenIn = tokenIn.id
  swap.tokenOut = tokenOut.id
  swap.to = event.params.to
  swap.logIndex = event.logIndex
  // use the tracked amount if we have it
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
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
  let daofiDayData = DaofiDayData.load(dayID.toString())
  daofiDayData.dailyVolumeUSD = daofiDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  daofiDayData.dailyVolumeETH = daofiDayData.dailyVolumeETH.plus(trackedAmountETH)
  daofiDayData.save()

  // swap specific updating for pair
  let pairDayData = PairDayData.load(dayPairID)
  pairDayData.dailyVolumeTokenBase = pairDayData.dailyVolumeTokenBase.plus(amountBaseTotal)
  pairDayData.dailyVolumeTokenQuote = pairDayData.dailyVolumeTokenQuote.plus(amountQuoteTotal)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  let pairHourData = PairHourData.load(hourPairID)
  pairHourData.hourlyVolumeTokenBase = pairHourData.hourlyVolumeTokenBase.plus(amountBaseTotal)
  pairHourData.hourlyVolumeTokenQuote = pairHourData.hourlyVolumeTokenQuote.plus(amountQuoteTotal)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  pairHourData.save()

  // swap specific updating for tokenBase
  let tokenBaseDayID = tokenBase.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let tokenBaseDayData = TokenDayData.load(tokenBaseDayID)
  tokenBaseDayData.dailyVolumeToken = tokenBaseDayData.dailyVolumeToken.plus(amountBaseTotal)
  tokenBaseDayData.dailyVolumeETH = tokenBaseDayData.dailyVolumeETH.plus(amountBaseTotal.times(tokenQuote.derivedETH as BigDecimal))
  tokenBaseDayData.dailyVolumeUSD = tokenBaseDayData.dailyVolumeUSD.plus(
    amountBaseTotal.times(tokenBase.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  tokenBaseDayData.save()

  // swap specific updating
  let tokenQuoteDayID = tokenQuote.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let tokenQuoteDayData = TokenDayData.load(tokenQuoteDayID)
  tokenQuoteDayData = TokenDayData.load(tokenQuoteDayID)
  tokenQuoteDayData.dailyVolumeToken = tokenQuoteDayData.dailyVolumeToken.plus(amountQuoteTotal)
  tokenQuoteDayData.dailyVolumeETH = tokenQuoteDayData.dailyVolumeETH.plus(amountQuoteTotal.times(tokenQuote.derivedETH as BigDecimal))
  tokenQuoteDayData.dailyVolumeUSD = tokenQuoteDayData.dailyVolumeUSD.plus(
    amountQuoteTotal.times(tokenQuote.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  tokenQuoteDayData.save()

  // reset factory liquidity by subtracting onluy tarcked liquidity
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(pair.reserveETH as BigDecimal)

  // set token total liquidity amounts
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.plus(amountBaseIn).minus(amountBaseOut)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.plus(amountQuoteIn).minus(amountQuoteOut)

  if (pair.reserveQuote.notEqual(ZERO_BD))
    pair.tokenBasePrice = pair.supply.times(pair.slopeNumerator.toBigDecimal()).div(BigDecimal.fromString('1000000'))
  else
    pair.tokenBasePrice = ZERO_BD
  if (pair.tokenBasePrice.notEqual(ZERO_BD))
    pair.tokenQuotePrice = BigDecimal.fromString('1').div(pair.tokenBasePrice)
  else
    pair.tokenQuotePrice = ZERO_BD

  pair.save()

  // update ETH price now that reserves could have changed
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  tokenBase.derivedETH = findEthPerToken(tokenBase as Token)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote as Token)
  tokenBase.save()
  tokenQuote.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserveBase, tokenBase as Token, pair.reserveQuote, tokenQuote as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair
  pair.reserveETH = pair.reserveBase
    .times(tokenBase.derivedETH as BigDecimal)
    .plus(pair.reserveQuote.times(tokenQuote.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(trackedLiquidityETH)
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)

  // save entities
  pair.save()
  factory.save()
  tokenBase.save()
  tokenQuote.save()
}


function isCompleteDeposit(depositId: string): boolean {
  return DepositEvent.load(depositId).sender !== null // sufficient checks
}

export function handleDeposit(event: Deposit): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let pair = Pair.load(event.address.toHex())
  let factory = Factory.load(FACTORY_ADDRESS)
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenBaseAmount = convertTokenToDecimal(event.params.amountBase, tokenBase.decimals)
  let tokenQuoteAmount = convertTokenToDecimal(event.params.amountQuote, tokenQuote.decimals)
  let baseOut = convertTokenToDecimal(event.params.output, tokenQuote.decimals)
  let deposits = transaction.deposits
  // update tokens
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.plus(tokenBaseAmount)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.plus(tokenQuoteAmount)
  tokenBase.derivedETH = findEthPerToken(tokenBase)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote)
  // update factory
  factory.txCount = factory.txCount.plus(ONE_BI)
  let depositAmountETH = tokenQuote.derivedETH.times(tokenQuoteAmount).plus(tokenBase.derivedETH.times(tokenBaseAmount))
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(depositAmountETH)
  let bundle = Bundle.load('1')
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)
  // update deposit
  if (deposits.length === 0 || isCompleteDeposit(deposits[deposits.length - 1])) {
    let deposit: DepositEvent = new DepositEvent(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(deposits.length).toString())
    )
    deposit.transaction = transaction.id
    deposit.timestamp = transaction.timestamp
    deposit.pair = event.address.toHexString()
    deposit.sender = event.params.sender
    deposit.amountBase = tokenBaseAmount
    deposit.amountQuote = tokenQuoteAmount
    deposit.output = pair.supply = baseOut
    deposit.to = event.params.to
    deposit.logIndex = event.logIndex
    deposit.amountUSD = depositAmountETH.times(bundle.ethPrice)
    transaction.deposits = deposits.concat([deposit.id])

    // create users
    createUser(event.params.sender)
    createUser(event.params.to)

    // update the LP position
    let liquidityPosition = createLiquidityPosition(event.address, deposit.to as Address)
    createLiquiditySnapshot(liquidityPosition, event)
    deposit.save()
  }
  // update pair
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.reserveBase = tokenBaseAmount
  pair.reserveQuote = tokenQuoteAmount
  pair.reserveETH = depositAmountETH
  pair.reserveUSD = depositAmountETH.times(bundle.ethPrice)
  let pairPrices = getPairPrices(pair.id)
  pair.tokenBasePrice = pairPrices[0]
  pair.tokenQuotePrice = pairPrices[1]

  // save entities
  transaction.save()
  tokenBase.save()
  tokenQuote.save()
  pair.save()
  factory.save()

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)
}

export function handleWithdraw(event: Withdraw): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let withdrawals = transaction.withdrawals
  let withdraw = WithdrawEvent.load(withdrawals[withdrawals.length - 1])

  let pair = Pair.load(event.address.toHex())
  let factory = Factory.load(FACTORY_ADDRESS)

  //update token info
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenBaseAmount = convertTokenToDecimal(event.params.amountBase, tokenBase.decimals)
  let tokenQuoteAmount = convertTokenToDecimal(event.params.amountQuote, tokenQuote.decimals)

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = tokenQuote.derivedETH
    .times(tokenQuoteAmount)
    .plus(tokenBase.derivedETH.times(tokenBaseAmount))
    .times(bundle.ethPrice)

  // update txn counts
  factory.txCount = factory.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global counter and save
  tokenBase.save()
  tokenQuote.save()
  pair.save()
  factory.save()

  // update withdraw
  // withdraw.sender = event.params.sender
  withdraw.amountBase = tokenBaseAmount as BigDecimal
  withdraw.amountQuote = tokenQuoteAmount as BigDecimal
  // withdraw.to = event.params.to
  withdraw.logIndex = event.logIndex
  withdraw.amountUSD = amountTotalUSD as BigDecimal
  withdraw.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, withdraw.sender as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateDAOfiDayData(event)
  updateTokenDayData(tokenBase as Token, event)
  updateTokenDayData(tokenQuote as Token, event)
}