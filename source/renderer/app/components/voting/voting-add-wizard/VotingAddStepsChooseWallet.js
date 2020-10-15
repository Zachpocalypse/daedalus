// @flow
import React, { Component } from 'react';
import { defineMessages, intlShape, FormattedHTMLMessage } from 'react-intl';
import classNames from 'classnames';
import commonStyles from './VotingAddSteps.scss';
import styles from './VotingAddStepsChooseWallet.scss';
import WalletsDropdown from '../../widgets/forms/WalletsDropdown';
import Wallet from '../../../domains/Wallet';
import { Button } from 'react-polymorph/lib/components/Button';
import { ButtonSkin } from 'react-polymorph/lib/skins/simple/ButtonSkin';

const messages = defineMessages({
  description: {
    id: 'voting.votingAdd.chooseWallet.step.description',
    defaultMessage:
      '!!!For  <span>fund 2</span> voting you will be able to use only one wallet to register.',
    description: 'Description on the voting add "choose wallet" step.',
  },
  selectWalletInputLabel: {
    id: 'voting.votingAdd.chooseWallet.step.selectWalletInputLabel',
    defaultMessage: '!!!Select wallet',
    description:
      'Label "Wallet" for select input on thevoting add "choose wallet" step.',
  },
  selectWalletInputPlaceholder: {
    id: 'voting.votingAdd.chooseWallet.step.selectWalletInputPlaceholder',
    defaultMessage: '!!!Select Wallet',
    description:
      'Placeholder "Select Wallet" for select input on the voting add "choose wallet" step.',
  },
  errorMinVotingFunds: {
    id: 'voting.votingAdd.chooseWallet.step.errorMinVotingFunds',
    defaultMessage:
      '!!!This wallet does not contain the minimum amount of {minVotingFunds} ADA which is required for voting to be available. Please select a wallet with <span>a minimum amount of {minVotingFunds} ADA</span> and click continue.',
    description:
      'errorMinVotingFunds Error Label on the voting add "choose wallet" step.',
  },
  errorMinVotingFundsRewardsOnly: {
    id: 'voting.votingAdd.chooseWallet.step.errorMinVotingFundsRewardsOnly',
    defaultMessage:
      '!!!This wallet contains only rewards balances so it cannot be voting.',
    description:
      'errorMinVotingFundsRewardsOnly Error Label on the voting add "choose wallet" step.',
  },
  errorRestoringWallet: {
    id: 'voting.votingAdd.chooseWallet.step.errorRestoringWallet',
    defaultMessage:
      '!!!This wallet can’t be used for voting while it’s being synced.',
    description:
      'RestoringWallet Error Label on the voting add "choose wallet" step.',
  },
  continueButtonLabel: {
    id: 'voting.votingAdd.chooseWallet.step.continueButtonLabel',
    defaultMessage: '!!!Continue',
    description:
      'Label for continue button on the voting add "choose wallet" step.',
  },
});

type Props = {
  numberOfStakePools: number,
  onSelectWallet: Function,
  onContinue: Function,
  wallets: Array<Wallet>,
  minVotingFunds: number,
  selectedWalletId: ?string,
  isWalletAcceptable: Function,
  getStakePoolById: Function,
};

type State = {
  selectedWalletId: ?string,
};

export default class VotingAddStepsChooseWallet extends Component<
  Props,
  State
> {
  static contextTypes = {
    intl: intlShape.isRequired,
  };

  state = {
    selectedWalletId: this.props.selectedWalletId,
  };

  onWalletChange = (selectedWalletId: string) => {
    this.setState({ selectedWalletId });
  };

  onSelectWallet = () => {
    const { selectedWalletId } = this.state;
    this.props.onSelectWallet(selectedWalletId);
  };

  onSubmit = () => {
    this.props.onContinue();
    this.onSelectWallet();
  };

  render() {
    const { intl } = this.context;
    const { selectedWalletId } = this.state;
    const {
      wallets,
      minVotingFunds,
      isWalletAcceptable,
      numberOfStakePools,
      getStakePoolById,
    } = this.props;

    const buttonLabel = intl.formatMessage(messages.continueButtonLabel);

    const selectedWallet: ?Wallet = wallets.find(
      (wallet: Wallet) => wallet && wallet.id === selectedWalletId
    );

    const { amount, reward, isRestoring } = selectedWallet || {};

    let errorMessage;
    if (selectedWallet && !isWalletAcceptable(amount, reward)) {
      // Wallet is restoring
      if (isRestoring) errorMessage = messages.errorRestoringWallet;
      // Wallet only has Reward balance
      else if (!amount.isZero() && amount.equals(reward))
        errorMessage = messages.errorMinVotingFundsRewardsOnly;
      // Wallet balance < min delegation funds
      else errorMessage = messages.errorMinVotingFunds;
    }

    const error = errorMessage && (
      <p className={styles.errorMessage}>
        <FormattedHTMLMessage {...errorMessage} values={{ minVotingFunds }} />
      </p>
    );

    const className = classNames([
      commonStyles.votingAddSteps,
      styles.votingAddStepsChooseWalletWrapper,
    ]);

    const contentClassName = classNames([commonStyles.content, styles.content]);

    const walletSelectClasses = classNames([
      styles.walletSelect,
      error ? styles.error : null,
    ]);

    return (
      <div className={className}>
        <div className={contentClassName}>
          <p className={styles.description}>
            <FormattedHTMLMessage {...messages.description} />
          </p>
          <WalletsDropdown
            className={walletSelectClasses}
            label={intl.formatMessage(messages.selectWalletInputLabel)}
            numberOfStakePools={numberOfStakePools}
            wallets={wallets}
            onChange={(walletId: string) => this.onWalletChange(walletId)}
            placeholder={intl.formatMessage(
              messages.selectWalletInputPlaceholder
            )}
            value={selectedWalletId}
            getStakePoolById={getStakePoolById}
          />
          {error}
        </div>
        <Button
          label={buttonLabel}
          onClick={this.onSubmit}
          disabled={!selectedWalletId || !!error}
          skin={ButtonSkin}
        />
      </div>
    );
  }
}