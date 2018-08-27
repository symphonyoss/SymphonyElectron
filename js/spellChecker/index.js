const { remote } = require('electron');
const { MenuItem } = remote;
const { isMac } = require('./../utils/misc');
const { SpellCheckHandler, ContextMenuListener, ContextMenuBuilder } = require('electron-spellchecker');

class SpellCheckHelper {

    /**
     * A constructor to create an instance of the spell checker
     */
    constructor() {
        this.spellCheckHandler = new SpellCheckHandler();
    }

    /**
     * Method to initialize spell checker
     */
    initializeSpellChecker() {
        this.spellCheckHandler.automaticallyIdentifyLanguages = false;
        this.spellCheckHandler.attachToInput();

        // This is only for window as in mac the
        // language is switched w.r.t to the current system language.
        //
        // In windows we need to implement RxJS observable
        // in order to switch language dynamically
        if (!isMac) {
            const sysLocale = remote.app.getLocale() || 'en-US';
            this.spellCheckHandler.switchLanguage(sysLocale);
        }

        this.contextMenuBuilder = new ContextMenuBuilder(this.spellCheckHandler, null, false, this.processMenu.bind(this));
        this.contextMenuListener = new ContextMenuListener((info) => {
            this.contextMenuBuilder.showPopupMenu(info);
        });
    }

    /**
     * Updates the locale for context menu labels
     * @param content {Object} - locale content for context menu
     */
    updateContextMenuLocale(content) {
        this.localeContent = content;
        this.contextMenuBuilder.setAlternateStringFormatter(SpellCheckHelper.getStringTable(content));
    }

    /**
     * Builds the string table for context menu
     *
     * @param content {Object} - locale content for context menu
     * @return {Object} - String table for context menu
     */
    static getStringTable(content) {
        return {
            copyMail: () => content['Copy Email Address'] || `Copy Email Address`,
            copyLinkUrl: () => content['Copy Link'] || 'Copy Link',
            openLinkUrl: () => content['Open Link'] || 'Open Link',
            copyImageUrl: () => content['Copy Image URL'] || 'Copy Image URL',
            copyImage: () => content['Copy Image'] || 'Copy Image',
            addToDictionary: () => content['Add to Dictionary'] || 'Add to Dictionary',
            lookUpDefinition: (lookup) => {
                const lookUp = content['Look Up '] || 'Look Up ';
                return `${lookUp}"${lookup.word}"`;
            },
            searchGoogle: () => content['Search with Google'] || 'Search with Google',
            cut: () => content.Cut || 'Cut',
            copy: () => content.Copy || 'Copy',
            paste: () => content.Paste || 'Paste',
            inspectElement: () => content['Inspect Element'] || 'Inspect Element',
        };
    }

    /**
     * Method to add default menu items to the
     * menu that was generated by ContextMenuBuilder
     *
     * This method will be invoked by electron-spellchecker
     * before showing the context menu
     *
     * @param menu
     * @returns menu
     */
    processMenu(menu) {

        let isLink = false;
        menu.items.map((item) => {
            if (item.label === 'Copy Link'){
                isLink = true;
            }
            return item;
        });

        if (!isLink){
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({
                role: 'reload',
                accelerator: 'CmdOrCtrl+R',
                label: this.localeContent && this.localeContent.Reload || 'Reload',
            }));
        }
        return menu;
    }

}

module.exports = {
    SpellCheckHelper: SpellCheckHelper
};