/* eslint-disable prefer-const */
import { log } from '@graphprotocol/graph-ts'
import { Factory, Pair, Token, Bundle, Transaction } from '../types/schema'
import { PairCreated } from '../types/Factory/Factory'
import { Pair as PairTemplate } from '../types/templates'
import {
  FACTORY_ADDRESS,
  ZERO_BD,
  ZERO_BI,
  fetchTokenSymbol,
  fetchTokenName,
  fetchTokenDecimals,
  fetchTokenTotalSupply
} from './helpers'

export function handleNewPair(event: PairCreated): void {
    // create the transaction
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.deposits = []
    transaction.swaps = []
    transaction.withdrawals = []
    transaction.feeWithdrawals = []
  }
  // load factory (create if first exchange)
  let factory = Factory.load(FACTORY_ADDRESS)
  if (factory == null) {
    factory = new Factory(FACTORY_ADDRESS)
    factory.pairCount = 0
    factory.totalVolumeETH = ZERO_BD
    factory.totalLiquidityETH = ZERO_BD
    factory.totalVolumeUSD = ZERO_BD
    factory.totalLiquidityUSD = ZERO_BD
    factory.txCount = ZERO_BI
  }
  factory.pairCount = factory.pairCount + 1

  // create the tokens
  let tokenBase = Token.load(event.params.baseToken.toHexString())
  let tokenQuote = Token.load(event.params.quoteToken.toHexString())

  // fetch info if null
  if (tokenBase == null) {
    tokenBase = new Token(event.params.baseToken.toHexString())
    tokenBase.symbol = fetchTokenSymbol(event.params.baseToken)
    tokenBase.name = fetchTokenName(event.params.baseToken)
    tokenBase.totalSupply = fetchTokenTotalSupply(event.params.baseToken)
    tokenBase.decimals = fetchTokenDecimals(event.params.baseToken)
    tokenBase.derivedETH = ZERO_BD
    tokenBase.tradeVolume = ZERO_BD
    tokenBase.tradeVolumeUSD = ZERO_BD
    tokenBase.totalLiquidity = ZERO_BD
    tokenBase.txCount = ZERO_BI
  }

  // fetch info if null
  if (tokenQuote == null) {
    tokenQuote = new Token(event.params.quoteToken.toHexString())
    tokenQuote.symbol = fetchTokenSymbol(event.params.quoteToken)
    tokenQuote.name = fetchTokenName(event.params.quoteToken)
    tokenQuote.totalSupply = fetchTokenTotalSupply(event.params.quoteToken)
    tokenQuote.decimals = fetchTokenDecimals(event.params.quoteToken)
    tokenQuote.derivedETH = ZERO_BD
    tokenQuote.tradeVolume = ZERO_BD
    tokenQuote.tradeVolumeUSD = ZERO_BD
    tokenQuote.totalLiquidity = ZERO_BD
    tokenQuote.txCount = ZERO_BI
  }

  let pair = new Pair(event.params.pair.toHexString()) as Pair
  pair.tokenBase = tokenBase.id
  pair.tokenQuote = tokenQuote.id
  pair.pairOwner = event.params.pairOwner
  pair.slopeNumerator = event.params.slopeNumerator
  pair.n = event.params.n
  pair.fee = event.params.fee

  pair.supply = ZERO_BD
  pair.createdAtTimestamp = event.block.timestamp
  pair.createdAtBlockNumber = event.block.number
  pair.txCount = ZERO_BI
  pair.reserveBase = ZERO_BD
  pair.reserveQuote = ZERO_BD
  pair.reserveETH = ZERO_BD
  pair.reserveUSD = ZERO_BD
  pair.volumeTokenBase = ZERO_BD
  pair.volumeTokenQuote = ZERO_BD
  pair.volumeUSD = ZERO_BD
  pair.tokenBasePrice = ZERO_BD
  pair.tokenQuotePrice = ZERO_BD

  // create the tracked contract based on the template
  PairTemplate.create(event.params.pair)

  // save updated values
  transaction.save()
  factory.save()
  tokenBase.save()
  tokenQuote.save()
  pair.save()
}
