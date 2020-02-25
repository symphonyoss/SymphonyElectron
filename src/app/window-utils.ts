import * as electron from 'electron';
import { app, BrowserWindow, CertificateVerifyProcRequest, nativeImage } from 'electron';
import fetch from 'electron-fetch';
import * as filesize from 'filesize';
import * as fs from 'fs';
import * as path from 'path';
import { format, parse } from 'url';
import { apiName } from '../common/api-interface';

import { isDevEnv, isLinux, isMac } from '../common/env';
import { i18n, LocaleType } from '../common/i18n';
import { logger } from '../common/logger';
import { getGuid } from '../common/utils';
import { whitelistHandler } from '../common/whitelist-handler';
import { autoLaunchInstance } from './auto-launch-controller';
import { CloudConfigDataTypes, config, IConfig, ICustomRectangle } from './config-handler';
import { memoryMonitor } from './memory-monitor';
import { screenSnippet } from './screen-snippet-handler';
import { updateAlwaysOnTop } from './window-actions';
import { ICustomBrowserWindow, windowHandler } from './window-handler';

interface IStyles {
    name: styleNames;
    content: string;
}

enum styleNames {
    titleBar = 'title-bar',
    snackBar = 'snack-bar',
    messageBanner = 'message-banner',
}

const checkValidWindow = true;
const { url: configUrl } = config.getGlobalConfigFields([ 'url' ]);
const { ctWhitelist } = config.getConfigFields([ 'ctWhitelist' ]);

// Network status check variables
const networkStatusCheckInterval = 10 * 1000;
let networkStatusCheckIntervalId;
let isNetworkMonitorInitialized = false;

const styles: IStyles[] = [];
const DOWNLOAD_MANAGER_NAMESPACE = 'DownloadManager';

/**
 * Checks if window is valid and exists
 *
 * @param window {BrowserWindow}
 * @return boolean
 */
export const windowExists = (window: BrowserWindow): boolean => !!window && typeof window.isDestroyed === 'function' && !window.isDestroyed();

/**
 * Prevents window from navigating
 *
 * @param browserWindow
 * @param isPopOutWindow
 */
export const preventWindowNavigation = (browserWindow: BrowserWindow, isPopOutWindow: boolean = false): void => {
    if (!browserWindow || !windowExists(browserWindow)) {
        return;
    }
    logger.info(`window-utils: preventing window from navigating!`);

    const listener = (e: Electron.Event, winUrl: string) => {
        if (!winUrl.startsWith('http' || 'https')) {
            logger.info(`window-utils: ${winUrl} doesn't start with http or https, so, not navigating!`);
            e.preventDefault();
            return;
        }

        if (!isPopOutWindow) {
            const isValid = whitelistHandler.isWhitelisted(winUrl);
            if (!isValid) {
                e.preventDefault();
                if (browserWindow && windowExists(browserWindow)) {
                    // @ts-ignore
                    electron.dialog.showMessageBox(browserWindow, {
                        type: 'warning',
                        buttons: [ 'OK' ],
                        title: i18n.t('Not Allowed')(),
                        message: `${i18n.t(`Sorry, you are not allowed to access this website`)} (${winUrl}), ${i18n.t('please contact your administrator for more details')}`,
                    });
                }
            }
        }

        if (browserWindow.isDestroyed()
            || browserWindow.webContents.isDestroyed()
            || winUrl === browserWindow.webContents.getURL()) {
            return;
        }

        e.preventDefault();
    };

    browserWindow.webContents.on('will-navigate', listener);

    browserWindow.once('close', () => {
        browserWindow.webContents.removeListener('will-navigate', listener);
    });
};

/**
 * Creates components windows
 *
 * @param componentName
 * @param opts
 * @param shouldFocus {boolean}
 */
export const createComponentWindow = (
    componentName: string,
    opts?: Electron.BrowserWindowConstructorOptions,
    shouldFocus: boolean = true,
): BrowserWindow => {

    const options: Electron.BrowserWindowConstructorOptions = {
        center: true,
        height: 300,
        maximizable: false,
        minimizable: false,
        resizable: false,
        show: false,
        width: 300,
        ...opts,
        webPreferences: {
            preload: path.join(__dirname, '../renderer/_preload-component.js'),
            devTools: false,
        },
    };

    const browserWindow: ICustomBrowserWindow = new BrowserWindow(options) as ICustomBrowserWindow;
    if (shouldFocus) {
        browserWindow.once('ready-to-show', () => {
            if (!browserWindow || !windowExists(browserWindow)) {
                return;
            }
            browserWindow.show();
        });
    }
    browserWindow.webContents.once('did-finish-load', () => {
        if (!browserWindow || !windowExists(browserWindow)) {
            return;
        }
        browserWindow.webContents.send('page-load', { locale: i18n.getLocale(), resource: i18n.loadedResources });
    });
    browserWindow.setMenu(null as any);

    const targetUrl = format({
        pathname: require.resolve('../renderer/react-window.html'),
        protocol: 'file',
        query: {
            componentName,
            locale: i18n.getLocale(),
        },
        slashes: true,
    });

    browserWindow.loadURL(targetUrl);
    preventWindowNavigation(browserWindow);
    return browserWindow;
};

/**
 * Shows the badge count
 *
 * @param count {number}
 */
export const showBadgeCount = (count: number): void => {
    if (typeof count !== 'number') {
        logger.warn(`window-utils: badgeCount: invalid func arg, must be a number: ${count}`);
        return;
    }

    logger.info(`window-utils: updating badge count to ${count}!`);

    if (isMac || isLinux) {
        // too big of a number here and setBadgeCount crashes
        app.setBadgeCount(Math.min(1e8, count));
        return;
    }

    // handle ms windows...
    const mainWindow = windowHandler.getMainWindow();
    if (!mainWindow || !windowExists(mainWindow)) {
        return;
    }

    // get badge img from renderer process, will return
    // img dataUrl in setDataUrl func.
    if (count > 0) {
        mainWindow.webContents.send('create-badge-data-url', { count });
        return;
    }

    // clear badge count icon
    mainWindow.setOverlayIcon(null, '');
};

/**
 * Sets the data url
 *
 * @param dataUrl
 * @param count
 */
export const setDataUrl = (dataUrl: string, count: number): void => {
    const mainWindow = windowHandler.getMainWindow();
    if (mainWindow && dataUrl && count) {
        const img = nativeImage.createFromDataURL(dataUrl);
        // for accessibility screen readers
        const desc = 'Symphony has ' + count + ' unread messages';
        mainWindow.setOverlayIcon(img, desc);
    }
};

/**
 * Ensure events comes from a window that we have created.
 *
 * @param  {BrowserWindow} browserWin  node emitter event to be tested
 * @return {Boolean} returns true if exists otherwise false
 */
export const isValidWindow = (browserWin: Electron.BrowserWindow): boolean => {
    if (!checkValidWindow) {
        return true;
    }
    let result: boolean = false;
    if (browserWin && !browserWin.isDestroyed()) {
        // @ts-ignore
        const winKey = browserWin.webContents.browserWindowOptions && browserWin.webContents.browserWindowOptions.winKey;
        result = windowHandler.hasWindow(winKey, browserWin);
    }

    if (!result) {
        logger.warn(`window-utils: invalid window try to perform action, ignoring action`);
    }

    return result;
};

/**
 * Updates the locale and rebuilds the entire application menu
 *
 * @param locale {LocaleType}
 */
export const updateLocale = async (locale: LocaleType): Promise<void> => {
    logger.info(`window-utils: updating locale to ${locale}!`);
    // sets the new locale
    i18n.setLocale(locale);
    const appMenu = windowHandler.appMenu;
    if (appMenu) {
        logger.info(`window-utils: updating app menu with locale ${locale}!`);
        appMenu.update(locale);
    }

    if (i18n.isValidLocale(locale)) {
        // Update user config file with latest locale changes
        await config.updateUserConfig({ locale });
    }
};

/**
 * Displays a popup menu
 */
export const showPopupMenu = (opts: Electron.PopupOptions): void => {
    const mainWindow = windowHandler.getMainWindow();
    if (mainWindow && windowExists(mainWindow) && isValidWindow(mainWindow)) {
        const coordinates = windowHandler.isCustomTitleBar ? { x: 20, y: 15 } : { x: 10, y: -20 };
        const { x, y } = mainWindow.isFullScreen() ? { x: 0, y: 0 } : coordinates;
        const popupOpts = { window: mainWindow, x, y };
        const appMenu = windowHandler.appMenu;
        if (appMenu) {
            appMenu.popupMenu({ ...popupOpts, ...opts });
        }
    }
};

/**
 * Method that is invoked when the application is reloaded/navigated
 * window.addEventListener('beforeunload')
 *
 * @param windowName {string}
 */
export const sanitize = async (windowName: string): Promise<void> => {
    // To make sure the reload event is from the main window
    const mainWindow = windowHandler.getMainWindow();
    if (mainWindow && windowName === mainWindow.winName) {
        // reset the badge count whenever an user refreshes the electron client
        showBadgeCount(0);

        // Terminates the screen snippet process on reload
        if (!isMac || !isLinux) {
            screenSnippet.killChildProcess();
        }
        // Closes all the child windows
        await windowHandler.closeAllWindow();
    }
};

/**
 * Returns the config stored rectangle if it is contained within the workArea of at
 * least one of the screens else returns the default rectangle value with out x, y
 * as the default is to center the window
 *
 * @param winPos {Electron.Rectangle}
 * @param defaultWidth
 * @param defaultHeight
 * @return {x?: Number, y?: Number, width: Number, height: Number}
 */
export const getBounds = (winPos: ICustomRectangle | Electron.Rectangle | undefined, defaultWidth: number, defaultHeight: number): Partial<Electron.Rectangle> => {
    logger.info('window-utils: getBounds, winPos: ' + JSON.stringify(winPos));

    if (!winPos || !winPos.x || !winPos.y || !winPos.width || !winPos.height) {
        return { width: defaultWidth, height: defaultHeight };
    }
    const displays = electron.screen.getAllDisplays();

    for (let i = 0, len = displays.length; i < len; i++) {
        const bounds = displays[ i ].bounds;
        logger.info('window-utils: getBounds, bounds: ' + JSON.stringify(bounds));
        if (winPos.x >= bounds.x && winPos.y >= bounds.y &&
            ((winPos.x + winPos.width) <= (bounds.x + bounds.width)) &&
            ((winPos.y + winPos.height) <= (bounds.y + bounds.height))) {
            return winPos;
        }
    }

    // Fit in the middle of immediate display
    const display = electron.screen.getDisplayMatching(winPos as electron.Rectangle);

    if (display) {
        // Check that defaultWidth fits
        let windowWidth = defaultWidth;
        if (display.workArea.width < defaultWidth) {
            windowWidth = display.workArea.width;
        }

        // Check that defaultHeight fits
        let windowHeight = defaultHeight;
        if (display.workArea.height < defaultHeight) {
            windowHeight = display.workArea.height;
        }

        const windowX = display.workArea.x + display.workArea.width / 2 - windowWidth / 2;
        const windowY = display.workArea.y + display.workArea.height / 2 - windowHeight / 2;

        return { x: windowX, y: windowY, width: windowWidth, height: windowHeight };
    }

    return { width: defaultWidth, height: defaultHeight };
};

/**
 * Open downloaded file
 * @param type
 * @param filePath
 */
export const downloadManagerAction = (type, filePath): void => {
    const focusedWindow = electron.BrowserWindow.getFocusedWindow();
    const message = i18n.t('The file you are trying to open cannot be found in the specified path.', DOWNLOAD_MANAGER_NAMESPACE)();
    const title = i18n.t('File not Found', DOWNLOAD_MANAGER_NAMESPACE)();

    if (!focusedWindow || !windowExists(focusedWindow)) {
        return;
    }

    if (type === 'open') {
        let openResponse = fs.existsSync(`${filePath}`);
        if (openResponse) {
            openResponse = electron.shell.openItem(`${filePath}`);
        }
        if (!openResponse && focusedWindow && !focusedWindow.isDestroyed()) {
            electron.dialog.showMessageBox(focusedWindow, {
                message,
                title,
                type: 'error',
            });
        }
        return;
    }
    if (fs.existsSync(filePath)) {
        electron.shell.showItemInFolder(filePath);
    } else {
        electron.dialog.showMessageBox(focusedWindow, {
            message,
            title,
            type: 'error',
        });
    }
};

/**
 * Displays a UI with downloaded file similar to chrome
 * Invoked by webContents session's will-download event
 *
 * @param _event
 * @param item {Electron.DownloadItem}
 * @param webContents {Electron.WebContents}
 */
export const handleDownloadManager = (_event, item: Electron.DownloadItem, webContents: Electron.WebContents) => {
    // Send file path when download is complete
    item.once('done', (_e, state) => {
        if (state === 'completed') {
            const data = {
                _id: getGuid(),
                savedPath: item.getSavePath() || '',
                total: filesize(item.getTotalBytes() || 0),
                fileName: item.getFilename() || 'No name',
            };
            webContents.send('downloadCompleted', data);
        }
    });
};

/**
 * Inserts css in to the window
 *
 * @param window {BrowserWindow}
 */
const readAndInsertCSS = async (window): Promise<IStyles[] | void> => {
    if (window && windowExists(window)) {
        return styles.map(({ content }) => window.webContents.insertCSS(content));
    }
};

/**
 * Inserts all the required css on to the specified windows
 *
 * @param mainWindow {BrowserWindow}
 * @param isCustomTitleBar {boolean} - whether custom title bar enabled
 */
export const injectStyles = async (mainWindow: BrowserWindow, isCustomTitleBar: boolean): Promise<IStyles[] | void> => {
    if (isCustomTitleBar) {
        const index = styles.findIndex(({ name }) => name === styleNames.titleBar);
        if (index === -1) {
            let titleBarStylesPath;
            const stylesFileName = path.join('config', 'titleBarStyles.css');
            if (isDevEnv) {
                titleBarStylesPath = path.join(app.getAppPath(), stylesFileName);
            } else {
                const execPath = path.dirname(app.getPath('exe'));
                titleBarStylesPath = path.join(execPath, stylesFileName);
            }
            // Window custom title bar styles
            if (fs.existsSync(titleBarStylesPath)) {
                styles.push({ name: styleNames.titleBar, content: fs.readFileSync(titleBarStylesPath, 'utf8').toString() });
            } else {
                const stylePath = path.join(__dirname, '..', '/renderer/styles/title-bar.css');
                styles.push({ name: styleNames.titleBar, content: fs.readFileSync(stylePath, 'utf8').toString() });
            }
        }
    }
    // Snack bar styles
    if (styles.findIndex(({ name }) => name === styleNames.snackBar) === -1) {
        styles.push({
            name: styleNames.snackBar,
            content: fs.readFileSync(path.join(__dirname, '..', '/renderer/styles/snack-bar.css'), 'utf8').toString(),
        });
    }

    // Banner styles
    if (styles.findIndex(({ name }) => name === styleNames.messageBanner) === -1) {
        styles.push({
            name: styleNames.messageBanner,
            content: fs.readFileSync(path.join(__dirname, '..', '/renderer/styles/message-banner.css'), 'utf8').toString(),
        });
    }

    return await readAndInsertCSS(mainWindow);
};

/**
 * Proxy verification for root certificates
 *
 * @param request {CertificateVerifyProcRequest}
 * @param callback {(verificationResult: number) => void}
 */
export const handleCertificateProxyVerification = (
    request: CertificateVerifyProcRequest,
    callback: (verificationResult: number) => void,
): void => {
    const { hostname: hostUrl, errorCode } = request;

    if (errorCode === 0) {
        return callback(0);
    }

    const { tld, domain } = whitelistHandler.parseDomain(hostUrl);
    const host = domain + tld;

    if (ctWhitelist && Array.isArray(ctWhitelist) && ctWhitelist.length > 0 && ctWhitelist.indexOf(host) > -1) {
        return callback(0);
    }

    return callback(-2);
};

/**
 * Validates the network by fetching the pod url
 * every 10sec, on active reloads the given window
 *
 * @param window {ICustomBrowserWindow}
 */
export const isSymphonyReachable = (window: ICustomBrowserWindow | null) => {
    if (networkStatusCheckIntervalId) {
        return;
    }
    if (!window || !windowExists(window)) {
        return;
    }
    networkStatusCheckIntervalId = setInterval(() => {
        const { hostname, protocol } = parse(configUrl);
        if (!hostname || !protocol) {
            return;
        }
        const podUrl = `${protocol}//${hostname}`;
        logger.info(`window-utils: checking to see if pod ${podUrl} is reachable!`);
        fetch(podUrl, { method: 'GET' }).then((rsp) => {
            if (rsp.status === 200 && windowHandler.isOnline) {
                logger.info(`window-utils: pod ${podUrl} is reachable, loading main window!`);
                window.loadURL(podUrl);
                if (networkStatusCheckIntervalId) {
                    clearInterval(networkStatusCheckIntervalId);
                    networkStatusCheckIntervalId = null;
                }
                return;
            }
            logger.warn(`window-utils: POD is down! statusCode: ${rsp.status}, is online: ${windowHandler.isOnline}`);
        }).catch((error) => {
            logger.error(`window-utils: Network status check: No active network connection ${error}`);
        });
    }, networkStatusCheckInterval);
};

/**
 * Refreshes/Restarts the window based on type
 *
 * @param browserWindow {ICustomBrowserWindow}
 */
export const reloadWindow = (browserWindow: ICustomBrowserWindow) => {
    if (!browserWindow || !windowExists(browserWindow)) {
        return;
    }

    const windowName = browserWindow.winName;
    const mainWindow = windowHandler.getMainWindow();
    // reload the main window
    if (windowName === apiName.mainWindowName) {
        logger.info(`window-utils: reloading the main window`);
        browserWindow.reload();
        return;
    }
    // Send an event to SFE that restarts the pop-out window
    if (mainWindow && windowExists(mainWindow)) {
        logger.info(`window-handler: reloading the window`, { windowName });
        const bounds = browserWindow.getBounds();
        mainWindow.webContents.send('restart-floater', { windowName, bounds });
    }
};

/**
 * Verifies if window exists and restores/focuses the window
 *
 * @param browserWindow {ICustomBrowserWindow}
 */
export const didVerifyAndRestoreWindow = (browserWindow: BrowserWindow | null): boolean => {
    if (!browserWindow || !windowExists(browserWindow)) {
        return false;
    }
    if (browserWindow.isMinimized()) {
        browserWindow.restore();
    }
    browserWindow.focus();
    return true;
};

/**
 * Finds and returns a specific window by name
 *
 * @param windowName {String}
 */
export const getWindowByName = (windowName: string): BrowserWindow | undefined => {
    const allWindows = BrowserWindow.getAllWindows();
    return allWindows.find((window) => {
        return (window as ICustomBrowserWindow).winName === windowName;
    });
};

export const updateFeaturesForCloudConfig = async (): Promise<void> => {
    const {
        alwaysOnTop: isAlwaysOnTop,
        launchOnStartup,
        memoryRefresh,
        memoryThreshold,
    } = config.getConfigFields([
        'launchOnStartup',
        'alwaysOnTop',
        'memoryRefresh',
        'memoryThreshold',
    ]) as IConfig;

    const mainWindow = windowHandler.getMainWindow();

    // Update Always on top feature
    await updateAlwaysOnTop(isAlwaysOnTop === CloudConfigDataTypes.ENABLED, false, false);

    // Update launch on start up
    launchOnStartup === CloudConfigDataTypes.ENABLED ? autoLaunchInstance.enableAutoLaunch() : autoLaunchInstance.disableAutoLaunch();

    if (mainWindow && windowExists(mainWindow)) {
        if (memoryRefresh) {
            logger.info(`window-utils: updating the memory threshold`, memoryThreshold);
            memoryMonitor.setMemoryThreshold(parseInt(memoryThreshold, 10));
            mainWindow.webContents.send('initialize-memory-refresh');
        }
    }
};

/**
 * Monitors network requests and displays red banner on failure
 */
export const monitorNetworkInterception = () => {
    if (isNetworkMonitorInitialized) {
        return;
    }
    const { url } = config.getGlobalConfigFields( [ 'url' ] );
    const { hostname, protocol } = parse(url);

    if (!hostname || !protocol) {
        return;
    }

    const mainWindow = windowHandler.getMainWindow();
    const podUrl = `${protocol}//${hostname}/`;
    logger.info('window-utils: monitoring network interception for url', podUrl);

    // Filter applied w.r.t pod url
    const filter = { urls: [ podUrl + '*' ] };

    if (mainWindow && windowExists(mainWindow)) {
        isNetworkMonitorInitialized = true;
        mainWindow.webContents.session.webRequest.onErrorOccurred(filter,(details) => {
            if (!mainWindow || !windowExists(mainWindow)) {
                return;
            }
            if (windowHandler.isWebPageLoading
                && details.error === 'net::ERR_INTERNET_DISCONNECTED'
                || details.error === 'net::ERR_NETWORK_CHANGED'
                || details.error === 'net::ERR_NAME_NOT_RESOLVED') {

                logger.error(`window-utils: URL failed to load`, details);
                mainWindow.webContents.send('show-banner', { show: true, bannerType: 'error', url: podUrl });
            }
        });
    }
};
