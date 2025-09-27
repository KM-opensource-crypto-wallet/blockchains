import {EtherScan} from 'dok-wallet-blockchain-networks/service/etherScan';
import {VicScan} from 'dok-wallet-blockchain-networks/service/vicScan';
import {EthereumClassicScan} from 'dok-wallet-blockchain-networks/service/EthereumClassicScan';
import {EthereumPowScan} from 'dok-wallet-blockchain-networks/service/ethereumPowScan';
import {PolygonService} from 'dok-wallet-blockchain-networks/service/polygonService';
import {InkBlockExplorer} from 'dok-wallet-blockchain-networks/service/inkBlockExpolorer';

export const EvmServices = {
  ethereum: EtherScan,
  polygon: PolygonService,
  binance_smart_chain: EtherScan,
  base: EtherScan,
  arbitrum: EtherScan,
  optimism: EtherScan,
  optimism_binance_smart_chain: EtherScan,
  avalanche: EtherScan,
  fantom: EtherScan,
  gnosis: EtherScan,
  viction: VicScan,
  linea: EtherScan,
  zksync: EtherScan,
  ethereum_classic: EthereumClassicScan,
  ethereum_pow: EthereumPowScan,
  ink: InkBlockExplorer,
  sei: EtherScan,
};
