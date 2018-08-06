const electron = require('electron');
const app = electron.app;
const ffi = require('ffi');
const ref = require('ref');
const path = require('path');
const execPath = path.dirname(app.getPath('exe'));

const log = require('./log.js');
const logLevels = require('./enums/logLevels.js');
const { isMac, isDevEnv } = require('../js/utils/misc');

const TAG_LENGTH = 16;
const arch = process.arch === 'ia32';
const winLibraryPath = isDevEnv ? path.join(__dirname, '..', 'library') : path.join(execPath, 'library');
const macLibraryPath = isDevEnv ? path.join(__dirname, '..', 'library') : path.join(execPath, '..', 'library');

const cryptoLibPath = isMac ?
    path.join(macLibraryPath, 'cryptoLib.dylib') :
    (arch ? path.join(winLibraryPath, 'libsymphonysearch-x86.dll') : path.join(winLibraryPath, 'libsymphonysearch-x64.dll'));

const library = new ffi.Library((cryptoLibPath), {

    AESEncryptGCM: [ref.types.int32, [
        ref.refType(ref.types.uchar),
        ref.types.int32,
        ref.refType(ref.types.uchar),
        ref.types.int32,
        ref.refType(ref.types.uchar),
        ref.refType(ref.types.uchar),
        ref.types.uint32,
        ref.refType(ref.types.uchar),
        ref.refType(ref.types.uchar),
        ref.types.uint32,
    ]],

    AESDecryptGCM: [ref.types.int32, [
        ref.refType(ref.types.uchar),
        ref.types.int32,
        ref.refType(ref.types.uchar),
        ref.types.int32,
        ref.refType(ref.types.uchar),
        ref.types.uint32,
        ref.refType(ref.types.uchar),
        ref.refType(ref.types.uchar),
        ref.types.uint32,
        ref.refType(ref.types.uchar),
    ]],

    getVersion: [ref.types.CString, []],
});

const AESGCMEncrypt = function(Base64IV, Base64AAD, Base64Key, Base64In) {
    let base64In = Base64In;

    if (!base64In) {
        base64In = "";
    }

    const IV = Buffer.from(Base64IV, 'base64');
    const AAD = Buffer.from(Base64AAD, 'base64');
    const Key = Buffer.from(Base64Key, 'base64');
    const In = Buffer.from(base64In, 'base64');

    const OutPtr = Buffer.alloc(In.length);
    const Tag = Buffer.alloc(TAG_LENGTH);

    const resultCode = library.AESEncryptGCM(In, In.length, AAD, AAD.length, Key, IV, IV.length, OutPtr, Tag, TAG_LENGTH);

    if (resultCode < 0) {
        log.send(logLevels.ERROR, `AESEncryptGCM, Failed to encrypt with exit code ${resultCode}`);
    }
    log.send(logLevels.INFO, `Output from AESEncryptGCM ${resultCode}`);
    const bufferArray = [OutPtr, Tag];
    return Buffer.concat(bufferArray).toString('base64')
};

const AESGCMDecrypt = function(Base64IV, Base64AAD, Base64Key, Base64In) {
    let base64In = Base64In;

    if (!base64In) {
        base64In = "";
    }

    const IV = Buffer.from(Base64IV, 'base64');
    const AAD = Buffer.from(Base64AAD, 'base64');
    const Key = Buffer.from(Base64Key, 'base64');
    const In = Buffer.from(base64In, 'base64');

    const OutPtr = Buffer.alloc(In.length - TAG_LENGTH);
    const CipherTextLen = In.length - TAG_LENGTH;
    const Tag = Buffer.alloc(TAG_LENGTH);

    const resultCode = library.AESDecryptGCM(In, CipherTextLen, AAD, AAD.length, Tag, TAG_LENGTH, Key, IV, IV.length, OutPtr);

    if (resultCode < 0) {
        log.send(logLevels.ERROR, `AESDecryptGCM, Failed to decrypt with exit code ${resultCode}`);
    }
    log.send(logLevels.INFO, `Output from AESDecryptGCM ${resultCode}`);
    return OutPtr.toString('base64')
};

const EncryptDecrypt = function(name, Base64IV, Base64AAD, Base64Key, Base64In) {
    if (name === 'AESGCMEncrypt') {
        return AESGCMEncrypt(Base64IV, Base64AAD, Base64Key, Base64In);
    }
    return AESGCMDecrypt(Base64IV, Base64AAD, Base64Key, Base64In);
};

module.exports = {
    AESGCMEncrypt: AESGCMEncrypt,
    AESGCMDecrypt: AESGCMDecrypt,
    EncryptDecrypt: EncryptDecrypt,
};
