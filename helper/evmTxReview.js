/**
 * Review of a WalletConnect eth_sendTransaction / eth_signTransaction request.
 *
 * Pure and platform-free; unit-tested in node. Three jobs:
 *  - buildEvmWalletConnectTx: the ONE canonical, allow-listed transaction
 *    object. The approval UI renders it, the thunk re-derives it from the store
 *    and compares digests, and the EVM signer signs exactly it (KIML-002).
 *  - classifyEvmTxRisk: what the user must be warned about (unlimited
 *    approvals, operator grants, opaque calldata, contract creation).
 *  - reviewEvmWalletConnectTx: the two above plus the decoded calldata, never
 *    throwing so the modal can always render something and refuse approval.
 */
import {ethers} from 'ethers';
import {decodeEvmCalldata, UNDECODABLE_CALLDATA_WARNING} from './evmCalldata';

export class EvmWalletConnectTxError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'EvmWalletConnectTxError';
    this.field = field;
  }
}

const fail = (message, field) => {
  throw new EvmWalletConnectTxError(message, field);
};

/** 'eip155:137' | '0x89' | '137' | 137 | 137n -> 137; anything else -> null */
export const parseEip155ChainId = chainId => {
  if (chainId == null || chainId === '') {
    return null;
  }
  let raw = chainId;
  if (typeof raw === 'string') {
    if (raw.includes(':')) {
      const [namespace, reference] = raw.split(':');
      if (namespace !== 'eip155' || !reference) {
        return null;
      }
      raw = reference;
    }
  }
  try {
    const value = BigInt(raw);
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  } catch (e) {
    return null;
  }
};

const toQuantity = (raw, field, {required = false} = {}) => {
  if (raw == null || raw === '') {
    if (required) {
      fail(`Missing ${field}`, field);
    }
    return undefined;
  }
  try {
    const value =
      typeof raw === 'bigint'
        ? raw
        : typeof raw === 'number'
        ? BigInt(raw)
        : BigInt(String(raw).trim());
    if (value < 0n) {
      fail(`Negative ${field}`, field);
    }
    return ethers.toQuantity(value);
  } catch (e) {
    if (e instanceof EvmWalletConnectTxError) {
      throw e;
    }
    return fail(`Invalid ${field}`, field);
  }
};

const toAddress = (raw, field) => {
  try {
    return ethers.getAddress(String(raw)).toLowerCase();
  } catch (e) {
    return fail(`Invalid ${field} address`, field);
  }
};

const toData = raw => {
  if (raw == null || raw === '' || raw === '0x' || raw === '0x0') {
    return '0x';
  }
  if (typeof raw !== 'string' || !ethers.isHexString(raw)) {
    fail('Invalid data: not hex calldata', 'data');
  }
  return raw.toLowerCase();
};

const SUPPORTED_TYPES = new Set([0, 1, 2]);

/**
 * Canonical allow-listed transaction. Everything the dApp sent that is not in
 * the allow-list is dropped; everything kept is normalised so the same request
 * always yields the same digest.
 */
export const buildEvmWalletConnectTx = (params0, {chainId} = {}) => {
  const p = params0 && typeof params0 === 'object' ? params0 : {};
  const sessionChainId = parseEip155ChainId(chainId);
  if (sessionChainId == null) {
    fail('Invalid chainId: not an eip155 chain', 'chainId');
  }
  if (p.chainId != null) {
    const requested = parseEip155ChainId(p.chainId);
    if (requested !== sessionChainId) {
      fail(
        `Request chainId ${String(
          p.chainId,
        )} does not match session chain ${sessionChainId}`,
        'chainId',
      );
    }
  }
  if (
    p.authorizationList != null ||
    p.blobVersionedHashes != null ||
    p.blobs != null
  ) {
    fail('Unsupported transaction type', 'type');
  }
  let type;
  if (p.type != null && p.type !== '') {
    try {
      type = Number(BigInt(String(p.type)));
    } catch (e) {
      fail('Invalid transaction type', 'type');
    }
    if (!SUPPORTED_TYPES.has(type)) {
      fail('Unsupported transaction type', 'type');
    }
  }

  if (p.from == null || p.from === '') {
    fail('Missing from address', 'from');
  }
  const tx = {
    from: toAddress(p.from, 'from'),
    to: p.to == null || p.to === '' ? null : toAddress(p.to, 'to'),
    data: toData(p.data),
    value: toQuantity(p.value, 'value') ?? '0x0',
  };
  const nonce = toQuantity(p.nonce, 'nonce');
  const gasLimit = toQuantity(p.gas ?? p.gasLimit, 'gas');
  const maxFeePerGas = toQuantity(p.maxFeePerGas, 'maxFeePerGas');
  const maxPriorityFeePerGas = toQuantity(
    p.maxPriorityFeePerGas,
    'maxPriorityFeePerGas',
  );
  // ethers refuses a type-2 tx that also carries gasPrice; 1559 fields win.
  const gasPrice =
    maxFeePerGas === undefined ? toQuantity(p.gasPrice, 'gasPrice') : undefined;

  if (nonce !== undefined) {
    tx.nonce = nonce;
  }
  if (gasLimit !== undefined) {
    tx.gasLimit = gasLimit;
  }
  if (gasPrice !== undefined) {
    tx.gasPrice = gasPrice;
  }
  if (maxFeePerGas !== undefined) {
    tx.maxFeePerGas = maxFeePerGas;
  }
  if (maxPriorityFeePerGas !== undefined) {
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
  }
  if (type !== undefined) {
    tx.type = type;
  }
  tx.chainId = sessionChainId;
  return tx;
};

/** keccak256 of the canonical JSON (sorted keys). Never throws on partial txs. */
export const getEvmWalletConnectTxDigest = tx =>
  ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(tx, Object.keys(tx || {}).sort())),
  );

/** Shape ethers' populateTransaction / signTransaction accept. */
export const toEthersTransactionRequest = tx => ({
  from: tx.from,
  to: tx.to ?? undefined,
  data: tx.data,
  value: tx.value,
  nonce: tx.nonce,
  gasLimit: tx.gasLimit,
  gasPrice: tx.gasPrice,
  maxFeePerGas: tx.maxFeePerGas,
  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  type: tx.type,
  chainId: tx.chainId,
});

/** gasLimit * (gasPrice ?? maxFeePerGas) in wei, or null when not knowable. */
export const getEvmTxMaxFeeWei = tx => {
  const limit = tx?.gasLimit;
  const price = tx?.gasPrice ?? tx?.maxFeePerGas;
  if (limit == null || price == null) {
    return null;
  }
  try {
    return BigInt(limit) * BigInt(price);
  } catch (e) {
    return null;
  }
};

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};
const VERY_LARGE_ALLOWANCE = 2n ** 128n;
const APPROVAL_TRANSFER_METHODS = new Set([
  'transferFrom',
  'safeTransferFrom',
  'safeBatchTransferFrom',
]);

const arg = (args, ...names) => {
  for (const name of names) {
    if (args?.[name] !== undefined) {
      return args[name];
    }
  }
  return undefined;
};

const describeAllowance = value => {
  if (value === ethers.MaxUint256) {
    return 'Unlimited';
  }
  if (value >= VERY_LARGE_ALLOWANCE) {
    return `${value} (very large)`;
  }
  return value.toString();
};

/**
 * @returns {{level:'none'|'warn'|'danger', kind:string, reasons:string[], rows:{label:string,value:string}[]}}
 */
export const classifyEvmTxRisk = ({tx, decoded}) => {
  const result = {level: 'none', kind: 'contractCall', reasons: [], rows: []};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason) {
      result.reasons.push(reason);
    }
  };
  const args = decoded?.args || {};

  if (tx?.to == null) {
    result.kind = 'contractCreation';
    raise('danger', 'This transaction deploys a new contract.');
  } else if (!decoded || decoded.kind === 'empty') {
    result.kind = 'nativeTransfer';
  } else if (decoded.kind === 'unknown') {
    result.kind = 'unknown';
    raise('danger', UNDECODABLE_CALLDATA_WARNING);
    if (decoded.selector) {
      result.rows.push({label: 'Selector', value: decoded.selector});
    }
  } else if (decoded.method === 'approve') {
    // ERC-20 and ERC-721 share this selector; the decoder labels it ERC-20.
    const spender = arg(args, '_spender', 'to');
    const amount = BigInt(arg(args, '_value', 'tokenId') ?? 0);
    if (amount === 0n) {
      result.kind = 'revoke';
      result.rows.push({label: 'Spender', value: String(spender)});
    } else {
      result.kind = 'approve';
      result.rows.push({label: 'Spender', value: String(spender)});
      result.rows.push({
        label: 'Amount / Token ID',
        value: describeAllowance(amount),
      });
      if (amount >= VERY_LARGE_ALLOWANCE) {
        raise(
          'danger',
          `Gives ${spender} unlimited access to this token. It can move your entire balance at any time.`,
        );
      } else {
        raise(
          'warn',
          `Lets ${spender} spend this amount of the token, or transfer this NFT, on your behalf.`,
        );
      }
    }
  } else if (decoded.method === 'setApprovalForAll') {
    const operator = arg(args, 'operator');
    const approved = arg(args, '_approved', 'approved');
    result.rows.push({label: 'Operator', value: String(operator)});
    if (approved === true || approved === 'true') {
      result.kind = 'approveForAll';
      raise(
        'danger',
        `Gives ${operator} control over every token you own in this collection.`,
      );
    } else {
      result.kind = 'revoke';
    }
  } else if (APPROVAL_TRANSFER_METHODS.has(decoded.method)) {
    result.kind = 'tokenTransfer';
    const from = arg(args, '_from', 'from');
    const to = arg(args, '_to', 'to');
    result.rows.push({label: 'From', value: String(from)});
    result.rows.push({label: 'To', value: String(to)});
    const id = arg(args, 'tokenId', 'id', 'ids');
    const amount = arg(args, '_value', 'amount', 'amounts');
    if (id !== undefined) {
      result.rows.push({label: 'Token ID', value: String(id)});
    }
    if (amount !== undefined) {
      result.rows.push({
        label: id !== undefined ? 'Amount' : 'Amount / Token ID',
        value: String(amount),
      });
    }
    raise('warn', 'Moves tokens out of an account using an existing approval.');
  } else if (decoded.method === 'transfer') {
    result.kind = 'erc20Transfer';
    result.rows.push({label: 'To', value: String(arg(args, '_to', 'to'))});
    result.rows.push({label: 'Amount', value: String(arg(args, '_value'))});
  }

  let value = 0n;
  try {
    value = BigInt(tx?.value ?? 0);
  } catch (e) {
    value = 0n;
  }
  if (value > 0n && tx?.data && tx.data !== '0x') {
    raise('warn', 'Also sends native value to the contract.');
  }
  return result;
};

/**
 * Everything the approval modal needs. Never throws: a malformed request comes
 * back as {tx:null, error, risk:{level:'danger', kind:'malformed'}} so the UI
 * can show why and keep Approve disabled.
 */
export const reviewEvmWalletConnectTx = (params0, {chainId} = {}) => {
  try {
    const tx = buildEvmWalletConnectTx(params0, {chainId});
    const decoded = decodeEvmCalldata(tx.data);
    return {
      tx,
      digest: getEvmWalletConnectTxDigest(tx),
      decoded,
      risk: classifyEvmTxRisk({tx, decoded}),
      error: null,
    };
  } catch (e) {
    const error =
      e instanceof EvmWalletConnectTxError
        ? e
        : new EvmWalletConnectTxError(e?.message || 'Invalid transaction');
    return {
      tx: null,
      digest: null,
      decoded: null,
      error,
      risk: {
        level: 'danger',
        kind: 'malformed',
        reasons: [error.message],
        rows: [],
      },
    };
  }
};
