/* eslint-disable prefer-const */
import { log, BigInt, BigDecimal, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  Factory,
  Transaction,
  DaofiDayData,
  PairHourData,
  PairDayData,
  TokenDayData,
  Swap as SwapEvent,
  Deposit as DepositEvent,
  Withdraw as WithdrawEvent,
  WithdrawFees as WithdrawFeesEvent,
  Bundle,
  User
} from '../types/schema'
import { Swap, Deposit, Withdraw, WithdrawFees } from '../types/templates/Pair/Pair'
import { updatePairDayData, updateTokenDayData, updateDAOfiDayData, updatePairHourData } from './dayUpdates'
import { updatePair, getEthPriceInUSD, findEthPerToken} from './pricing'
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
  let isBuy = event.params.tokenOut.toHexString() == pair.tokenBase
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

  // get the average eth / amounts for tracking on the pair
  let derivedAmountETH = tokenQuote.derivedETH
    .times(amountQuoteTotal)
    .plus(tokenBase.derivedETH.times(amountBaseTotal))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)


  // update tokenBase global volume and token liquidity stats
  let baseVolume = amountBaseIn.plus(amountBaseOut)
  tokenBase.tradeVolume = tokenBase.tradeVolume.plus(baseVolume)
  tokenBase.tradeVolumeUSD = tokenBase.tradeVolumeUSD.plus(tokenBase.derivedETH.times(baseVolume).times(bundle.ethPrice))

  // update tokenQuote global volume and token liquidity stats
  let quoteVolume = amountQuoteIn.plus(amountQuoteOut)
  tokenQuote.tradeVolume = tokenQuote.tradeVolume.plus(quoteVolume)
  tokenQuote.tradeVolumeUSD = tokenQuote.tradeVolumeUSD.plus(tokenQuote.derivedETH.times(quoteVolume).times(bundle.ethPrice))

  // update txn counts
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)

  // update pair prices, supply, volume data and txCount
  pair.volumeUSD = pair.volumeUSD.plus(derivedAmountUSD)
  pair.volumeTokenBase = pair.volumeTokenBase.plus(amountBaseTotal)
  pair.volumeTokenQuote = pair.volumeTokenQuote.plus(amountQuoteTotal)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let factory = Factory.load(FACTORY_ADDRESS)
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(derivedAmountUSD)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(derivedAmountETH)
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
  swap.tokenBase = tokenBase.id
  swap.tokenQuote = tokenQuote.id
  swap.to = event.params.to
  swap.logIndex = event.logIndex
  swap.amountUSD = derivedAmountUSD
  swap.save()

  // update the transaction
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // update the user
  createUser(event.params.to)
  let user = User.load(event.params.to.toHexString())
  user.usdSwapped = user.usdSwapped.plus(derivedAmountUSD)
  user.save()

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
  daofiDayData.dailyVolumeUSD = daofiDayData.dailyVolumeUSD.plus(derivedAmountUSD)
  daofiDayData.dailyVolumeETH = daofiDayData.dailyVolumeETH.plus(derivedAmountETH)
  daofiDayData.totalVolumeUSD = factory.totalVolumeUSD
  daofiDayData.totalVolumeETH = factory.totalVolumeETH
  daofiDayData.save()

  // swap specific updating for pair
  let pairDayData = PairDayData.load(dayPairID)
  pairDayData.dailyVolumeTokenBase = pairDayData.dailyVolumeTokenBase.plus(amountBaseTotal)
  pairDayData.dailyVolumeTokenQuote = pairDayData.dailyVolumeTokenQuote.plus(amountQuoteTotal)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(derivedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  let pairHourData = PairHourData.load(hourPairID)
  pairHourData.hourlyVolumeTokenBase = pairHourData.hourlyVolumeTokenBase.plus(amountBaseTotal)
  pairHourData.hourlyVolumeTokenQuote = pairHourData.hourlyVolumeTokenQuote.plus(amountQuoteTotal)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(derivedAmountUSD)
  pairHourData.save()

  // swap specific updating for tokenBase
  let tokenBaseDayID = tokenBase.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let tokenBaseDayData = TokenDayData.load(tokenBaseDayID)
  tokenBaseDayData.dailyVolumeToken = tokenBaseDayData.dailyVolumeToken.plus(amountBaseTotal)
  tokenBaseDayData.dailyVolumeETH = tokenBaseDayData.dailyVolumeETH.plus(amountBaseTotal.times(tokenBase.derivedETH as BigDecimal))
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

  // reset liquidity by subtracting the previous resereves
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.minus(pair.reserveBase)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.minus(pair.reserveQuote)
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(pair.reserveETH)

  // update ETH price now that reserves could have changed
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  tokenBase.derivedETH = findEthPerToken(tokenBase as Token)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote as Token)
  tokenBase.save()
  tokenQuote.save()

  // update pair and calcuate derived amounts
  updatePair(pair)
  pair.reserveETH = pair.reserveBase
    .times(tokenBase.derivedETH as BigDecimal)
    .plus(pair.reserveQuote.times(tokenQuote.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // update liquidity by adding reserves
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.plus(pair.reserveBase)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.plus(pair.reserveQuote)
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(pair.reserveETH)
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
  let bundle = Bundle.load('1')
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
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)
  // update deposit
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

  // update pair
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.reserveBase = tokenBaseAmount
  pair.reserveQuote = tokenQuoteAmount
  pair.reserveETH = depositAmountETH
  pair.reserveUSD = depositAmountETH.times(bundle.ethPrice)
  updatePair(pair)

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
  let pair = Pair.load(event.address.toHex())
  let factory = Factory.load(FACTORY_ADDRESS)
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenBaseAmount = convertTokenToDecimal(event.params.amountBase, tokenBase.decimals)
  let tokenQuoteAmount = convertTokenToDecimal(event.params.amountQuote, tokenQuote.decimals)
  let withdrawals = transaction.withdrawals
  // update tokens
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)
  tokenBase.totalLiquidity = tokenBase.totalLiquidity.minus(pair.reserveBase)
  tokenQuote.totalLiquidity = tokenQuote.totalLiquidity.minus(pair.reserveQuote)
  tokenBase.derivedETH = findEthPerToken(tokenBase)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote)
  // update factory
  factory.txCount = factory.txCount.plus(ONE_BI)
  let withdrawAmountETH = tokenQuote.derivedETH.times(pair.reserveQuote).plus(tokenBase.derivedETH.times(pair.reserveBase))
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(withdrawAmountETH)
  let bundle = Bundle.load('1')
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)
  // update withdraw
  let withdraw: WithdrawEvent = new WithdrawEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(withdrawals.length).toString())
  )
  withdraw.transaction = transaction.id
  withdraw.timestamp = transaction.timestamp
  withdraw.pair = event.address.toHexString()
  withdraw.sender = event.params.sender
  withdraw.amountBase = tokenBaseAmount
  withdraw.amountQuote = tokenQuoteAmount
  withdraw.to = event.params.to
  withdraw.logIndex = event.logIndex
  withdraw.amountUSD = withdrawAmountETH.times(bundle.ethPrice)
  transaction.withdrawals = withdrawals.concat([withdraw.id])

  // create users
  createUser(event.params.sender)
  createUser(event.params.to)

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, withdraw.to as Address)
  createLiquiditySnapshot(liquidityPosition, event)
  withdraw.save()

  // update pair
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.reserveBase = ZERO_BD
  pair.reserveQuote = ZERO_BD
  pair.reserveETH = ZERO_BD
  pair.reserveUSD = ZERO_BD
  pair.tokenBasePrice = ZERO_BD
  pair.tokenQuotePrice = ZERO_BD
  pair.closedAtTimestamp = event.block.timestamp
  pair.closedAtBlockNumber = event.block.number

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

export function handleWithdrawFees(event: WithdrawFees): void {
  let bundle = Bundle.load('1')
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
  let pair = Pair.load(event.address.toHex())
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)
  let tokenBaseAmount = convertTokenToDecimal(event.params.amountBase, tokenBase.decimals)
  let tokenQuoteAmount = convertTokenToDecimal(event.params.amountQuote, tokenQuote.decimals)
  let withdrawals = transaction.feeWithdrawals
  // update tokens
  tokenBase.txCount = tokenBase.txCount.plus(ONE_BI)
  tokenQuote.txCount = tokenQuote.txCount.plus(ONE_BI)
  tokenBase.derivedETH = findEthPerToken(tokenBase)
  tokenQuote.derivedETH = findEthPerToken(tokenQuote)
  let withdrawAmountETH = tokenQuote.derivedETH.times(tokenQuoteAmount).plus(tokenBase.derivedETH.times(tokenBaseAmount))
  let withdraw: WithdrawFeesEvent = new WithdrawFeesEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(withdrawals.length).toString())
  )
  withdraw.transaction = transaction.id
  withdraw.timestamp = transaction.timestamp
  withdraw.pair = event.address.toHexString()
  withdraw.sender = event.params.sender
  withdraw.amountBase = tokenBaseAmount
  withdraw.amountQuote = tokenQuoteAmount
  withdraw.to = event.params.to
  withdraw.logIndex = event.logIndex
  withdraw.amountUSD = withdrawAmountETH.times(bundle.ethPrice)
  transaction.withdrawals = withdrawals.concat([withdraw.id])

  // create users
  createUser(event.params.sender)
  createUser(event.params.to)
  withdraw.save()
}

