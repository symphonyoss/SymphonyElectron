import { ipcRenderer } from 'electron';
import * as React from 'react';
import { i18n } from '../../common/i18n-preload';

interface IState {
    url: string;
    message: string;
    urlValid: boolean;
}

const WELCOME_NAMESPACE = 'Welcome';

export default class Welcome extends React.Component<{}, IState> {

    private readonly eventHandlers = {
        onSetPodUrl: () => this.setPodUrl(),
    };

    constructor(props) {
        super(props);
        this.state = {
            url: 'https://my.symphony.com',
            message: '',
            urlValid: false,
        };
        this.updateState = this.updateState.bind(this);
    }

    /**
     * Render the component
     */
    public render(): JSX.Element {
        const { url, message } = this.state;
        return (
            <div className='Welcome' lang={i18n.getLocale()}>
                <div className='Welcome-image-container'>
                    <img
                        src='../renderer/assets/symphony-logo-plain.png'
                        alt={i18n.t('Symphony Logo', WELCOME_NAMESPACE)()}
                    />
                </div>
                <div className='Welcome-main-container'>
                    <h3 className='Welcome-name'>Pod URL</h3>
                    <input type='url' placeholder={url}
                           pattern='https?://.+'
                           required
                           onChange={this.updatePodUrl.bind(this)}/>
                    <label className='Welcome-message-label'>{message}</label>
                    <button className='Welcome-continue-button'
                            onClick={this.eventHandlers.onSetPodUrl}>
                        {i18n.t('Continue', WELCOME_NAMESPACE)()}
                    </button>
                </div>
            </div>
        );
    }

    /**
     * Perform actions on component being mounted
     */
    public componentDidMount(): void {
        ipcRenderer.on('welcome', this.updateState);
    }

    /**
     * Perform actions on component being unmounted
     */
    public componentWillUnmount(): void {
        ipcRenderer.removeListener('welcome', this.updateState);
    }

    /**
     * Set pod url and pass it to the main process
     */
    public setPodUrl(): void {
        const { url, urlValid } = this.state;
        if (!urlValid) {
            return;
        }
        ipcRenderer.send('set-pod-url', url);
    }

    /**
     * Update pod url from the text box
     * @param _event
     */
    public updatePodUrl(_event): void {
        const url = _event.target.value;
        const match = url.match(/(https?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&/=]*)/g) != null;
        if (!match) {
            this.updateState(_event, { url: this.state.url, message: 'Please enter a valid url', urlValid: false });
            return;
        }
        this.updateState(_event, { url, message: '', urlValid: true });
    }

    /**
     * Update state
     * @param _event
     * @param data
     */
    private updateState(_event, data): void {
        this.setState(data as IState);
    }

}
