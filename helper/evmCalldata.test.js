import {ethers} from 'ethers';
import {decodeEvmCalldata} from 'dok-wallet-blockchain-networks/helper/evmCalldata';
import erc20Abi from 'dok-wallet-blockchain-networks/abis/erc20.json';
import erc1155Abi from 'dok-wallet-blockchain-networks/abis/erc1155.json';

const TO = '0x1111111111111111111111111111111111111111';
const FROM = '0x2222222222222222222222222222222222222222';

describe('decodeEvmCalldata', () => {
  it('treats missing or 0x data as empty', () => {
    expect(decodeEvmCalldata(undefined)).toEqual({kind: 'empty'});
    expect(decodeEvmCalldata('')).toEqual({kind: 'empty'});
    expect(decodeEvmCalldata('0x')).toEqual({kind: 'empty'});
  });

  it('decodes ERC-20 approve with named string args', () => {
    const data = new ethers.Interface(erc20Abi).encodeFunctionData('approve', [
      TO,
      ethers.MaxUint256,
    ]);
    expect(decodeEvmCalldata(data)).toEqual({
      kind: 'decoded',
      standard: 'ERC-20',
      method: 'approve',
      signature: 'approve(address,uint256)',
      args: {_spender: TO, _value: ethers.MaxUint256.toString()},
    });
  });

  it('decodes ERC-1155 batch transfers with array args', () => {
    const data = new ethers.Interface(erc1155Abi).encodeFunctionData(
      'safeBatchTransferFrom',
      [FROM, TO, [1n, 2n], [3n, 4n], '0x'],
    );
    const result = decodeEvmCalldata(data);
    expect(result.kind).toBe('decoded');
    expect(result.standard).toBe('ERC-1155');
    expect(result.method).toBe('safeBatchTransferFrom');
    expect(Object.values(result.args)).toEqual([
      FROM,
      TO,
      ['1', '2'],
      ['3', '4'],
      '0x',
    ]);
  });

  it('flags unknown selectors with the full calldata', () => {
    const data =
      '0xdeadbeef000000000000000000000000000000000000000000000000000000000000002a';
    expect(decodeEvmCalldata(data)).toEqual({
      kind: 'unknown',
      selector: '0xdeadbeef',
      data,
    });
  });

  it('flags non-hex data instead of throwing', () => {
    expect(decodeEvmCalldata('not hex')).toEqual({
      kind: 'unknown',
      data: 'not hex',
    });
  });
});
