import {CipherscanAPI} from 'dok-wallet-blockchain-networks/config/cipherscan';

const toParsedTransaction = (tx, walletAddress) => {
  const isOutgoing = Number(tx?.inputValue) > 0 || Number(tx?.netChange) < 0;
  return {
    hash: tx?.txid,
    timestamp: tx?.blockTime ? new Date(Number(tx.blockTime) * 1000) : null,
    status: Number(tx?.blockHeight) > 0,
    amount: Math.abs(Number(tx?.netChange ?? tx?.outputValue ?? 0)).toString(),
    from: isOutgoing ? walletAddress : null,
    to: isOutgoing ? null : walletAddress,
    blockNumber: tx?.blockHeight ? Number(tx.blockHeight) : null,
    confirmations: null,
  };
};

export const Cipherscan = {
  getBalance: async ({address}) => {
    const resp = await CipherscanAPI.get(`/address/${address}`);
    return String(resp?.data?.balance ?? 0);
  },

  getTransactions: async ({address}) => {
    const resp = await CipherscanAPI.get(`/address/${address}`, {
      params: {limit: 25},
    });
    const transactions = Array.isArray(resp?.data?.transactions)
      ? resp.data.transactions
      : [];
    return transactions
      .map(tx => toParsedTransaction(tx, address))
      .sort(
        (a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0),
      );
  },

  // Cipherscan has no dedicated UTXO endpoint: per-tx detail (`/tx/:txid`)
  // returns each output's `spent` flag, so a UTXO set is built by listing the
  // address's transactions, then checking each one's outputs for an unspent
  // match. Fine for a handful of transactions; a very active address would
  // need real pagination through the address endpoint too (only its first
  // page is fetched here).
  getUTXO: async ({address}) => {
    const resp = await CipherscanAPI.get(`/address/${address}`, {
      params: {limit: 100},
    });
    const transactions = Array.isArray(resp?.data?.transactions)
      ? resp.data.transactions
      : [];
    const details = await Promise.all(
      transactions.map(tx =>
        CipherscanAPI.get(`/tx/${tx.txid}`).then(
          r => r?.data,
          () => null,
        ),
      ),
    );
    const utxos = [];
    details.forEach(detail => {
      const outputs = Array.isArray(detail?.outputs) ? detail.outputs : [];
      outputs.forEach(output => {
        if (output?.address === address && output?.spent === false) {
          utxos.push({
            hash: detail.txid,
            value: Number(output.value),
            vout: output.vout_index,
          });
        }
      });
    });
    return utxos;
  },

  getTransaction: async ({transactionId, address}) => {
    const resp = await CipherscanAPI.get(`/tx/${transactionId}`);
    const tx = resp?.data;
    if (!tx) return null;
    const inputs = Array.isArray(tx.inputs) ? tx.inputs : [];
    const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
    // An output paying our own address is only the recipient when we didn't
    // also sign an input -- otherwise it's the change from our own spend, so
    // direction has to be decided from the inputs, not just an output match.
    const isOutgoing = address
      ? inputs.some(i => i?.address === address)
      : false;
    const externalOutput = outputs.find(o => o?.address !== address);
    const ourOutput = outputs.find(o => o?.address === address);
    return {
      hash: tx.txid,
      timestamp: tx.blockTime ? new Date(Number(tx.blockTime) * 1000) : null,
      status: tx.status === 'confirmed' || Number(tx.confirmations) > 0,
      amount: isOutgoing
        ? String(externalOutput?.value ?? tx.totalOutputZat ?? 0)
        : String(ourOutput?.value ?? tx.totalOutputZat ?? 0),
      from: isOutgoing ? address : inputs[0]?.address ?? null,
      to: isOutgoing ? externalOutput?.address ?? null : address ?? null,
      blockNumber: tx.blockHeight ? Number(tx.blockHeight) : null,
      confirmations: tx.confirmations ?? null,
    };
  },

  // `txid` field name confirmed against a live broadcast rejection (Cipherscan
  // returns HTTP 400 + {success:false, error:"..."} for a rejected tx, which
  // axios throws for -- caught below and re-thrown with that reason attached,
  // since the caller otherwise has no way to know why the network rejected
  // the transaction).
  createTransaction: async ({txHex}) => {
    try {
      const resp = await CipherscanAPI.post('/tx/broadcast', {rawTx: txHex});
      const txid = resp?.data?.txid;
      if (!txid) {
        throw new Error(
          resp?.data?.error || 'Broadcast succeeded but no txid was returned',
        );
      }
      return txid;
    } catch (e) {
      const reason = e?.response?.data?.error || e?.message;
      throw new Error(
        `Failed to broadcast zcash transaction${reason ? `: ${reason}` : ''}`,
      );
    }
  },
};
