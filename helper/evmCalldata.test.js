import {ethers} from 'ethers';
import {
  decodeBatchExecuteCalls,
  decodeEvmCalldata,
} from 'dok-wallet-blockchain-networks/helper/evmCalldata';
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

describe('decodeBatchExecuteCalls', () => {
  const batch = new ethers.Interface([
    'function execute((address to,uint256 value,bytes data)[] calls)',
  ]);
  const transfer = new ethers.Interface(erc20Abi).encodeFunctionData(
    'transfer',
    [TO, 5n],
  );

  it('returns every call of an execute transaction', () => {
    const data = batch.encodeFunctionData('execute', [
      [
        {to: TO, value: 7n, data: '0x'},
        {to: FROM, value: 0n, data: transfer},
      ],
    ]);
    expect(decodeBatchExecuteCalls(data)).toEqual([
      {to: ethers.getAddress(TO), value: '7', data: '0x'},
      {to: ethers.getAddress(FROM), value: '0', data: transfer},
    ]);
  });

  it.each([
    [
      'sponsored execute(calls, fee, signature)',
      'execute((address,uint256,bytes)[],(address,address,uint256,uint256,uint256,uint256,uint16,uint256),bytes)',
      calls => [calls, [TO, TO, 0n, 0n, 0n, 0n, 0, 0n], '0x'],
    ],
    [
      'legacy executeSponsored(batch, signature, feeRecipient)',
      'executeSponsored(((address,uint256,bytes)[],uint256,address,address,uint256,uint256,uint256),bytes,address)',
      calls => [[calls, 0n, TO, TO, 0n, 0n, 0n], '0x', TO],
    ],
    [
      'legacy 7-arg execute(feeToken, feeRecipient, feeAmount, calls, ...)',
      'execute(address,address,uint256,(address,uint256,bytes)[],uint256,uint256,bytes)',
      calls => [TO, TO, 0n, calls, 0n, 0n, '0x'],
    ],
  ])('returns the calls of a %s', (_label, signature, args) => {
    const sponsored = new ethers.Interface([`function ${signature}`]);
    const data = sponsored.encodeFunctionData(
      signature.slice(0, signature.indexOf('(')),
      args([[TO, 7n, '0x']]),
    );
    expect(decodeBatchExecuteCalls(data)).toEqual([
      {to: ethers.getAddress(TO), value: '7', data: '0x'},
    ]);
  });

  it('returns no calls for other calldata', () => {
    expect(decodeBatchExecuteCalls(transfer)).toEqual([]);
    expect(decodeBatchExecuteCalls('0x')).toEqual([]);
    expect(decodeBatchExecuteCalls(undefined)).toEqual([]);
  });
});
