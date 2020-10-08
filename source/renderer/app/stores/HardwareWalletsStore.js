// @flow
import { observable, action, runInAction, computed } from 'mobx';
import { get, map, find, findLast } from 'lodash';
import Store from './lib/Store';
import Request from './lib/LocalizedRequest';
import { HwDeviceStatuses } from '../domains/Wallet';
import { getRawWalletId, WalletIdPrefixes } from '../api/utils';
import { HW_SHELLEY_CONFIG } from '../config/hardwareWalletsConfig';
import {
  getHardwareWalletTransportChannel,
  getExtendedPublicKeyChannel,
  getCardanoAdaAppChannel,
  getHardwareWalletConnectionChannel,
  signTransactionLedgerChannel,
  signTransactionTrezorChannel,
} from '../ipc/getHardwareWalletChannel';
import {
  prepareLedgerInput,
  prepareLedgerOutput,
  prepareTxAux,
  prepareBody,
  CachedDeriveXpubFactory,
  ShelleyTxWitnessShelley,
  ShelleyTxInputFromUtxo,
  ShelleyTxOutput,
} from '../utils/shelleyLedger';
import { prepareTrezorInput, prepareTrezorOutput } from '../utils/shelleyTrezor';
import {
  DeviceModels,
  DeviceTypes,
} from '../../../common/types/hardware-wallets.types';

import type { HwDeviceStatus } from '../domains/Wallet';
import type { CoinSelectionsResponse } from '../api/transactions/types';
import type {
  HardwareWalletLocalData,
  HardwareWalletsLocalData,
  SetHardwareWalletLocalDataRequestType,
} from '../api/utils/localStorage';
import type {
  TransportDevice,
  LedgerModel,
  TrezorModel,
  HardwareWalletExtendedPublicKeyResponse,
} from '../../../common/types/hardware-wallets.types';

export type TxSignRequestTypes = {
  recieverAddress: string,
  coinSelection: CoinSelectionsResponse,
};

export type ByronEncodeSignedTransactionRequest = {|
  txDataHex: string,
  witnesses: Array<ByronSignedTransactionWitnesses>,
|};

export type ByronSignedTransactionWitnesses = {
  signature: string,
  xpub: HardwareWalletExtendedPublicKeyResponse,
};

const CARDANO_ADA_APP_POLLING_INTERVAL = 1000;
const DEFAULT_HW_NAME = 'Hardware Wallet';

export default class HardwareWalletsStore extends Store {
  @observable selectCoinsRequest: Request<CoinSelectionsResponse> = new Request(
    this.api.ada.selectCoins
  );
  @observable
  hardwareWalletsLocalDataRequest: Request<HardwareWalletsLocalData> = new Request(
    this.api.localStorage.getHardwareWalletsLocalData
  );
  @observable
  setHardwareWalletLocalDataRequest: Request<HardwareWalletLocalData> = new Request(
    this.api.localStorage.setHardwareWalletLocalData
  );
  @observable unsetHardwareWalletLocalDataRequest: Request<void> = new Request(
    this.api.localStorage.unsetHardwareWalletLocalData
  );
  @observable
  hardwareWalletDevicesRequest: Request<HardwareWalletsLocalData> = new Request(
    this.api.localStorage.getHardwareWalletDevices
  );
  @observable
  setHardwareWalletDeviceRequest: Request<HardwareWalletLocalData> = new Request(
    this.api.localStorage.setHardwareWalletDevice
  );
  @observable
  unsetHardwareWalletDeviceRequest: Request<HardwareWalletLocalData> = new Request(
    this.api.localStorage.unsetHardwareWalletDevice
  );
  @observable hwDeviceStatus: HwDeviceStatus = HwDeviceStatuses.CONNECTING;
  @observable extendedPublicKey: ?HardwareWalletExtendedPublicKeyResponse = null;
  @observable txSignRequest: TxSignRequestTypes = {};
  @observable transportDevice: ?TransportDevice = null;
  @observable txBody: ?string = null;

  cardanoAdaAppPollingInterval: ?IntervalID = null;

  setup() {
    const { hardwareWallets: hardwareWalletsActions } = this.actions;
    hardwareWalletsActions.selectCoins.listen(this._selectCoins);
    hardwareWalletsActions.refreshHardwareWalletsLocalData.listen(
      this._refreshHardwareWalletsLocalData
    );
    hardwareWalletsActions.setHardwareWalletLocalData.listen(
      this._setHardwareWalletLocalData
    );
    hardwareWalletsActions.unsetHardwareWalletLocalData.listen(
      this._unsetHardwareWalletLocalData
    );
    hardwareWalletsActions.setHardwareWalletDevice.listen(
      this._setHardwareWalletDevice
    );
    hardwareWalletsActions.unsetHardwareWalletDevice.listen(
      this._unsetHardwareWalletDevice
    );
    getHardwareWalletConnectionChannel.onReceive(
      this._changeHardwareWalletConnectionStatus
    );
    this.hardwareWalletsLocalDataRequest.execute();
    this.hardwareWalletDevicesRequest.execute();
  }

  @action _selectCoins = async (params: {
    walletId: string,
    address: string,
    amount: string,
  }) => {
    const { walletId, address, amount } = params;
    const wallet = this.stores.wallets.getWalletById(walletId);
    if (!wallet)
      throw new Error('Active wallet required before coin selections.');
    const rawWalletId = getRawWalletId(
      walletId,
      WalletIdPrefixes.HARDWARE_WALLET
    );
    const coinSelection = await this.selectCoinsRequest.execute({
      walletId: rawWalletId,
      address,
      amount,
    });
    runInAction('HardwareWalletsStore:: set coin selections', () => {
      this.txSignRequest = {
        recieverAddress: address,
        coinSelection,
      };
    });
  };

  @action establishHardwareWalletConnection = async () => {
    console.debug('>>> establishHardwareWalletConnection');
    runInAction('HardwareWalletsStore:: set HW device CONNECTING', () => {
      this.hwDeviceStatus = HwDeviceStatuses.CONNECTING;
    });


    // Am I on hardware wallet route
      // YES


        // YES - check what device is expected (deviceType & deviceId) from LC
        //     - if device not found start with establishing new connection
        //     - if device found just change device status if not connected to connected (_changeHardwareWalletConnectionStatus)

        // NO - I want to add new wallet
        //    - Pick device not initialized in LC so we keep connections with already created wallets


    const activeHardwareWalletId = get(
      this.stores,
      ['wallets', 'activeHardwareWallet', 'id'],
      null
    );
    const hardwareWalletsConnectionData = this.hardwareWalletsConnectionData;
    const hardwareWalletDevices = this.hardwareWalletDevices;

    console.debug('>>> establishHardwareWalletConnection Checks: ', {
      activeHardwareWalletId,
      hardwareWalletsConnectionData,
      hardwareWalletDevices,
    });

    let transportDevice;
    if (activeHardwareWalletId) {
      console.debug('>>> Active HW recognized: ', activeHardwareWalletId);
      // Check for device wallet connected to
      const recognizedPairedHardwareWallet = find(hardwareWalletDevices, recognizedDevice => (
        recognizedDevice.paired === activeHardwareWalletId
      ));
      console.debug('>>> Active HW paired device: ', recognizedPairedHardwareWallet);
      if (!recognizedPairedHardwareWallet || (recognizedPairedHardwareWallet && recognizedPairedHardwareWallet.disconnected)) {
        console.debug('>>> DEVICE not PAIRED or not PHYSICALLY CONNECTED')
        // Device exist and connected
        // Connect device with proper path / ID
      } else {
        console.debug('>>> DEVICE PAIRED and PHYSICALLY CONNECTED')
        // Device already recognized and set to connected in "_changeHardwareWalletConnectionStatus()"
      }
    } else {
      // NO - I want to add new wallet
        //    - Pick device not initialized in LC so we keep connections with already created wallets
      console.debug('>>> establishHardwareWalletConnection - connect with NEW device');
      try {
        console.debug('>>> DEVICES: ', this.hardwareWalletDevices);
        // Get unpaired devices if exist
        const lastUnpairedConnectedDevice = findLast(this.hardwareWalletDevices, hardwareWalletDevice => !hardwareWalletDevice.paired && !hardwareWalletDevice.disconnected);

        console.debug('>>> UNPAIRED: ', lastUnpairedConnectedDevice);

        const transportDevice = await getHardwareWalletTransportChannel.request({
          devicePath: lastUnpairedConnectedDevice ? lastUnpairedConnectedDevice.path : null,
          isTrezor: lastUnpairedConnectedDevice && lastUnpairedConnectedDevice.deviceType === DeviceTypes.TREZOR,
        });
        console.debug('>>> DEVICE CONNECTED: ', transportDevice);
        if (transportDevice) {
          const { deviceType } = transportDevice;
          runInAction('HardwareWalletsStore:: set HW device CONNECTED', () => {
            this.transportDevice = transportDevice;
          });
          if (deviceType === DeviceTypes.TREZOR) {
            // Jump to exporting public key
            await this._getExtendedPublicKey();
          } else {
            // Start poller to recognize if Cardano App is launched on device
            this.cardanoAdaAppPollingInterval = setInterval(
              this.getCardanoAdaApp,
              CARDANO_ADA_APP_POLLING_INTERVAL
            );
          }
        } else {
          throw new Error('Device not found')
        }
      } catch (e) {
        console.debug('>>> DEVICE CONNECT FAILED: ', e);
        if (e.statusCode === 28177) {
          throw new Error('Device is locked');
        }
        if (e.id === 'TransportLocked') {
          throw new Error('Transport Failure');
        }
        throw e;
      }
    }
  };

  // Ledger method only
  @action getCardanoAdaApp = async () => {
    this.hwDeviceStatus = HwDeviceStatuses.LAUNCHING_CARDANO_APP;
    try {
      const cardanoAdaApp = await getCardanoAdaAppChannel.request();
      // @TODO - keep poller until app recognized or process exited
      this.stopCardanoAdaAppFetchPoller();
      if (cardanoAdaApp) {
        // While Cardano ADA app recognized on Ledger, proceed to exporting public key
        await this._getExtendedPublicKey();
      }
    } catch (error) {
      throw error;
    }
  };

  @action _getExtendedPublicKey = async () => {
    this.hwDeviceStatus = HwDeviceStatuses.EXPORTING_PUBLIC_KEY;
    console.debug('>>>> _getExtendedPublicKey <<<<');
    const { transportDevice } = this;
    if (!transportDevice)
      throw new Error('Can not export extended public key: Device not recognized!');
    console.debug('>>> _getExtendedPublicKey::Continue: ', transportDevice);
    const { deviceType, path, deviceName, deviceId } = transportDevice;
    const isTrezor = deviceType === DeviceTypes.TREZOR;

    const { activeHardwareWallet } = this.stores.wallets;
    try {
      const extendedPublicKey = await getExtendedPublicKeyChannel.request({
        path: "1852'/1815'/0'", // Shelley 1852 ADA 1815 indicator for account '0'
        isTrezor,
        devicePath: path,
      });
      console.debug('>>> _getExtendedPublicKey::Exported: ', extendedPublicKey);

      // Check if public key matches active hardware wallet public key
      if (activeHardwareWallet && this.hardwareWalletsConnectionData) {
        const activeHardwareWalletConnection = this
          .hardwareWalletsConnectionData[activeHardwareWallet.id];
        const activeHardwareWalletConnectionKeys = get(
          activeHardwareWalletConnection,
          'extendedPublicKey',
          {}
        );
        if (
          activeHardwareWalletConnectionKeys.publicKeyHex ===
          extendedPublicKey.publicKeyHex
        ) {
          console.debug('>>> WALLET ALREADY PAIRED - SET TO connected!');
          // Active wallet exists and match device - set to CONNECTED state
          this._setHardwareWalletLocalData({
            walletId: activeHardwareWallet.id,
            data: {
              disconnected: false,
              device: transportDevice,
            },
          });

          this._setHardwareWalletDevice({
            deviceId,
            data: {
              deviceType,
              deviceModel,
              deviceName,
              path,
              paired: activeHardwareWallet.id, // device paired with software wallet
              disconnected: false, // device physically disconnected
            },
          });
          return;
        }
        // Active wallet exists but wrong device supplied
        console.debug('>>> WALLET ALREADY PAIRED - KEYS NOT MATCH!');
        throw new Error(
          `Wrong Hardware Wallet device supplied to "${activeHardwareWallet.name}" wallet`
        );
      }
      // Active wallet not exist, create new one with default name
      console.debug('>>> WALLET NOT PAIRED - CREATE NEW ONE!');
      await this.actions.wallets.createHardwareWallet.trigger({
        walletName: deviceName || DEFAULT_HW_NAME,
        extendedPublicKey,
        device: transportDevice,
      });

      runInAction('HardwareWalletsStore:: set wallet READY', () => {
        this.extendedPublicKey = extendedPublicKey;
        this.hwDeviceStatus = HwDeviceStatuses.READY;
      });
    } catch (e) {
      /**
       * ============  Exporting aborted  =============
       * e.statusCode === 28169 // Ledger
       * e.code === 'Failure_ActionCancelled' // Trezor
       */
      runInAction('HardwareWalletsStore:: Cannot export extended public key', () => {
        this.hwDeviceStatus = HwDeviceStatuses.EXPORTING_PUBLIC_KEY_FAILED;
      });
      // Pass other errors to caller (establishHardwareWalletConnection() in this case) and handle additional actions if needed
      throw e;
    }
  };

  // Trezor - Shelley only
  @action _signTransactionTrezor = async () => {
    const { coinSelection, recieverAddress } = this.txSignRequest;
    const { inputs, outputs } = coinSelection;

    let totalInputs = 0;
    const inputsData = map(inputs, input => {
      const addressIndex = this.stores.addresses.getAddressIndex(input.address);
      totalInputs += input.amount.quantity;
      return prepareTrezorInput(input, addressIndex);
    });

    let totalOutputs = 0;
    const outputsData = map(outputs, output => {
      const addressIndex = this.stores.addresses.getAddressIndex(output.address);
      const isChange = output.address !== recieverAddress;
      totalOutputs += output.amount.quantity;
      return prepareTrezorOutput(output, addressIndex, isChange);
    })

    const fee = totalInputs - totalOutputs;

    try {
      const signedTransaction = await signTransactionTrezorChannel.request({
        inputs: inputsData,
        outputs: outputsData,
        fee: fee.toString(),
        ttl: '15000000',
        networkId: HW_SHELLEY_CONFIG.NETWORK.MAINNET.networkId,
        protocolMagic: HW_SHELLEY_CONFIG.NETWORK.MAINNET.protocolMagic,
      });

      runInAction(
        'HardwareWalletsStore:: set signed transaction data',
        () => {
          this.txBody = signedTransaction.serializedTx;
        }
      );
    } catch (error) {
      runInAction(
        'HardwareWalletsStore:: set Transaction verifying failed',
        () => {
          this.hwDeviceStatus = HwDeviceStatuses.VERIFYING_TRANSACTION_FAILED;
        }
      );
      throw error;
    }
  };

  // Ledger - Shelley only
  @action _signTransactionLedger = async () => {
    const { coinSelection, recieverAddress } = this.txSignRequest;
    const { inputs, outputs } = coinSelection;

    let totalInputs = 0;
    const unsignedTxInputs = [];
    const inputsData = map(inputs, input => {
      const addressIndex = this.stores.addresses.getAddressIndex(input.address);
      totalInputs += input.amount.quantity;
      const shelleyTxInput = ShelleyTxInputFromUtxo(input);
      unsignedTxInputs.push(shelleyTxInput);
      return prepareLedgerInput(input, addressIndex);
    });

    let totalOutputs = 0;
    const unsignedTxOutputs = [];
    const outputsData = map(outputs, output => {
      totalOutputs += output.amount.quantity;
      const isChange = output.address !== recieverAddress;
      const addressIndex = this.stores.addresses.getAddressIndex(output.address);
      const shelleyTxOutput = ShelleyTxOutput(output, addressIndex, isChange);
      unsignedTxOutputs.push(shelleyTxOutput);
      return prepareLedgerOutput(output, addressIndex, isChange);
    });

    const fee = totalInputs - totalOutputs;
    const ttl = 15000000;
    const certificates = [];
    const withdrawals = [];
    const metadataHashHex = null;

    try {
      const signedTransaction = await signTransactionLedgerChannel.request({
        inputs: inputsData,
        outputs: outputsData,
        fee: fee.toString(),
        ttl: ttl.toString(),
        networkId: HW_SHELLEY_CONFIG.NETWORK.MAINNET.networkId,
        protocolMagic: HW_SHELLEY_CONFIG.NETWORK.MAINNET.protocolMagic,
        certificates,
        withdrawals,
        metadataHashHex,
      });

      // Sign and prepare witnesses
      const _shelleyWitnesses = map(signedTransaction.witnesses, async (witness) => {
        const xpub = await this._deriveXpub(witness.path);
        const publicKey = xpub.slice(0, 32); // TODO: export from addresses
        const signature = Buffer.from(witness.witnessSignatureHex, 'hex')
        return ShelleyTxWitnessShelley(publicKey, signature);
      })
      const shelleyWitnesses = await Promise.all(_shelleyWitnesses);
      const txWitnesses = new Map();
      if (shelleyWitnesses.length > 0) {
        txWitnesses.set(0, shelleyWitnesses);
      }

      // Prepare unsigned transaction structure for serialzation
      const txAux = prepareTxAux({
        txInputs: unsignedTxInputs,
        txOutputs: unsignedTxOutputs,
        fee,
        ttl,
        certificates,
        withdrawals,
      });

      // Prepare serialized transaction with unsigned data and signed witnesses
      const txBody = await prepareBody(txAux, txWitnesses);
      runInAction('HardwareWalletsStore:: set Transaction verified', () => {
        this.hwDeviceStatus = HwDeviceStatuses.VERIFYING_TRANSACTION_SUCCEEDED;
        this.txBody = txBody
      });
    } catch (error) {
      runInAction(
        'HardwareWalletsStore:: set Transaction verifying failed',
        () => {
          this.hwDeviceStatus = HwDeviceStatuses.VERIFYING_TRANSACTION_FAILED;
        }
      );
      throw error;
    }
  };

  @action _changeHardwareWalletConnectionStatus = async (params: {
    disconnected: boolean,
  }) => {
    const { disconnected, deviceType, deviceId, deviceModel, deviceName, path } = params;
    console.debug('>>> _changeHardwareWalletConnectionStatus: ', params);
    // If Hardware Wallet exist and connected with device, set current connection status to LC
    const activeHardwareWalletId = get(
      this.stores,
      ['wallets', 'activeHardwareWallet', 'id'],
      null
    );

    const hardwareWalletsConnectionData = this.hardwareWalletsConnectionData;
    // Add new recognized device - not connected to software wallet
    // Or update recognized device while paired with existing software wallet
    const recognizedPairedHardwareWallet = find(hardwareWalletsConnectionData, connection => (
      connection.device.deviceId === deviceId
    ))
    console.debug('>>> _changeHardwareWalletConnectionStatus:: DATA: ', {
      activeHardwareWalletId,
      hardwareWalletsConnectionData,
      recognizedPairedHardwareWallet,
      params
    });

    if (disconnected) {
      console.debug('>>>> DISCONNECT');
      // this.hwDeviceStatus = HwDeviceStatuses.CONNECTING;
      // @TODO - This logic should be changed once we allow multiple hardware wallets
      if (deviceType !== DeviceTypes.TREZOR) {
        console.debug('>>>> DISCONNECT - stop Cardano app poller');
        this.stopCardanoAdaAppFetchPoller();
      }
      // If device is disconnected, connection is initialized and is waiting for device to be plugged-in
      // If device is connected, connection is initialized and device confirmation steps are in progress
      if (activeHardwareWalletId && hardwareWalletsConnectionData[activeHardwareWalletId].device.deviceId === deviceId) {
        // Try to re-establish connection only if disconnected device is connected with currently active software wallet
        console.debug('>>>> DISCONNECT - re-establish connection');
        // this.establishHardwareWalletConnection();
      }
    }
    console.debug('>>>> CONNECT');
    // Check if plugged-in device match one already established connections
    // If deviceId recognized - get software wallet and set to connected.
    //   - update possible device changes
    // Else deviceId not recognized - for now just break process

    if (recognizedPairedHardwareWallet) {
      // Change software wallet status paired with device
      console.debug('>>> Connect device with existing software wallet');
      await this._setHardwareWalletLocalData({
        walletId: recognizedPairedHardwareWallet.id,
        data: {
          deviceType,
          deviceModel,
          deviceName,
          disconnected,
        },
      });
    }
    console.debug('>>> Add new device or update - LC- not connected to software wallet: ', { recognizedPairedHardwareWallet });
    await this._setHardwareWalletDevice({
      deviceId,
      data: {
        deviceType,
        deviceModel,
        deviceName,
        path,
        paired: recognizedPairedHardwareWallet ? recognizedPairedHardwareWallet.id : null, // device paired with software wallet
        disconnected, // device physically disconnected
      },
    });

    this._refreshHardwareWalletsLocalData();
    this._refreshHardwareWalletDevices();
    console.debug('>>> LC WALLETS: ', this.hardwareWalletsLocalDataRequest.result);
  };

  @action resetInitializedConnection = () => {
    this.hwDeviceStatus = HwDeviceStatuses.CONNECTING;
    this.extendedPublicKey = null;
    this.transportDevice = {};
  };

  @action _refreshHardwareWalletsLocalData = () => {
    this.hardwareWalletsLocalDataRequest.execute();
  };

  @action _refreshHardwareWalletDevices = () => {
    this.hardwareWalletDevicesRequest.execute();
  };

  @computed get hardwareWalletsConnectionData(): HardwareWalletsLocalData {
    return this.hardwareWalletsLocalDataRequest.result;
  };

  @computed get hardwareWalletDevices(): HardwareWalletsLocalData {
    return this.hardwareWalletDevicesRequest.result;
  };

  _deriveXpub = CachedDeriveXpubFactory(async (absDerivationPath) => {
    const response = await getExtendedPublicKeyChannel.request({
      path: absDerivationPath,
      isTrezor: false,
    });
    const xpubHex = `${response.publicKeyHex}${response.chainCodeHex}`;
    return Buffer.from(xpubHex, 'hex');
  });

  _resetTxSignRequestData = () => {
    this.selectCoinsRequest.reset();
    this.txSignRequest = {};
  };

  _deviceType = (deviceModel: LedgerModel | TrezorModel) => {
    let type;
    switch (deviceModel) {
      case DeviceModels.LEDGER_NANO_S:
        type = DeviceTypes.LEDGER;
        break;
      case DeviceModels.LEDGER_NANO_X:
        type = DeviceTypes.LEDGER;
        break;
      case DeviceModels.TREZOR_ONE:
        type = DeviceTypes.TREZOR;
        break;
      case DeviceModels.TREZOR_T:
        type = DeviceTypes.TREZOR;
        break;
      default:
        type = null;
    }
    return type;
  };

  _setHardwareWalletLocalData = async ({
    walletId,
    data,
  }: SetHardwareWalletLocalDataRequestType) => {
    await this.setHardwareWalletLocalDataRequest.execute(walletId, data);
    this._refreshHardwareWalletsLocalData();
    this.stores.wallets.refreshWalletsData();
  };

  _unsetHardwareWalletLocalData = async ({
    walletId,
  }: {
    walletId: string,
  }) => {
    await this.unsetHardwareWalletLocalDataRequest.execute(walletId);
    this._refreshHardwareWalletsLocalData();
    this.stores.wallets.refreshWalletsData();
  };

  _setHardwareWalletDevice = async ({
    deviceId,
    data,
  }: SetHardwareWalletLocalDataRequestType) => {
    await this.setHardwareWalletDeviceRequest.execute(deviceId, data);
    this._refreshHardwareWalletDevices();
  };

  _unsetHardwareWalletDevice = async ({
    deviceId,
  }: {
    deviceId: string,
  }) => {
    await this.unsetHardwareWalletDeviceRequest.execute(deviceId);
    this._refreshHardwareWalletDevices();
  };

  stopCardanoAdaAppFetchPoller = () => {
    if (this.cardanoAdaAppPollingInterval)
      clearInterval(this.cardanoAdaAppPollingInterval);
  };
}