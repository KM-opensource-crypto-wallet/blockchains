/*
 * Review of a WalletConnect eth_signTypedData(_v3/_v4) request (pure, never
 * throws). Permit-style signatures (EIP-2612, DAI, Permit2) let a spender move
 * tokens without an on-chain approval, and marketplace orders (Seaport, Blur)
 * can sell items from the wallet, so they are summarised and graded like the
 * approvals in evmTxReview: unlimited → danger, bounded → warn. A domain chain
 * other than the session chain is danger too. Other typed data keeps level
 * 'none', so the screen behaves as before for it.
 */

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};
const UNLIMITED = 2n ** 128n;
const PERMIT2_ALLOWANCE_TYPES = ['PermitSingle', 'PermitBatch'];
const PERMIT2_TRANSFER_TYPES = [
  'PermitTransferFrom',
  'PermitWitnessTransferFrom',
];
const PERMIT2_BATCH_TRANSFER_TYPES = [
  'PermitBatchTransferFrom',
  'PermitBatchWitnessTransferFrom',
];

const toBigInt = value => {
  try {
    return value === undefined || value === null || value === ''
      ? null
      : BigInt(String(value));
  } catch (e) {
    return null;
  }
};

const describeAmount = value => {
  const amount = toBigInt(value);
  if (amount === null) {
    return String(value);
  }
  return amount >= UNLIMITED ? 'Unlimited' : amount.toString();
};

const isUnlimited = value => {
  const amount = toBigInt(value);
  return amount !== null && amount >= UNLIMITED;
};

const describeTime = seconds => {
  const value = Number(seconds);
  const date = new Date(value * 1000);
  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    return 'No expiry';
  }
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

const parseTypedData = signTypeData => {
  try {
    const data =
      typeof signTypeData === 'string'
        ? JSON.parse(signTypeData)
        : signTypeData;
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : null;
  } catch (e) {
    return null;
  }
};

const sameAddress = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.toLowerCase() === b.toLowerCase();

const hasChangingAmount = item =>
  item?.startAmount !== undefined &&
  item?.endAmount !== undefined &&
  String(item.startAmount) !== String(item.endAmount);

// Seaport moves an amount from startAmount to endAmount over the order period,
// so both ends are shown when they differ.
const describeOrderItem = item => {
  const amount = hasChangingAmount(item)
    ? `${item.startAmount} → ${item.endAmount}`
    : item?.endAmount ?? item?.startAmount;
  switch (Number(item?.itemType)) {
    case 0:
      return `${amount} (native coin, smallest unit)`;
    case 1:
      return `${amount} of ${item?.token}`;
    default:
      return `NFT ${item?.token} #${item?.identifierOrCriteria}`;
  }
};

export const reviewEvmTypedData = (signTypeData, {chainId} = {}) => {
  const result = {level: 'none', kind: 'typedData', reasons: [], rows: []};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason) {
      result.reasons.push(reason);
    }
  };
  const data = parseTypedData(signTypeData);
  if (!data) {
    return result;
  }
  const domain = data.domain || {};
  const message =
    data.message && typeof data.message === 'object' ? data.message : {};
  const primaryType = data.primaryType;

  const sessionChain = toBigInt(String(chainId || '').split(':')[1]);
  const domainChain = toBigInt(domain.chainId);
  if (
    sessionChain !== null &&
    domainChain !== null &&
    sessionChain !== domainChain
  ) {
    result.rows.push({label: 'Signature chain', value: domainChain.toString()});
    raise(
      'danger',
      `This signature is for chain ${domainChain}, but the site is connected on chain ${sessionChain}.`,
    );
  }

  const tokenLabel = domain.name
    ? `${domain.name} (${domain.verifyingContract})`
    : domain.verifyingContract;
  // `until`: EIP-2612 / DAI allowances last until revoked (their deadline only
  // limits when the signature can be used); Permit2 allowances expire.
  const gradeAllowance = (spender, unlimited, until) =>
    unlimited
      ? raise(
          'danger',
          `Lets ${spender} move all of this token from your wallet ${until}, without another approval.`,
        )
      : raise(
          'warn',
          `Lets ${spender} move up to this amount of the token from your wallet without another approval.`,
        );

  if (primaryType === 'Permit') {
    result.kind = 'permit';
    const spender = message.spender;
    // Only fields the schema declares are signed, so DAI's `allowed` counts
    // only when the Permit type declares it.
    const declared = Array.isArray(data.types?.[primaryType])
      ? data.types[primaryType]
      : [];
    const isDai = declared.some(field => field?.name === 'allowed');
    if (isDai && !message.allowed) {
      result.kind = 'revoke';
      result.rows.push({label: 'Spender', value: String(spender)});
      return result;
    }
    const unlimited = isDai || isUnlimited(message.value);
    result.rows.push(
      {label: 'Spender', value: String(spender)},
      {label: 'Token', value: String(tokenLabel)},
      {
        label: 'Amount',
        value: isDai ? 'Unlimited' : describeAmount(message.value),
      },
      {
        label: 'Signature valid until',
        value: describeTime(isDai ? message.expiry : message.deadline),
      },
    );
    gradeAllowance(spender, unlimited, 'until you revoke it');
  } else if (PERMIT2_ALLOWANCE_TYPES.includes(primaryType)) {
    result.kind = 'permit';
    const spender = message.spender;
    result.rows.push({label: 'Spender', value: String(spender)});
    if (Array.isArray(message.details)) {
      message.details.forEach((detail, i) =>
        result.rows.push({
          label: `Token ${i + 1}`,
          value: `${detail?.token}: ${describeAmount(detail?.amount)}`,
        }),
      );
      gradeAllowance(
        spender,
        message.details.some(detail => isUnlimited(detail?.amount)),
        'until the allowance expires',
      );
    } else {
      const detail = message.details || {};
      result.rows.push(
        {label: 'Token', value: String(detail.token)},
        {label: 'Amount', value: describeAmount(detail.amount)},
        {label: 'Allowance expires', value: describeTime(detail.expiration)},
      );
      gradeAllowance(
        spender,
        isUnlimited(detail.amount),
        'until the allowance expires',
      );
    }
  } else if (
    PERMIT2_TRANSFER_TYPES.includes(primaryType) ||
    PERMIT2_BATCH_TRANSFER_TYPES.includes(primaryType)
  ) {
    result.kind = 'permitTransfer';
    const spender = message.spender;
    const permitted = Array.isArray(message.permitted)
      ? message.permitted
      : [message.permitted || {}];
    result.rows.push({label: 'Spender', value: String(spender)});
    if (permitted.length === 1 && !Array.isArray(message.permitted)) {
      result.rows.push(
        {label: 'Token', value: String(permitted[0].token)},
        {label: 'Amount', value: describeAmount(permitted[0].amount)},
      );
    } else {
      permitted.forEach((item, i) =>
        result.rows.push({
          label: `Token ${i + 1}`,
          value: `${item?.token}: ${describeAmount(item?.amount)}`,
        }),
      );
    }
    result.rows.push({
      label: 'Signature valid until',
      value: describeTime(message.deadline),
    });
    if (permitted.some(item => isUnlimited(item?.amount))) {
      raise(
        'danger',
        `Lets ${spender} take all of this token from your wallet once, without another approval.`,
      );
    } else {
      raise(
        'warn',
        `Lets ${spender} take this amount of the token from your wallet once, without another approval.`,
      );
    }
  } else if (
    primaryType === 'OrderComponents' ||
    (primaryType === 'Order' && /blur/i.test(String(domain.name || '')))
  ) {
    result.kind = 'order';
    const offerer = message.offerer ?? message.trader;
    const offer = Array.isArray(message.offer) ? message.offer : [];
    const paidToYou = (
      Array.isArray(message.consideration) ? message.consideration : []
    ).filter(item => sameAddress(item?.recipient, offerer));
    if (primaryType === 'OrderComponents') {
      result.rows.push(
        {label: 'You give', value: `${offer.length} item(s)`},
        {
          label: 'Paid to you',
          value: paidToYou.length
            ? paidToYou.map(describeOrderItem).join(', ')
            : 'Nothing',
        },
      );
      if ([...offer, ...paidToYou].some(hasChangingAmount)) {
        result.rows.push({
          label: 'Order period',
          value: `${describeTime(message.startTime)} to ${describeTime(
            message.endTime,
          )}`,
        });
      }
    } else {
      result.rows.push(
        {label: 'Collection', value: String(message.collection)},
        {label: 'Price', value: String(message.price)},
      );
    }
    raise(
      'danger',
      'This signature creates a marketplace order that can sell items from your wallet. Check what you give and what is paid to you.',
    );
  }
  return result;
};
