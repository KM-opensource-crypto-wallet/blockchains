import {CHAIN_CONFIG} from 'dok-wallet-blockchain-networks/config/config';
import {EtherScan} from 'dok-wallet-blockchain-networks/service/etherScan';
import {VicScan} from 'dok-wallet-blockchain-networks/service/vicScan';
import {EthereumClassicScan} from 'dok-wallet-blockchain-networks/service/EthereumClassicScan';
import {EthereumPowScan} from 'dok-wallet-blockchain-networks/service/ethereumPowScan';
import {PolygonService} from 'dok-wallet-blockchain-networks/service/polygonService';
import {InkBlockExplorer} from 'dok-wallet-blockchain-networks/service/inkBlockExpolorer';
import {BlockScout} from 'dok-wallet-blockchain-networks/service/blockScout';

const SCAN_SERVICES = {
  etherscan: EtherScan,
  polygon: PolygonService,
  vicscan: VicScan,
  ethereum_classic: EthereumClassicScan,
  ethereum_pow: EthereumPowScan,
  ink: InkBlockExplorer,
  blockscout: BlockScout,
};

export const EvmServices = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, chainConfig]) => chainConfig.scan_service)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      SCAN_SERVICES[chainConfig.scan_service],
    ]),
);
