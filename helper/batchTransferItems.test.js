import {ethers} from 'ethers';
import {getBatchTransferItems} from 'dok-wallet-blockchain-networks/helper';
import erc20Abi from 'dok-wallet-blockchain-networks/abis/erc20.json';

const RECIPIENT = '0xD784a906BD916ba56a13Dc40d363ab8547277279';
const TOKEN = '0x1599151c4DA820CE4a728d8A7bC9660536f34f10';
const OTHER_TOKEN = '0x4428c18216c6079105Be5537651B4FE6ec789f7e';

const batch = new ethers.Interface([
  'function execute((address to,uint256 value,bytes data)[] calls)',
]);
const erc20 = new ethers.Interface(erc20Abi);
const input = batch.encodeFunctionData('execute', [
  [
    {to: RECIPIENT, value: ethers.parseEther('0.0001'), data: '0x'},
    {
      to: TOKEN,
      value: 0n,
      data: erc20.encodeFunctionData('transfer', [RECIPIENT, 2500000n]),
    },
    {
      to: OTHER_TOKEN,
      value: 0n,
      data: erc20.encodeFunctionData('approve', [RECIPIENT, 1n]),
    },
  ],
]);

describe('getBatchTransferItems', () => {
  it('describes each call of a batch read back from the chain', () => {
    const usdc = {
      contractAddress: TOKEN.toLowerCase(),
      symbol: 'USDC',
      decimal: 6,
    };
    const items = getBatchTransferItems(input, {
      coins: [usdc],
      nativeSymbol: 'ETH',
    });

    expect(items).toEqual([
      {
        coinInfo: {name: undefined, symbol: 'ETH'},
        transferData: {amount: '0.0001', to: RECIPIENT},
      },
      {coinInfo: usdc, transferData: {amount: '2.5', to: RECIPIENT}},
      {
        coinInfo: {name: 'approve', symbol: 'ETH'},
        transferData: {amount: '0.0', to: OTHER_TOKEN},
      },
    ]);
  });

  it('returns no rows when the input is not a batch', () => {
    expect(getBatchTransferItems('0x', {nativeSymbol: 'ETH'})).toEqual([]);
  });
});
