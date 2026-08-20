// Web-only bridge to the app's /api/bitcoin route.
//
// Browsers cannot open raw TCP sockets, so the Electrum client runs on the
// Next.js server. This posts Bitcoin queries there and returns the same
// shapes the direct Electrum functions produce.
//
// Private keys never leave the browser: they are stripped from the request
// and re-attached to the response by matching address (balances) or
// txid:vout (transaction details). Electrum only needs addresses/scripthashes.

const ENDPOINT = '/api/bitcoin';

const stripKeys = payload => {
  const clone = {...payload};
  if (Array.isArray(clone.derive_addresses)) {
    clone.derive_addresses = clone.derive_addresses.map(
      ({privateKey, ...rest}) => rest,
    );
  }
  if (Array.isArray(clone.transaction_data)) {
    clone.transaction_data = clone.transaction_data.map(
      ({privateKey, ...rest}) => rest,
    );
  }
  return clone;
};

const keyByAddress = list => {
  const map = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (item?.address && item?.privateKey) {
      map[item.address] = item.privateKey;
    }
  });
  return map;
};

const keyByOutpoint = list => {
  const map = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (item?.privateKey !== undefined) {
      map[`${item.txid}:${item.vout}`] = item.privateKey;
    }
  });
  return map;
};

// Re-attach private keys the server never saw, so downstream signing works.
const reattachKeys = (op, original, result) => {
  if (op === 'balances' && Array.isArray(result?.data?.deriveAddresses)) {
    const byAddr = keyByAddress(original.derive_addresses);
    result.data.deriveAddresses = result.data.deriveAddresses.map(item => {
      const pk = byAddr[item?.address];
      return pk ? {...item, privateKey: pk} : item;
    });
  } else if (op === 'txdetails' && Array.isArray(result?.data)) {
    const byOutpoint = keyByOutpoint(original.transaction_data);
    result.data = result.data.map(item => {
      const pk = byOutpoint[`${item?.txid}:${item?.vout}`];
      return pk !== undefined ? {...item, privateKey: pk} : item;
    });
  }
  return result;
};

export const callWebElectrum = async (op, payload = {}) => {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({op, payload: stripKeys(payload)}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) {
    throw new Error(
      json?.error || `web electrum ${op} failed (${resp.status})`,
    );
  }
  return reattachKeys(op, payload, json.result);
};
