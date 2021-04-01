/* eslint-disable prefer-const */
import { Bundle, Token, UniswapPair } from './../types/schema'
import { Sync } from '../types/templates/UniswapPair/UniswapPair'
import {
  createTokensFromUniswapPair,
  convertTokenToDecimal,
  ZERO_BD,
  ZERO_BI,
} from './helpers'
import { getEthPriceInUSD, findEthPerToken } from './pricing'

export function handleSync(event: Sync): void {
  let address: string = event.address.toHexString()
  let tokens = createTokensFromUniswapPair(address)

  if (tokens[0] !== null && tokens[1] !== null) {
    let uniPair = UniswapPair.load(address)
    if (uniPair === null) {
      uniPair = new UniswapPair(address) as UniswapPair
      uniPair.token0 = tokens[0]
      uniPair.token1 = tokens[1]
      uniPair.reserve0 = ZERO_BD
      uniPair.reserve1 = ZERO_BD
      uniPair.token0Price = ZERO_BD
      uniPair.token1Price = ZERO_BD
    }
    let token0 = Token.load(tokens[0])
    let token1 = Token.load(tokens[1])
    uniPair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
    uniPair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)
    if (uniPair.reserve1.notEqual(ZERO_BD)) uniPair.token0Price = uniPair.reserve0.div(uniPair.reserve1)
    else uniPair.token0Price = ZERO_BD
    if (uniPair.reserve0.notEqual(ZERO_BD)) uniPair.token1Price = uniPair.reserve1.div(uniPair.reserve0)
    else uniPair.token1Price = ZERO_BD
      // update ETH price now that reserves could have changed
    // create new bundle
    let bundle = Bundle.load('1')
    if (bundle === null)
      bundle = new Bundle('1')
    bundle.ethPrice = getEthPriceInUSD()
    token0.derivedETH = findEthPerToken(token0 as Token)
    token1.derivedETH = findEthPerToken(token1 as Token)
    token0.save()
    token1.save()
    bundle.save()
    uniPair.save()
  }
}