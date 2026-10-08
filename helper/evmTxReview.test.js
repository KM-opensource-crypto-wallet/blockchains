import {ethers} from 'ethers';
import {
  buildEvmWalletConnectTx,
  classifyEvmTxRisk,
  EvmWalletConnectTxError,
  getEvmTxMaxFeeWei,
  getEvmWalletConnectTxDigest,
  parseEip155ChainId,
  reviewEvmWalletConnectTx,
  toEthersTransactionRequest,
} from 'dok-wallet-blockchain-networks/helper/evmTxReview';
import {decodeEvmCalldata} from 'dok-wallet-blockchain-networks/helper/evmCalldata';
import erc20Abi from 'dok-wallet-blockchain-networks/abis/erc20.json';
import erc721Abi from 'dok-wallet-blockchain-networks/abis/erc721.json';
import erc1155Abi from 'dok-wallet-blockchain-networks/abis/erc1155.json';

const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x3333333333333333333333333333333333333333';
const CHAIN = 'eip155:137';

const erc20 = new ethers.Interface(erc20Abi);
const erc721 = new ethers.Interface(erc721Abi);
const erc1155 = new ethers.Interface(erc1155Abi);

const baseParams = overrides => ({from: FROM, to: TO, ...overrides});

const classify = (params0, chainId = CHAIN) => {
  const tx = buildEvmWalletConnectTx(params0, {chainId});
  return classifyEvmTxRisk({tx, decoded: decodeEvmCalldata(tx.data)});
};

describe('parseEip155ChainId', () => {
  it('accepts CAIP-2, hex, decimal string, number and bigint forms', () => {
    expect(parseEip155ChainId('eip155:1')).toBe(1);
    expect(parseEip155ChainId('0x89')).toBe(137);
    expect(parseEip155ChainId('137')).toBe(137);
    expect(parseEip155ChainId(137)).toBe(137);
    expect(parseEip155ChainId(137n)).toBe(137);
  });

  it('returns null for non-EVM or malformed ids', () => {
    expect(parseEip155ChainId('solana:mainnet')).toBeNull();
    expect(parseEip155ChainId('eip155:')).toBeNull();
    expect(parseEip155ChainId(undefined)).toBeNull();
    expect(parseEip155ChainId('')).toBeNull();
  });
});

describe('buildEvmWalletConnectTx', () => {
  it('keeps only allow-listed fields and maps gas to gasLimit', () => {
    const tx = buildEvmWalletConnectTx(
      baseParams({
        gas: '0x5208',
        gasPrice: '0x3b9aca00',
        accessList: [],
        foo: 'bar',
      }),
      {chainId: CHAIN},
    );
    expect(tx).toEqual({
      from: FROM,
      to: TO,
      data: '0x',
      value: '0x0',
      gasLimit: '0x5208',
      gasPrice: '0x3b9aca00',
      chainId: 137,
    });
  });

  it('normalises hex, decimal-string and number quantities to the same form', () => {
    const hex = buildEvmWalletConnectTx(
      baseParams({value: '0x0a', gas: '0x5208', nonce: '0x1'}),
      {chainId: CHAIN},
    );
    const dec = buildEvmWalletConnectTx(
      baseParams({value: '10', gas: 21000, nonce: 1}),
      {chainId: CHAIN},
    );
    expect(hex).toEqual(dec);
    expect(hex.value).toBe('0xa');
  });

  it('checksums and lowercases addresses', () => {
    const tx = buildEvmWalletConnectTx(
      {from: FROM.toUpperCase().replace('0X', '0x'), to: TO},
      {chainId: CHAIN},
    );
    expect(tx.from).toBe(FROM);
  });

  it('throws a typed error naming the field for a missing or invalid from', () => {
    expect(() => buildEvmWalletConnectTx({to: TO}, {chainId: CHAIN})).toThrow(
      EvmWalletConnectTxError,
    );
    try {
      buildEvmWalletConnectTx({from: 'nope', to: TO}, {chainId: CHAIN});
    } catch (e) {
      expect(e.field).toBe('from');
    }
  });

  it('throws on non-hex calldata and unparsable quantities', () => {
    expect(() =>
      buildEvmWalletConnectTx(baseParams({data: 'not hex'}), {chainId: CHAIN}),
    ).toThrow(/data/);
    expect(() =>
      buildEvmWalletConnectTx(baseParams({value: 'abc'}), {chainId: CHAIN}),
    ).toThrow(/value/);
  });

  it('treats an absent to as contract creation (null)', () => {
    const tx = buildEvmWalletConnectTx(
      {from: FROM, data: '0x6080'},
      {chainId: CHAIN},
    );
    expect(tx.to).toBeNull();
    expect(tx.data).toBe('0x6080');
  });

  it('drops gasPrice when EIP-1559 fees are present', () => {
    const tx = buildEvmWalletConnectTx(
      baseParams({
        gasPrice: '0x1',
        maxFeePerGas: '0x2',
        maxPriorityFeePerGas: '0x1',
      }),
      {chainId: CHAIN},
    );
    expect(tx.gasPrice).toBeUndefined();
    expect(tx.maxFeePerGas).toBe('0x2');
    expect(tx.maxPriorityFeePerGas).toBe('0x1');
  });

  it('refuses blob and set-code transaction types instead of silently dropping their lists', () => {
    expect(() =>
      buildEvmWalletConnectTx(
        baseParams({type: '0x4', authorizationList: []}),
        {chainId: CHAIN},
      ),
    ).toThrow(/Unsupported transaction type/);
    expect(() =>
      buildEvmWalletConnectTx(baseParams({authorizationList: [{}]}), {
        chainId: CHAIN,
      }),
    ).toThrow(/Unsupported transaction type/);
    expect(() =>
      buildEvmWalletConnectTx(baseParams({blobVersionedHashes: ['0x01']}), {
        chainId: CHAIN,
      }),
    ).toThrow(/Unsupported transaction type/);
    expect(
      buildEvmWalletConnectTx(baseParams({type: '0x2'}), {chainId: CHAIN}).type,
    ).toBe(2);
  });

  it('rejects a malformed type with a typed error instead of a raw BigInt SyntaxError', () => {
    for (const type of ['abc', '1.5', '0x', {}]) {
      let caught;
      try {
        buildEvmWalletConnectTx(baseParams({type}), {chainId: CHAIN});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EvmWalletConnectTxError);
      expect(caught.field).toBe('type');
      expect(caught.message).toBe('Invalid transaction type');
    }
  });

  it('throws when the request chainId disagrees with the session chain', () => {
    expect(() =>
      buildEvmWalletConnectTx(baseParams({chainId: '0x1'}), {chainId: CHAIN}),
    ).toThrow(/chainId/);
    expect(
      buildEvmWalletConnectTx(baseParams({chainId: '0x89'}), {chainId: CHAIN})
        .chainId,
    ).toBe(137);
    expect(() =>
      buildEvmWalletConnectTx(baseParams(), {chainId: 'solana:x'}),
    ).toThrow(/chainId/);
  });
});

describe('getEvmWalletConnectTxDigest', () => {
  it('is stable across key order and quantity spelling', () => {
    const a = buildEvmWalletConnectTx(
      {from: FROM, to: TO, value: '0x0a'},
      {chainId: CHAIN},
    );
    const b = buildEvmWalletConnectTx(
      {value: '10', to: TO, from: FROM},
      {chainId: CHAIN},
    );
    expect(getEvmWalletConnectTxDigest(a)).toBe(getEvmWalletConnectTxDigest(b));
    expect(getEvmWalletConnectTxDigest(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when to or data changes', () => {
    const base = buildEvmWalletConnectTx(baseParams({data: '0x01'}), {
      chainId: CHAIN,
    });
    const otherTo = buildEvmWalletConnectTx(
      baseParams({to: TO.slice(0, -1) + '2', data: '0x01'}),
      {chainId: CHAIN},
    );
    const otherData = buildEvmWalletConnectTx(baseParams({data: '0x02'}), {
      chainId: CHAIN,
    });
    expect(getEvmWalletConnectTxDigest(otherTo)).not.toBe(
      getEvmWalletConnectTxDigest(base),
    );
    expect(getEvmWalletConnectTxDigest(otherData)).not.toBe(
      getEvmWalletConnectTxDigest(base),
    );
  });

  it('works when nonce and gas are absent', () => {
    const tx = buildEvmWalletConnectTx(baseParams(), {chainId: CHAIN});
    expect(() => getEvmWalletConnectTxDigest(tx)).not.toThrow();
  });
});

describe('toEthersTransactionRequest', () => {
  it('maps a null to to undefined and carries every signed field', () => {
    const tx = buildEvmWalletConnectTx(
      {
        from: FROM,
        data: '0x60',
        maxFeePerGas: '0x2',
        maxPriorityFeePerGas: '0x1',
        type: 2,
        gas: '0x5208',
        nonce: 3,
      },
      {chainId: CHAIN},
    );
    expect(toEthersTransactionRequest(tx)).toEqual({
      from: FROM,
      to: undefined,
      data: '0x60',
      value: '0x0',
      nonce: '0x3',
      gasLimit: '0x5208',
      maxFeePerGas: '0x2',
      maxPriorityFeePerGas: '0x1',
      type: 2,
      chainId: 137,
    });
  });
});

describe('getEvmTxMaxFeeWei', () => {
  it('multiplies gasLimit by gasPrice or maxFeePerGas and is null without a limit', () => {
    expect(getEvmTxMaxFeeWei({gasLimit: '0x5208', gasPrice: '0x2'})).toBe(
      42000n,
    );
    expect(getEvmTxMaxFeeWei({gasLimit: '0x5208', maxFeePerGas: '0x3'})).toBe(
      63000n,
    );
    expect(getEvmTxMaxFeeWei({gasPrice: '0x2'})).toBeNull();
    expect(getEvmTxMaxFeeWei({gasLimit: '0x5208'})).toBeNull();
  });
});

describe('classifyEvmTxRisk', () => {
  it('treats a plain native transfer as safe with no rows', () => {
    const risk = classify(baseParams({value: '0x1'}));
    expect(risk).toEqual({
      level: 'none',
      kind: 'nativeTransfer',
      reasons: [],
      rows: [],
    });
  });

  it('flags an unlimited ERC-20 approval as danger with an Unlimited row', () => {
    const data = erc20.encodeFunctionData('approve', [
      SPENDER,
      ethers.MaxUint256,
    ]);
    const risk = classify(baseParams({data}));
    expect(risk.level).toBe('danger');
    expect(risk.kind).toBe('approve');
    expect(risk.rows).toEqual([
      {label: 'Spender', value: SPENDER},
      {label: 'Amount / Token ID', value: 'Unlimited'},
    ]);
    expect(risk.reasons[0]).toMatch(/unlimited/i);
  });

  it('flags a very large approval as danger too', () => {
    const data = erc20.encodeFunctionData('approve', [SPENDER, 2n ** 130n]);
    const risk = classify(baseParams({data}));
    expect(risk.level).toBe('danger');
    expect(risk.rows[1].value).toMatch(/very large/);
  });

  it('warns on a bounded approval, which may be an ERC-721 token approval', () => {
    const data = erc721.encodeFunctionData('approve', [SPENDER, 100n]);
    const risk = classify(baseParams({data}));
    expect(risk.level).toBe('warn');
    expect(risk.kind).toBe('approve');
    expect(risk.rows).toEqual([
      {label: 'Spender', value: SPENDER},
      {label: 'Amount / Token ID', value: '100'},
    ]);
  });

  it('treats a zero approval as a revoke', () => {
    const data = erc20.encodeFunctionData('approve', [SPENDER, 0n]);
    const risk = classify(baseParams({data}));
    expect(risk.level).toBe('none');
    expect(risk.kind).toBe('revoke');
  });

  it('flags setApprovalForAll(true) as danger and (false) as a revoke', () => {
    const grant = erc721.encodeFunctionData('setApprovalForAll', [
      SPENDER,
      true,
    ]);
    const revoke = erc1155.encodeFunctionData('setApprovalForAll', [
      SPENDER,
      false,
    ]);
    const granted = classify(baseParams({data: grant}));
    expect(granted.level).toBe('danger');
    expect(granted.kind).toBe('approveForAll');
    expect(granted.rows).toEqual([{label: 'Operator', value: SPENDER}]);
    const revoked = classify(baseParams({data: revoke}));
    expect(revoked.level).toBe('none');
    expect(revoked.kind).toBe('revoke');
  });

  it('flags an unknown selector as danger with the selector row', () => {
    const risk = classify(baseParams({data: '0xdeadbeef0000'}));
    expect(risk.level).toBe('danger');
    expect(risk.kind).toBe('unknown');
    expect(risk.rows).toEqual([{label: 'Selector', value: '0xdeadbeef'}]);
  });

  it('flags contract creation as danger', () => {
    const risk = classify({from: FROM, data: '0x6080'});
    expect(risk.level).toBe('danger');
    expect(risk.kind).toBe('contractCreation');
  });

  it('keeps ERC-20 transfer safe and warns on transferFrom', () => {
    const transfer = erc20.encodeFunctionData('transfer', [TO, 5n]);
    const transferFrom = erc20.encodeFunctionData('transferFrom', [
      FROM,
      TO,
      5n,
    ]);
    const t = classify(baseParams({data: transfer}));
    expect(t.level).toBe('none');
    expect(t.kind).toBe('erc20Transfer');
    expect(t.rows).toEqual([
      {label: 'To', value: TO},
      {label: 'Amount', value: '5'},
    ]);
    const tf = classify(baseParams({data: transferFrom}));
    expect(tf.level).toBe('warn');
    expect(tf.kind).toBe('tokenTransfer');
  });

  it('raises a decoded call that also sends native value to at least warn', () => {
    const data = erc20.encodeFunctionData('transfer', [TO, 5n]);
    const risk = classify(baseParams({data, value: '0x1'}));
    expect(risk.level).toBe('warn');
    expect(risk.reasons).toContain('Also sends native value to the contract.');
  });
});

describe('reviewEvmWalletConnectTx', () => {
  it('returns the canonical tx, digest, decoded call and risk', () => {
    const data = erc20.encodeFunctionData('approve', [
      SPENDER,
      ethers.MaxUint256,
    ]);
    const review = reviewEvmWalletConnectTx(baseParams({data, gas: '0x5208'}), {
      chainId: CHAIN,
    });
    expect(review.error).toBeNull();
    expect(review.tx.to).toBe(TO);
    expect(review.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(review.decoded.method).toBe('approve');
    expect(review.risk.level).toBe('danger');
  });

  it('returns a malformed danger risk instead of throwing', () => {
    const review = reviewEvmWalletConnectTx(
      {to: TO, data: 'zzz'},
      {chainId: CHAIN},
    );
    expect(review.tx).toBeNull();
    expect(review.digest).toBeNull();
    expect(review.error).toBeInstanceOf(EvmWalletConnectTxError);
    expect(review.risk.level).toBe('danger');
    expect(review.risk.kind).toBe('malformed');
    expect(review.risk.reasons).toEqual([review.error.message]);
  });
});
