import { app, BrowserWindow, ipcMain } from 'electron';

import {
  analytics,
  AnalyticsElements,
  ToastNotificationActionTypes,
} from '../app/analytics-handler';
import { config } from '../app/config-handler';
import { createComponentWindow, windowExists } from '../app/window-utils';
import { AnimationQueue } from '../common/animation-queue';
import {
  apiName,
  INotificationData,
  NOTIFICATION_WINDOW_TITLE,
  NotificationActions,
} from '../common/api-interface';
import { isNodeEnv, isWindowsOS } from '../common/env';
import { logger } from '../common/logger';
import NotificationHandler from './notification-handler';

const CLEAN_UP_INTERVAL = 60 * 1000; // Closes inactive notification
const animationQueue = new AnimationQueue();
const CONTAINER_HEIGHT_WITH_INPUT = 120; // Notification container height

interface ICustomBrowserWindow extends Electron.BrowserWindow {
  winName: string;
  notificationData: INotificationData;
  displayTimer: NodeJS.Timer;
  clientId: number;
}

type startCorner = 'upper-right' | 'upper-left' | 'lower-right' | 'lower-left';

const notificationSettings = {
  startCorner: 'upper-right' as startCorner,
  display: '',
  width: 344,
  height: 88,
  totalHeight: 0,
  totalWidth: 0,
  corner: {
    x: 0,
    y: 0,
  },
  firstPos: {
    x: 0,
    y: 0,
  },
  templatePath: '',
  maxVisibleNotifications: 6,
  borderRadius: 8,
  displayTime: 5000,
  animationSteps: 5,
  animationStepMs: 5,
  logging: true,
  spacing: 8,
  differentialHeight: 32,
};

class Notification extends NotificationHandler {
  private readonly funcHandlers = {
    onCleanUpInactiveNotification: () => this.cleanUpInactiveNotification(),
    onCreateNotificationWindow: (data: INotificationData) =>
      this.createNotificationWindow(data),
    onMouseOver: (_event, windowId) => this.onMouseOver(windowId),
    onMouseLeave: (_event, windowId, isInputHidden) =>
      this.onMouseLeave(windowId, isInputHidden),
    onShowReply: (_event, windowId) => this.onShowReply(windowId),
  };
  private activeNotifications: ICustomBrowserWindow[] = [];
  private inactiveWindows: ICustomBrowserWindow[] = [];
  private cleanUpTimer: NodeJS.Timer;
  private notificationQueue: INotificationData[] = [];

  private readonly notificationCallbacks: any[] = [];

  constructor(opts) {
    super(opts);
    ipcMain.on('close-notification', (_event, windowId) => {
      const browserWindow = this.getNotificationWindow(windowId);
      if (
        browserWindow &&
        windowExists(browserWindow) &&
        browserWindow.notificationData
      ) {
        const notificationData = (browserWindow.notificationData as any).data;
        analytics.track({
          element: AnalyticsElements.TOAST_NOTIFICATION,
          action_type: ToastNotificationActionTypes.TOAST_CLOSED,
          extra_data: notificationData || {},
        });
      }
      // removes the event listeners on the client side
      this.notificationClosed(windowId);
      this.hideNotification(windowId);
    });

    ipcMain.on('notification-clicked', (_event, windowId) => {
      this.notificationClicked(windowId);
    });
    ipcMain.on('notification-mouseenter', this.funcHandlers.onMouseOver);
    ipcMain.on('notification-mouseleave', this.funcHandlers.onMouseLeave);
    ipcMain.on('notification-on-reply', (_event, windowId, replyText) => {
      this.onNotificationReply(windowId, replyText);
    });
    ipcMain.on('show-reply', this.funcHandlers.onShowReply);
    // Update latest notification settings from config
    app.on('ready', () => this.updateNotificationSettings());
    this.cleanUpTimer = setInterval(
      this.funcHandlers.onCleanUpInactiveNotification,
      CLEAN_UP_INTERVAL,
    );
  }

  /**
   * Displays a new notification
   *
   * @param data
   * @param callback
   */
  public showNotification(data: INotificationData, callback): void {
    clearInterval(this.cleanUpTimer);
    animationQueue.push({
      func: this.funcHandlers.onCreateNotificationWindow,
      args: [data],
    });
    this.notificationCallbacks[data.id] = callback;
    this.cleanUpTimer = setInterval(
      this.funcHandlers.onCleanUpInactiveNotification,
      CLEAN_UP_INTERVAL,
    );
  }

  /**
   * Creates a new notification window
   *
   * @param data
   */
  public async createNotificationWindow(
    data,
  ): Promise<ICustomBrowserWindow | undefined> {
    // TODO: Handle MAX_QUEUE_SIZE
    if (data.tag) {
      for (let i = 0; i < this.notificationQueue.length; i++) {
        if (this.notificationQueue[i].tag === data.tag) {
          this.notificationQueue[i] = data;
          return;
        }
      }

      for (const window of this.activeNotifications) {
        const winHeight = windowExists(window) && window.getBounds().height;
        if (
          window &&
          window.notificationData.tag === data.tag &&
          winHeight < CONTAINER_HEIGHT_WITH_INPUT
        ) {
          this.setNotificationContent(window, data);
          return;
        }
      }
    }

    // Checks if number of active notification displayed is greater than or equal to the
    // max displayable notification and queues them
    if (
      this.activeNotifications.length >= this.settings.maxVisibleNotifications
    ) {
      this.notificationQueue.push(data);
      return;
    }

    // Checks for the cashed window and use them
    if (this.inactiveWindows.length > 0) {
      const inactiveWin = this.inactiveWindows[0];
      if (windowExists(inactiveWin)) {
        this.inactiveWindows.splice(0, 1);
        this.renderNotification(inactiveWin, data);
        return;
      }
    }

    const notificationWindow = createComponentWindow(
      'notification-comp',
      this.getNotificationOpts(),
      false,
    ) as ICustomBrowserWindow;

    notificationWindow.notificationData = data;
    notificationWindow.winName = apiName.notificationWindowName;
    notificationWindow.once('closed', () => {
      const activeWindowIndex = this.activeNotifications.indexOf(
        notificationWindow,
      );
      const inactiveWindowIndex = this.inactiveWindows.indexOf(
        notificationWindow,
      );

      if (activeWindowIndex !== -1) {
        this.activeNotifications.splice(activeWindowIndex, 1);
      }

      if (inactiveWindowIndex !== -1) {
        this.inactiveWindows.splice(inactiveWindowIndex, 1);
      }
    });

    // This is a workaround to fix an issue with electron framework
    // https://github.com/electron/electron/issues/611
    notificationWindow.on('resize', (event) => {
      event.preventDefault();
    });

    await this.didFinishLoad(notificationWindow, data);
    return;
  }

  /**
   * Sets the notification contents
   *
   * @param notificationWindow
   * @param data {INotificationData}
   */
  public setNotificationContent(
    notificationWindow: ICustomBrowserWindow,
    data: INotificationData,
  ): void {
    notificationWindow.clientId = data.id;
    notificationWindow.notificationData = data;
    const displayTime = data.displayTime
      ? data.displayTime
      : notificationSettings.displayTime;
    let timeoutId;

    // Reset the display timer
    if (notificationWindow.displayTimer) {
      clearTimeout(notificationWindow.displayTimer);
    }
    // Reset notification window size to default
    notificationWindow.setSize(
      notificationSettings.width,
      notificationSettings.height,
      true,
    );
    // Move notification to top
    notificationWindow.moveTop();

    if (!data.sticky) {
      timeoutId = setTimeout(async () => {
        await this.hideNotification(notificationWindow.clientId);
      }, displayTime);
      notificationWindow.displayTimer = timeoutId;
    }

    const {
      title,
      company,
      body,
      image,
      icon,
      id,
      color,
      flash,
      isExternal,
      theme,
      hasReply,
    } = data;

    notificationWindow.webContents.send('notification-data', {
      title,
      company,
      body,
      image,
      icon,
      id,
      color,
      flash,
      isExternal,
      theme,
      hasReply,
    });
    notificationWindow.showInactive();
  }

  /**
   * Hides the notification window
   *
   * @param clientId
   */
  public async hideNotification(clientId: number): Promise<void> {
    const browserWindow = this.getNotificationWindow(clientId);
    if (browserWindow && windowExists(browserWindow)) {
      const [, height] = browserWindow.getSize();
      // send empty to reset the state
      const pos = this.activeNotifications.indexOf(browserWindow);
      this.activeNotifications.splice(pos, 1);

      if (
        this.inactiveWindows.length < this.settings.maxVisibleNotifications ||
        5
      ) {
        this.inactiveWindows.push(browserWindow);
        browserWindow.hide();
      } else {
        browserWindow.close();
      }

      this.moveNotificationDown(pos, this.activeNotifications, height);

      if (
        this.notificationQueue.length > 0 &&
        this.activeNotifications.length < this.settings.maxVisibleNotifications
      ) {
        const notificationData = this.notificationQueue[0];
        this.notificationQueue.splice(0, 1);
        animationQueue.push({
          func: this.funcHandlers.onCreateNotificationWindow,
          args: [notificationData],
        });
      }
    }
    return;
  }

  /**
   * Handles notification click
   *
   * @param clientId {number}
   */
  public notificationClicked(clientId): void {
    const browserWindow = this.getNotificationWindow(clientId);
    if (
      browserWindow &&
      windowExists(browserWindow) &&
      browserWindow.notificationData
    ) {
      const data = browserWindow.notificationData;
      const callback = this.notificationCallbacks[clientId];
      if (typeof callback === 'function') {
        callback(NotificationActions.notificationClicked, data);
      }
      this.hideNotification(clientId);
      this.exitFullScreen();
    }
  }

  /**
   * Handles notification close which updates client
   * to remove event listeners
   *
   * @param clientId {number}
   */
  public notificationClosed(clientId): void {
    const browserWindow = this.getNotificationWindow(clientId);
    if (
      browserWindow &&
      windowExists(browserWindow) &&
      browserWindow.notificationData
    ) {
      const data = browserWindow.notificationData;
      const callback = this.notificationCallbacks[clientId];
      if (typeof callback === 'function') {
        callback(NotificationActions.notificationClosed, data);
      }
    }
  }

  /**
   * Handles notification reply action which updates client
   * @param clientId {number}
   * @param replyText {string}
   */
  public onNotificationReply(clientId: number, replyText: string): void {
    const browserWindow = this.getNotificationWindow(clientId);
    if (
      browserWindow &&
      windowExists(browserWindow) &&
      browserWindow.notificationData
    ) {
      const data = browserWindow.notificationData;
      const callback = this.notificationCallbacks[clientId];
      if (typeof callback === 'function') {
        callback(NotificationActions.notificationReply, data, replyText);
      }
      this.notificationClosed(clientId);
      this.hideNotification(clientId);
    }
  }

  /**
   * Returns the notification based on the client id
   *
   * @param clientId {number}
   */
  public getNotificationWindow(
    clientId: number,
  ): ICustomBrowserWindow | undefined {
    return this.activeNotifications.find(
      (notification) => notification.clientId === clientId,
    );
  }

  /**
   * Update latest notification settings from config
   */
  public updateNotificationSettings(): void {
    const { display, position } = config.getConfigFields([
      'notificationSettings',
    ]).notificationSettings;
    this.settings.displayId = display;
    this.settings.startCorner = position as startCorner;

    // recalculate notification position
    this.setupNotificationPosition();
    this.moveNotificationDown(0, this.activeNotifications, 0, true);
  }

  /**
   * Closes all the notification windows and resets some configurations
   */
  public cleanUp(): void {
    animationQueue.clear();
    this.notificationQueue = [];
    this.activeNotifications = [];
    this.inactiveWindows = [];
  }

  /**
   * Brings all the notification to the top
   * issue: ELECTRON-1382
   */
  public moveNotificationToTop(): void {
    this.activeNotifications
      .filter(
        (browserWindow) =>
          typeof browserWindow.notificationData === 'object' &&
          browserWindow.isVisible(),
      )
      .forEach((browserWindow) => {
        if (
          browserWindow &&
          windowExists(browserWindow) &&
          browserWindow.isVisible()
        ) {
          browserWindow.moveTop();
        }
      });
  }

  /**
   * SDA-1268 - Workaround to exit window
   * fullscreen state when notification is clicked
   */
  public exitFullScreen(): void {
    const browserWindows: ICustomBrowserWindow[] = BrowserWindow.getAllWindows() as ICustomBrowserWindow[];
    for (const win in browserWindows) {
      if (Object.prototype.hasOwnProperty.call(browserWindows, win)) {
        const browserWin = browserWindows[win];
        if (
          browserWin &&
          windowExists(browserWin) &&
          browserWin.winName === apiName.mainWindowName &&
          browserWin.isFullScreen()
        ) {
          browserWin.webContents.send('exit-html-fullscreen');
          return;
        }
      }
    }
  }

  /**
   * Waits for window to load and resolves
   *
   * @param window
   * @param data
   */
  private didFinishLoad(window, data) {
    return new Promise<ICustomBrowserWindow>((resolve) => {
      window.webContents.once('did-finish-load', () => {
        if (windowExists(window)) {
          this.renderNotification(window, data);
        }
        return resolve(window);
      });
    });
  }

  /**
   * Calculates all the required attributes and displays the notification
   *
   * @param notificationWindow {BrowserWindow}
   * @param data {INotificationData}
   */
  private renderNotification(notificationWindow, data): void {
    this.calcNextInsertPos(this.activeNotifications);
    this.setWindowPosition(
      notificationWindow,
      this.nextInsertPos.x,
      this.nextInsertPos.y,
    );
    this.setNotificationContent(notificationWindow, {
      ...data,
      windowId: notificationWindow.id,
    });
    this.activeNotifications.push(notificationWindow);
  }

  /**
   * Closes the active notification after certain period
   */
  private cleanUpInactiveNotification() {
    if (this.inactiveWindows.length > 0) {
      logger.info('notification: cleaning up inactive notification windows', {
        inactiveNotification: this.inactiveWindows.length,
      });
      this.inactiveWindows.forEach((window) => {
        if (windowExists(window)) {
          window.close();
        }
      });
      logger.info(`notification: cleaned up inactive notification windows`, {
        inactiveNotification: this.inactiveWindows.length,
      });
    }
  }

  /**
   * Clears the timer for a specific notification window
   *
   * @param windowId {number} - Id associated with the window
   */
  private onMouseOver(windowId: number): void {
    const notificationWindow = this.getNotificationWindow(windowId);
    if (!notificationWindow || !windowExists(notificationWindow)) {
      return;
    }
    clearTimeout(notificationWindow.displayTimer);
  }

  /**
   * Start a new timer to close the notification
   *
   * @param windowId
   * @param isInputHidden {boolean} - whether the inline reply is hidden
   */
  private onMouseLeave(windowId: number, isInputHidden: boolean): void {
    const notificationWindow = this.getNotificationWindow(windowId);
    if (!notificationWindow || !windowExists(notificationWindow)) {
      return;
    }

    if (
      notificationWindow.notificationData &&
      notificationWindow.notificationData.sticky
    ) {
      return;
    }

    if (!isInputHidden) {
      return;
    }

    const displayTime =
      notificationWindow.notificationData &&
      notificationWindow.notificationData.displayTime
        ? notificationWindow.notificationData.displayTime
        : notificationSettings.displayTime;
    if (notificationWindow && windowExists(notificationWindow)) {
      notificationWindow.displayTimer = setTimeout(async () => {
        await this.hideNotification(notificationWindow.clientId);
      }, displayTime);
    }
  }

  /**
   * Increase the notification height to
   * make space for reply input element
   *
   * @param windowId
   * @private
   */
  private onShowReply(windowId: number): void {
    const notificationWindow = this.getNotificationWindow(windowId);
    if (!notificationWindow || !windowExists(notificationWindow)) {
      return;
    }
    clearTimeout(notificationWindow.displayTimer);
    notificationWindow.setSize(344, CONTAINER_HEIGHT_WITH_INPUT, true);
    const pos = this.activeNotifications.indexOf(notificationWindow) + 1;
    this.moveNotificationUp(pos, this.activeNotifications);
  }

  /**
   * notification window opts
   */
  private getNotificationOpts(): Electron.BrowserWindowConstructorOptions {
    const contextIsolation = config.getGlobalConfigFields(['contextIsolation'])
      .contextIsolation;
    return {
      width: 344,
      height: 88,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: isWindowsOS,
      show: false,
      frame: false,
      transparent: true,
      fullscreenable: false,
      acceptFirstMouse: true,
      title: NOTIFICATION_WINDOW_TITLE,
      webPreferences: {
        sandbox: !isNodeEnv,
        nodeIntegration: isNodeEnv,
        devTools: true,
        contextIsolation: isNodeEnv
          ? false
          : typeof contextIsolation === 'boolean'
          ? contextIsolation
          : true,
      },
    };
  }
}

const notification = new Notification(notificationSettings);

export { notification };
