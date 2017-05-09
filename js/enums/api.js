'use strict';

var keyMirror = require('keymirror');

const cmds = keyMirror({
    isOnline: null,
    registerLogger: null,
    setBadgeCount: null,
    badgeDataUrl: null,
    activate: null,
    registerBoundsChange: null,
    registerActivityDetection: null,
});

module.exports = {
    cmds: cmds,
    apiName: 'symphony-api'
}
