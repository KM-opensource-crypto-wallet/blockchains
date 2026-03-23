let _showToast = () => {};

/**
 * Register the platform-specific showToast implementation.
 * Call this once at app startup before using any chain methods.
 *
 * React Native:
 *   import Toast from 'react-native-toast-message';
 *   import {registerShowToast} from 'dok-wallet-blockchain-networks/helper/toast';
 *   registerShowToast(({type, props, visibilityTime, autoHide}) =>
 *     Toast.show({type, props, visibilityTime, autoHide}),
 *   );
 *
 * Web:
 *   import {showToast as webShowToast} from 'utils/toast';
 *   import {registerShowToast} from 'dok-wallet-blockchain-networks/helper/toast';
 *   registerShowToast(webShowToast);
 */
export const registerShowToast = fn => {
  _showToast = fn;
};

export const showToast = (...args) => _showToast(...args);
