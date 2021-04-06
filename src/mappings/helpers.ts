/* eslint-disable prefer-const */
import { log, BigInt, BigDecimal, Address, ethereum } from '@graphprotocol/graph-ts'
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { User, Bundle, Token, LiquidityPosition, LiquidityPositionSnapshot, Pair } from '../types/schema'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const FACTORY_ADDRESS = '0xeac9260c59693f180936779451b996b303a0a488'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

export function convertEthToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BigInt.fromI32(18)))
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toString())
  const zero = parseFloat(ZERO_BD.toString())
  if (zero == formattedVal) {
    return true
  }
  return false
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let contract = ERC20.bind(tokenAddress)
  let totalSupplyValue: ethereum.CallResult<BigInt> = null
  let totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult
  }
  return BigInt.fromI32(i32(totalSupplyValue.value))
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  let contract = ERC20.bind(tokenAddress)
  // try types uint8 for decimals
  let decimalValue = null
  let decimalResult = contract.try_decimals()
  if (!decimalResult.reverted) {
    decimalValue = decimalResult.value
  }
  return BigInt.fromI32(decimalValue)
}

export function createLiquidityPosition(exchange: Address, user: Address): LiquidityPosition {
  let id = exchange
    .toHexString()
    .concat('-')
    .concat(user.toHexString())
  let liquidityTokenBalance = LiquidityPosition.load(id)
  if (liquidityTokenBalance === null) {
    liquidityTokenBalance = new LiquidityPosition(id)
    liquidityTokenBalance.pair = exchange.toHexString()
    liquidityTokenBalance.user = user.toHexString()
    liquidityTokenBalance.save()
  }
  if (liquidityTokenBalance === null) log.error('LiquidityTokenBalance is null', [id])
  return liquidityTokenBalance as LiquidityPosition
}

export function createUser(address: Address): void {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.usdSwapped = ZERO_BD
    user.save()
  }
}

export function createToken(tokenAddr: string): void {
  let token = Token.load(tokenAddr)
  if (token == null) {
    let tokenAddress = Address.fromString(tokenAddr)
    token = new Token(tokenAddr)
    token.symbol = fetchTokenSymbol(tokenAddress)
    token.name = fetchTokenName(tokenAddress)
    token.totalSupply = fetchTokenTotalSupply(tokenAddress)
    token.decimals = fetchTokenDecimals(tokenAddress)
    token.derivedETH = ZERO_BD
    token.tradeVolume = ZERO_BD
    token.tradeVolumeUSD = ZERO_BD
    token.totalLiquidity = ZERO_BD
    token.txCount = ZERO_BI
    token.save()
  }
}

export function createTokensFromUniswapPair(address: string): string[] {
  let token0Addr: string = null, token1Addr: string = null
  // USDT
  if (address == '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852') {
    token0Addr = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    token1Addr = '0xdac17f958d2ee523a2206206994597c13d831ec7'
  }
  if (token0Addr !== null && token1Addr !== null) {
    createToken(token0Addr)
    createToken(token1Addr)
    return [token0Addr, token1Addr]
  }
  return [null, null]
}

export function createLiquiditySnapshot(position: LiquidityPosition, event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let bundle = Bundle.load('1')
  let pair = Pair.load(position.pair)
  let tokenBase = Token.load(pair.tokenBase)
  let tokenQuote = Token.load(pair.tokenQuote)

  // create new snapshot
  let snapshot = new LiquidityPositionSnapshot(position.id.concat(timestamp.toString()))
  snapshot.liquidityPosition = position.id
  snapshot.timestamp = timestamp
  snapshot.block = event.block.number.toI32()
  snapshot.user = position.user
  snapshot.pair = position.pair
  snapshot.tokenBasePriceUSD = tokenBase.derivedETH.times(bundle.ethPrice)
  snapshot.tokenQuotePriceUSD = tokenQuote.derivedETH.times(bundle.ethPrice)
  snapshot.reserveBase = pair.reserveBase
  snapshot.reserveQuote = pair.reserveQuote
  snapshot.reserveUSD = pair.reserveUSD
  snapshot.liquidityPosition = position.id
  snapshot.save()
  position.save()
}
