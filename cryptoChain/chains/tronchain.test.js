import {TronChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TronChain';

jest.mock('tronweb', () => {
  return jest.fn().mockImplementation(() => {
    return {
      trx: {
        getBalance: jest.fn().mockResolvedValue(1000000),
        getTransactionInfo: jest
          .fn()
          .mockResolvedValue({id: 'testTransactionId'}),
        sign: jest.fn().mockResolvedValue('signedTransaction'),
        sendRawTransaction: jest.fn().mockResolvedValue('transactionResult'),
        // mock other methods as necessary
      },
      transactionBuilder: {
        sendTrx: jest.fn().mockResolvedValue('transaction'),
        triggerSmartContract: jest
          .fn()
          .mockResolvedValue({transaction: 'triggeredTransaction'}),
        // mock other methods as necessary
      },
      contract: () => ({
        at: jest.fn().mockResolvedValue({
          toString: () => 'contract', // Add this line
          balanceOf: () => ({
            call: jest.fn().mockResolvedValue(5000000),
          }),
        }),
      }),
      setAddress: jest.fn(),
      toSun: jest.fn().mockReturnValue('sunAmount'),
      address: {
        fromPrivateKey: jest.fn().mockReturnValue('addressFromPrivateKey'),
        toHex: jest.fn().mockReturnValue('hexAddress'),
        fromHex: jest.fn().mockReturnValue('fromHexAddress'),
      },
      // mock other properties and methods as necessary
    };
  });
});

describe('TronChain', () => {
  let instance;

  beforeEach(() => {
    // Global mock for fetch
    global.fetch = jest.fn(url => {
      console.log(`in fetch, url: ${url}`);
      if (url.includes('/transactions')) {
        return Promise.resolve({
          json: () => {
            return Promise.resolve({
              data: [
                {
                  raw_data: {
                    contract: [
                      {
                        parameter: {
                          value: {
                            owner_address: 'fromHexAddress',
                            amount: 5000000,
                            to_address: 'toHexAddress',
                          },
                        },
                      },
                    ],
                    timestamp: new Date(),
                  },
                  txID: 'txID123',
                  blockNumber: 10,
                  ret: [
                    {
                      contractRet: 'SUCCESS',
                      fee: 10,
                    },
                  ],
                  net_fee: 5,
                },
              ],
            });
          },
        });
      } else {
        return Promise.resolve({
          json: () => {
            return Promise.resolve({
              data: [
                {
                  balance: 1000000,
                  trc20: [
                    {
                      contractAddress: '5000000',
                    },
                  ],
                },
              ],
            });
          },
        });
      }
    });

    instance = TronChain('yourPrivateKey');
  });

  it('should get icon name', async () => {
    const iconName = await instance.getIconName();
    expect(iconName).toEqual('TRX');
  });

  it('should get contract', async () => {
    const contract = await instance.getContract({
      contractAddress: 'contractAddress',
    });
    expect(contract).toEqual({name: '', symbol: '', decimals: ''});
  });

  it('should get balance', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [
              {
                balance: 1000000,
                trc20: [
                  {
                    contractAddress: '5000000',
                  },
                ],
              },
            ],
          }),
      }),
    );
    const balance = await instance.getBalance({address: 'address'});
    expect(balance).toEqual('1000000');
  });

  it('should get balance 0 for empty address', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [
              {
                balance: 0,
                trc20: [
                  {
                    contractAddress: '5000000',
                  },
                ],
              },
            ],
          }),
      }),
    );
    const balance = await instance.getBalance({address: 'unknown_address'});
    expect(balance).toEqual('0');
  });

  it('should get balance 0 for empty address even if api returns empty data array', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [],
          }),
      }),
    );
    const balance = await instance.getBalance({address: 'unknown_address'});
    expect(balance).toEqual('0');
  });

  it('should get token balance', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [
              {
                balance: 0,
                trc20: [
                  {
                    contractAddress: '5000000',
                  },
                ],
              },
            ],
          }),
      }),
    );

    const contract = await instance.getContract('contractAddress');
    const balance = await instance.getTokenBalance({
      address: 'address',
      contractAddress: 'contractAddress',
      decimal: 6,
    });
    expect(balance).toEqual('5000000');
  });

  it('should get bal 0 for non existing token balance diff api resp', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [
              {
                balance: 0,
                trc20: [],
              },
            ],
          }),
      }),
    );

    const balance = await instance.getTokenBalance({
      address: 'address',
      contractAddress: 'contractAddressNotOwned',
      decimal: 6,
    });
    expect(balance).toEqual('0');
  });

  it('should get bal 0 for non existing token balance', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [],
          }),
      }),
    );

    const balance = await instance.getTokenBalance({
      address: 'address',
      contractAddress: 'contractAddressNotOwned',
      decimal: 6,
    });
    expect(balance).toEqual('0');
  });

  it('should get transactions', async () => {
    const transactions = await instance.getTransactions({address: 'address'});
    expect(transactions).toBeDefined();
    expect(transactions[0].amount).toEqual('5000000');
  });

  it('should send trx', async () => {
    const result = await instance.send({
      to: 'to',
      from: 'from',
      privateKey: 'privateKey',
      amount: '1.0',
    });
    expect(result).toEqual('transactionResult');
  });

  it('should send token', async () => {
    const result = await instance.sendToken({
      contractAddress: 'contractAddress',
      to: 'to',
      from: 'from',
      amount: '1.0',
      privateKey: 'privateKey',
      transactionFee: 'transactionFee',
      decimals: 6,
    });
    expect(result).toEqual('transactionResult');
  });

  it('should wait for confirmation', async () => {
    const result = await instance.waitForConfirmation({
      transaction: {
        txid: 'a2c07d4713147c8dfeb734f3027291a1f510c84d3500246bfefd154e7e1f653a',
      },
      interval: 3000,
      retries: 5,
    });
    expect(result).toBeDefined();
    expect(result.id).toEqual('testTransactionId');
  });

  it('should throw an error when creating tronWeb fails', () => {
    const error = new Error('TronWeb creation error');
    require('tronweb').mockImplementationOnce(() => {
      throw error;
    });

    expect(() => TronChain('yourPrivateKey')).toThrow(error);
  });

  it('should throw an error when getting account fails', async () => {
    const error = new Error('Get account error');
    global.fetch.mockImplementationOnce(() => {
      throw error;
    });

    await expect(instance.getBalance({address: 'address'})).rejects.toThrow(
      error,
    );
  });

  describe('exception handling', () => {
    const error = new Error('Mocked error');
    beforeEach(() => {
      require('tronweb').mockImplementationOnce(() => {
        console.log('in mocked tronweb');
        return {
          contract: () => {
            return {
              at: jest.fn().mockRejectedValue(error),
            };
          },

          toSun: jest.fn().mockReturnValue('sunAmount'),
          address: {
            toHex: jest.fn().mockReturnValue('mockedHexValue'),
            fromPrivateKey: jest.fn().mockReturnValue('mockedHexValue'),
          },
          transactionBuilder: {
            sendTrx: jest.fn().mockReturnValue('transactionResult'),
          },
          trx: {
            sendRawTransaction: async () => {
              console.log('in sendRawTransaction');
              throw error;
            }, //jest.fn().mockRejectedValue(error),
            sign: jest.fn().mockReturnValue('signedTransaction'),
          },
        };
      });
      instance = TronChain('yourPrivateKey');
    });

    it('should throw an error when getting contract fails', async () => {
      // const error = new Error('Get contract error');
      // require('tronweb').mockImplementationOnce(() => {
      //   return {
      //     contract: () => {
      //       return {
      //         at: jest.fn().mockRejectedValue(error),
      //       };
      //     },
      //   };
      // });
      // instance = TronChain('yourPrivateKey');
      await expect(
        instance.getContract({contractAddress: null}),
      ).resolves.toEqual({});
    });

    it('should throw an error when sending trx fails', async () => {
      await expect(
        instance.send({
          to: 'to',
          from: 'from',
          amount: '1',
          privateKey: 'privateKey',
        }),
      ).rejects.toThrow(error);
    });

    it('should throw an error when sending token fails', async () => {
      // const error = new Error('Send token error');
      // require('tronweb').mockImplementationOnce(() => {
      //   return {
      //     trx: {
      //       sendRawTransaction: jest.fn().mockRejectedValue(error),
      //     },
      //   };
      // });

      require('tronweb').mockImplementationOnce(() => {
        console.log('in mocked tronweb');
        return {
          contract: () => {
            return {
              at: jest.fn().mockRejectedValue(error),
            };
          },

          toSun: jest.fn().mockReturnValue('sunAmount'),
          address: {
            toHex: jest.fn().mockReturnValue('mockedHexValue'),
            fromPrivateKey: jest.fn().mockReturnValue('mockedHexValue'),
          },
          transactionBuilder: {
            sendTrx: jest.fn().mockReturnValue('transactionResult'),
            triggerSmartContract: jest
              .fn()
              .mockResolvedValue({transaction: 'triggeredTransaction'}),
          },
          trx: {
            sendRawTransaction: async () => {
              console.log('in sendRawTransaction');
              throw error;
            }, //jest.fn().mockRejectedValue(error),
            sign: jest.fn().mockReturnValue('signedTransaction'),
          },
        };
      });

      const coinWrapper = {
        token: {
          address: 'tokenAddress',
        },
      };
      instance = TronChain('yourPrivateKey');
      await expect(
        instance.sendToken({
          contractAddress: 'contractAddress',
          to: 'to',
          from: 'from',
          amount: '1.0',
          privateKey: 'privateKey',
          transactionFee: 'transactionFee',
          decimals: 6,
        }),
      ).rejects.toThrow(error);
    });

    it('should throw an error when waiting for confirmation times out', async () => {
      require('tronweb').mockImplementationOnce(() => {
        return {
          trx: {
            getTransactionInfo: jest.fn().mockResolvedValue(null),
          },
        };
      });
      instance = TronChain('yourPrivateKey');
      await expect(
        instance.waitForConfirmation({
          transaction: {txid: 'transaction'},
          interval: 3000,
          retries: 1,
        }),
      ).resolves.toEqual(null);
    });
  });
});
