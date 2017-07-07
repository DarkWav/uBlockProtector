//The Core library for background rules
"use strict";

/**
 * Initialization.
 * @function
 */
a.init = () => {
    //Message listener
    chrome.runtime.onMessage.addListener((...args) => {
        if (args.length === 3) {
            //Each message must have "cmd" field for the command
            switch (args[0]["cmd"]) {
                /**
                 * Inject CSS to the caller tab.
                 * @param {string} data - The CSS code to inject.
                 */
                case "inject css":
                    if (args[1].tab && args[1].tab.id !== chrome.tabs.TAB_ID_NONE) {
                        chrome.tabs.insertCSS(args[1].tab.id, {
                            code: args[0]["data"],
                            frameId: args[1].frameId || 0,
                        }, () => {
                            if (chrome.runtime.lastError) {
                                //Ignore, assume the tab is closed
                            }
                        });
                    } //Ignore if not called from a proper tab
                    break;
                /**
                 * Do a cross origin XMLHttpRequest.
                 * @param {Object} details - The details object, see a.request() of content-core
                 ** for more information.
                 * @return {string|null} The response text, or null if the request failed.
                 */
                case "xhr":
                    if (typeof args[0].details === "object") {
                        console.warn(`Sending cross origin request to ${args[0].details.url}`);
                        let req = new XMLHttpRequest();
                        //Event handler
                        req.onreadystatechange = () => {
                            if (req.readyState === 4) {
                                try {
                                    args[2](req.responseText);
                                } catch (err) { }
                            }
                        };
                        //Create request
                        req.open(String(args[0].details.method), String(args[0].details.url));
                        //Set headers
                        if (typeof args[0].details.headers === "object") {
                            for (let key in args[0].details.headers) {
                                req.setRequestHeader(key, String(args[0].details.headers[key]));
                            }
                        }
                        //Send request
                        let payload = null;
                        if (args[0].details.payload) {
                            payload = String(args[0].details.payload);
                        }
                        req.send(payload);
                        return true; //The callback is done after this handler returns
                    } //Ignore if details is not valid
                /**
                 * Forcefully close the sender tab.
                 */
                case "remove tab":
                    if (args[1].tab && args[1].tab.id !== chrome.tabs.TAB_ID_NONE) {
                        chrome.tabs.remove(args[1].tab.id, () => {
                            if (chrome.runtime.lastError) {
                                //Ignore, assume the tab is already closed
                            }
                        });
                    } //Ignore if not called from a proper tab
                    break;
                default:
                    //Invalid command, ignore
                    break;
            }
        } //No command, ignore
    });
    //Extension icon click handler, open options page
    chrome.browserAction.onClicked.addListener(() => {
        chrome.runtime.openOptionsPage();
    });
    //Set badge
    if (a.debugMode) {
        //Debug mode
        chrome.browserAction.setBadgeText({
            text: "DBG",
        });
        chrome.browserAction.setBadgeBackgroundColor({
            color: "#6996FF",
        });
    } else if (chrome.runtime.id !== "ggolfgbegefeeoocgjbmkembbncoadlb") {
        //Unpacked extension but not in debug mode
        chrome.browserAction.setBadgeText({
            text: "DEV",
        });
        chrome.browserAction.setBadgeBackgroundColor({
            color: "#25BA42",
        });
    } //No badge otherwise
};

/**
 * Get the URL of a tab.
 * @function
 * @param {integer} tab - The ID of the tab.
 * @param {integer} frame - The ID of the frame.
 * @return {string} The URL of the tab, or an empty string if it is not known.
 */
a.getTabURL = (() => {
    //The tabs database
    let tabs = {};
    if (a.debugMode) {
        //Expose private object in debug mode
        window.getTabURLInternal = tabs;
    }
    //Bind event handlers
    chrome.webNavigation.onCommitted.addListener((details) => {
        if (!tabs[details.tabId]) {
            tabs[details.tabId] = {};
        }
        tabs[details.tabId][details.frameId] = details.url;
    });
    chrome.tabs.onRemoved.addListener((id) => {
        //Free memory when tab is closed
        delete tabs[id];
    });
    //Return closure function
    return (tab, frame) => {
        if (tabs[tab]) {
            return tabs[tab][frame] || "";
        } else {
            return "";
        }
    };
})();

/**
 * Register a static loopback server.
 * @function
 * @param {Array.<string>} urls - The urls to loopback.
 * @param {Array.<string>} types - The types of request to loopback.
 * @param {string} data - The data to loopback to, must be already encoded and ready to serve.
 */
a.staticServer = (urls, types, data) => {
    chrome.webRequest.onBeforeRequest.addListener(
        () => {
            return { redirectUrl: data };
        },
        {
            urls: urls,
            types: types,
        },
        [
            "blocking",
        ],
    );
};
/**
 * Register a dynamic loopback server.
 * @function
 * @param {Array.<string>} urls - The urls to loopback.
 * @param {Array.<string>} types - The types of request to loopback.
 * @param {Function} server - The server, this function will be passed as the event listener, view Chrome API
 ** documentations for more information: https://developer.chrome.com/extensions/webRequest
 */
a.dynamicServer = (urls, types, server) => {
    chrome.webRequest.onBeforeRequest.addListener(
        server,
        {
            urls: urls,
            types: types,
        },
        [
            "blocking",
        ],
    );
};

/**
 * Attempt to make the server think the request is from a different IP.
 * This function is for debugging purposes only, and is only available in debug mode.
 * @function
 * @param {string} urls - The URLs to activate on.
 * @param {string} ip - The IP.
 * @param {boolean} [log=false] - Whether details should be logged to console for every matched request.
 */
a.proxy = (urls, ip, log) => {
    if (!a.debugMode) {
        console.error("a.proxy() is only available in debug mode!");
        return;
    }
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            details.requestHeaders.push({
                name: "X-Forwarded-For",
                value: ip,
            });
            details.requestHeaders.push({
                name: "Client-IP",
                value: ip,
            });
            if (log) {
                console.log(details);
            }
            return { requestHeaders: details.requestHeaders };
        },
        {
            urls: urls,
        },
        [
            "blocking",
            "requestHeaders",
        ],
    );
};

/**
 * Make data URL.
 * @function
 * @param {Function} payload - The payload.
 * @param {string} [type="text/javascript"] - The MIME type of the payload.
 * @return {string} The URL encoded payload.
 */
a.mkPayload = (payload, type = "text/javascript") => {
    return `data:${type};base64,${btoa(`(${payload})();`)}`;
};
/**
 * Pretty print payload. Only available in debug mode.
 * @function
 * @param {string} payload - The payload.
 */
a.printPayload = (payload) => {
    if (!a.debugMode) {
        console.error("a.printPayload() is only available in debug mode!");
        return;
    }
    let output = "";
    while (payload) {
        output += `"${payload.substring(0, 150)}" +\n`;
        payload = payload.substring(150);
    }
    console.log(output);
};

/**
 * Apply generic rules.
 * @function
 */
a.generic = () => {
    //---jQuery plugin---
    //Payload generator
    /*
    a.printPayload(a.mkPayload(() => {
        "use strict";
        window.console.error("Uncaught Error: jQuery uBlock Origin detector plugin is not allowed on this device!");
        try {
            window.$.adblock = false;
        } catch (err) { }
        try {
            window.jQuery.adblock = false;
        } catch (err) { }
    }));
    */
    a.staticServer(
        [
            "https://ads.korri.fr/index.js",
            "http://*.medianetworkinternational.com/js/advertisement.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsNCiAgICAgICAgInVzZSBzdHJpY3QiOw0KICAgICAgICB3aW5kb3cuY29uc29sZS5lcnJvcigiVW5jYXVnaHQgRXJyb3I6IGpRdWVyeSB1QmxvY2" +
        "sgT3JpZ2luIGRldGVjdG9yIHBsdWdpbiBpcyBub3QgYWxsb3dlZCBvbiB0aGlzIGRldmljZSEiKTsNCiAgICAgICAgdHJ5IHsNCiAgICAgICAgICAgIHdpbmRvdy4kLmFkYmxvY2sgPSBmYWxzZTsN" +
        "CiAgICAgICAgfSBjYXRjaCAoZXJyKSB7IH0NCiAgICAgICAgdHJ5IHsNCiAgICAgICAgICAgIHdpbmRvdy5qUXVlcnkuYWRibG9jayA9IGZhbHNlOw0KICAgICAgICB9IGNhdGNoIChlcnIpIHsgfQ" +
        "0KICAgIH0pKCk7",
    );
    //---Interactive Media Ads Software Development Kit---
    //Payload generator

    //https://developers.google.com/interactive-media-ads/docs/sdks/html5/v3/apis
    a.printPayload(a.mkPayload(() => {
        "use strict";
        window.console.error("Uncaught Error: IMA SDK is not allowed on this device!");
        //I think I can get away with not implementing interfaces
        window.google = {
            ima: {
                AdDisplayContainer: class {
                    //constructor(container, video, click) { }
                    initialize() { }
                    destroy() { }
                },
                AdError: class extends Error {
                    constructor(message, code, type) {
                        super(message);
                        this.code = code;
                        this.type = type;
                    }
                    getErrorCode() {
                        return this.code;
                    }
                    getInnerError() {
                        return null;
                    }
                    getMessage() {
                        return this.message;
                    }
                    getType() {
                        return this.type;
                    }
                    getVastErrorCode() {
                        return window.google.ima.AdError.ErrorCode.UNKNOWN_ERROR;
                    }
                },
                AdErrorEvent: class extends ErrorEvent {
                    constructor(error, context) {
                        super(error);
                        this.errObj = error;
                        this.context = context;
                    }
                    getError() {
                        return this.errObj;
                    }
                    getUserRequestContext() {
                        return this.context;
                    }
                },
                AdEvent: class extends Event {
                    constructor(type, ad, adData) {
                        super(type);
                        this.ad = ad;
                        this.adData = adData;
                    }
                    getAd() {
                        return this.ad;
                    }
                    getAdData() {
                        return this.adData;
                    }
                },
                AdsLoader: class {
                    //Event logic
                    constructor() {
                        this.onError = [];
                        this._error = new window.google.ima.AdErrorEvent(
                            new window.google.ima.AdError(
                                "No ads available",
                                window.google.ima.AdError.ErrorCode.VAST_NO_ADS_AFTER_WRAPPER,
                                window.google.ima.AdError.Type.AD_LOAD,
                            ),
                            {},
                        );
                    }
                    addEventListener(event, handler) {
                        //I think I can get away with returning error for all ads requests
                        //The whitelisted SDK would also always error out
                        if (event === window.google.ima.AdErrorEvent.Type.AD_ERROR) {
                            this.onError.push(handler);
                        } else {
                            window.console.warn(`IMA event ${event} is ignored by uBlock Protector.`);
                        }
                    }
                    _dispatchError() {
                        for (let i = 0; i < this.onError.length; i++) {
                            this.onError[i](this._error);
                        }
                    }
                    //Other logic
                    contentComplete() {
                        window.setTimeout(this._dispatchError(), 10);
                    }
                    destroy() { }
                    getSettings() {
                        return window.google.ima.ImaSdkSettings;
                    }
                    requestAds() {
                        window.setTimeout(this._dispatchError(), 10);
                    }
                },
                AdsManagerLoadedEvent: class extends Event {
                    constructor() {
                        //I think I can get away with it as long as I do not dispatch the event
                        throw new window.Error("Neutralized AdsManager is not implemented.");
                    }
                },
                AdsRenderingSettings: class {
                    //I think I can get away with not defining anything
                    //constructor() { }
                },
                AdsRequest: class {
                    //I think I can get away with not defining anything
                    //constructor() { }
                    setAdWillAutoPlay() { }
                },
                CompanionAdSelectionSettings: class {
                    //I think I can get away with not defining anything
                    //constructor() { }
                },
                ImaSdkSettings: class {
                    //I think I can get away with not defining anything
                    //constructor() { }
                    getCompanionBackfill() {
                        return window.google.ima.ImaSdkSettings.CompanionBackfillMode.ALWAYS;
                    }
                    getDisableCustomPlaybackForIOS10Plus() {
                        return false;
                    }
                    getDisableFlashAds() {
                        return true;
                    }
                    getLocale() {
                        return "en-CA";
                    }
                    getNumRedirects() {
                        return 1;
                    }
                    getPlayerType() {
                        return "Unknown";
                    }
                    getPlayerVersion() {
                        return "1.0.0";
                    }
                    getPpid() {
                        return "2GjCgoECAP0IbU";
                    }
                    //Hopefully this will not blow up
                    setAutoPlayAdBreaks() { }
                    setCompanionBackfill() { }
                    setDisableCustomPlaybackForIOS10Plus() { }
                    setDisableFlashAds() { }
                    setLocale() { }
                    setNumRedirects() { }
                    setPlayerType() { }
                    setPlayerVersion() { }
                    setPpid() { }
                    setVpaidAllowed() { }
                    setVpaidMode() { }
                },
                UiElements: {
                    COUNTDOWN: "countdown",
                },
                ViewMode: {
                    FULLSCREEN: "fullscreen",
                    NORMAL: "normal",
                },
                VERSION: "3.173.4",
            },
        };
        //Nested API
        window.google.ima.AdError.ErrorCode = {
            VIDEO_PLAY_ERROR: 400,
            FAILED_TO_REQUEST_ADS: 1005,
            REQUIRED_LISTENERS_NOT_ADDED: 900,
            VAST_LOAD_TIMEOUT: 301,
            VAST_NO_ADS_AFTER_WRAPPER: 303,
            VAST_MEDIA_LOAD_TIMEOUT: 402,
            VAST_TOO_MANY_REDIRECTS: 302,
            VAST_ASSET_MISMATCH: 403,
            VAST_LINEAR_ASSET_MISMATCH: 403,
            VAST_NONLINEAR_ASSET_MISMATCH: 503,
            VAST_ASSET_NOT_FOUND: 1007,
            VAST_UNSUPPORTED_VERSION: 102,
            VAST_SCHEMA_VALIDATION_ERROR: 101,
            VAST_TRAFFICKING_ERROR: 200,
            VAST_UNEXPECTED_LINEARITY: 201,
            VAST_UNEXPECTED_DURATION_ERROR: 202,
            VAST_WRAPPER_ERROR: 300,
            NONLINEAR_DIMENSIONS_ERROR: 501,
            COMPANION_REQUIRED_ERROR: 602,
            VAST_EMPTY_RESPONSE: 1009,
            UNSUPPORTED_LOCALE: 1011,
            INVALID_ADX_EXTENSION: 1105,
            INVALID_ARGUMENTS: 1101,
            UNKNOWN_AD_RESPONSE: 1010,
            UNKNOWN_ERROR: 900,
            OVERLAY_AD_PLAYING_FAILED: 500,
            VIDEO_ELEMENT_USED: -1,
            VIDEO_ELEMENT_REQUIRED: -1,
            VAST_MEDIA_ERROR: -1,
            ADSLOT_NOT_VISIBLE: -1,
            OVERLAY_AD_LOADING_FAILED: -1,
            VAST_MALFORMED_RESPONSE: -1,
            COMPANION_AD_LOADING_FAILED: -1,
        };
        window.google.ima.AdError.Type = {
            AD_LOAD: "adLoadError",
            AD_PLAY: "adPlayError",
        };
        window.google.ima.AdErrorEvent.Type = {
            AD_ERROR: "adError",
        };
        window.google.ima.AdEvent.Type = {
            CONTENT_RESUME_REQUESTED: "contentResumeRequested",
            CONTENT_PAUSE_REQUESTED: "contentPauseRequested",
            CLICK: "click",
            DURATION_CHANGE: "durationChange",
            EXPANDED_CHANGED: "expandedChanged",
            STARTED: "start",
            IMPRESSION: "impression",
            PAUSED: "pause",
            RESUMED: "resume",
            FIRST_QUARTILE: "firstquartile",
            MIDPOINT: "midpoint",
            THIRD_QUARTILE: "thirdquartile",
            COMPLETE: "complete",
            USER_CLOSE: "userClose",
            LINEAR_CHANGED: "linearChanged",
            LOADED: "loaded",
            AD_CAN_PLAY: "adCanPlay",
            AD_METADATA: "adMetadata",
            AD_BREAK_READY: "adBreakReady",
            INTERACTION: "interaction",
            ALL_ADS_COMPLETED: "allAdsCompleted",
            SKIPPED: "skip",
            SKIPPABLE_STATE_CHANGED: "skippableStateChanged",
            LOG: "log",
            VIEWABLE_IMPRESSION: "viewable_impression",
            VOLUME_CHANGED: "volumeChange",
            VOLUME_MUTED: "mute",
        };
        window.google.ima.AdsManagerLoadedEvent.Type = {
            ADS_MANAGER_LOADED: "adsManagerLoaded",
        };
        window.google.ima.CompanionAdSelectionSettings.CreativeType = {
            ALL: "All",
            FLASH: "Flash",
            IMAGE: "Image",
        };
        window.google.ima.CompanionAdSelectionSettings.ResourceType = {
            ALL: "All",
            HTML: "Html",
            IFRAME: "IFrame",
            STATIC: "Static",
        };
        window.google.ima.CompanionAdSelectionSettings.SizeCriteria = {
            IGNORE: "IgnoreSize",
            SELECT_EXACT_MATCH: "SelectExactMatch",
            SELECT_NEAR_MATCH: "SelectNearMatch",
        };
        window.google.ima.ImaSdkSettings.CompanionBackfillMode = {
            ALWAYS: "always",
            ON_MASTER_AD: "on_master_ad",
        };
        window.google.ima.ImaSdkSettings.VpaidMode = {
            DISABLED: 0,
            ENABLED: 1,
            INSECURE: 2,
        };
        //Other
        window.google.ima.settings = new window.google.ima.ImaSdkSettings();
    }));

    a.staticServer(
        [
            "https://imasdk.googleapis.com/js/sdkloader/ima3.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsNCiAgICAgICAgInVzZSBzdHJpY3QiOw0KICAgICAgICB3aW5kb3cuY29uc29sZS5lcnJvcigiVW5jYXVnaHQgRXJyb3I6IElNQSBTREsgaXMgbm" +
        "90IGFsbG93ZWQgb24gdGhpcyBkZXZpY2UhIik7DQogICAgICAgIC8vSSB0aGluayBJIGNhbiBnZXQgYXdheSB3aXRoIG5vdCBpbXBsZW1lbnRpbmcgaW50ZXJmYWNlcw0KICAgICAgICB3aW5kb3cu" +
        "Z29vZ2xlID0gew0KICAgICAgICAgICAgaW1hOiB7DQogICAgICAgICAgICAgICAgQWREaXNwbGF5Q29udGFpbmVyOiBjbGFzcyB7DQogICAgICAgICAgICAgICAgICAgIC8vY29uc3RydWN0b3IoY2" +
        "9udGFpbmVyLCB2aWRlbywgY2xpY2spIHsgfQ0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXplKCkgeyB9DQogICAgICAgICAgICAgICAgICAgIGRlc3Ryb3koKSB7IH0NCiAgICAgICAgICAg" +
        "ICAgICB9LA0KICAgICAgICAgICAgICAgIEFkRXJyb3I6IGNsYXNzIGV4dGVuZHMgRXJyb3Igew0KICAgICAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihtZXNzYWdlLCBjb2RlLCB0eXBlKSB7DQ" +
        "ogICAgICAgICAgICAgICAgICAgICAgICBzdXBlcihtZXNzYWdlKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29kZSA9IGNvZGU7DQogICAgICAgICAgICAgICAgICAgICAgICB0aGlz" +
        "LnR5cGUgPSB0eXBlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGdldEVycm9yQ29kZSgpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLm" +
        "NvZGU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgZ2V0SW5uZXJFcnJvcigpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAg" +
        "ICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGdldE1lc3NhZ2UoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5tZXNzYWdlOw0KICAgICAgICAgICAgIC" +
        "AgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGdldFR5cGUoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy50eXBlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAg" +
        "ICAgICAgICAgICAgICAgIGdldFZhc3RFcnJvckNvZGUoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvci5FcnJvckNvZGUuVU5LTk9XTl" +
        "9FUlJPUjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAgICAgICAgICAgQWRFcnJvckV2ZW50OiBjbGFzcyBleHRlbmRzIEVycm9yRXZlbnQgew0KICAg" +
        "ICAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihlcnJvciwgY29udGV4dCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgc3VwZXIoZXJyb3IpOw0KICAgICAgICAgICAgICAgICAgICAgICAgdG" +
        "hpcy5lcnJPYmogPSBlcnJvcjsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAg" +
        "Z2V0RXJyb3IoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5lcnJPYmo7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgZ2V0VXNlclJlcX" +
        "Vlc3RDb250ZXh0KCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAg" +
        "ICAgICAgICAgQWRFdmVudDogY2xhc3MgZXh0ZW5kcyBFdmVudCB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKHR5cGUsIGFkLCBhZERhdGEpIHsNCiAgICAgICAgICAgICAgICAgIC" +
        "AgICAgIHN1cGVyKHR5cGUpOw0KICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZCA9IGFkOw0KICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hZERhdGEgPSBhZERhdGE7DQogICAgICAg" +
        "ICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgZ2V0QWQoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KIC" +
        "AgICAgICAgICAgICAgICAgICBnZXRBZERhdGEoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZERhdGE7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAg" +
        "ICAgICB9LA0KICAgICAgICAgICAgICAgIEFkc0xvYWRlcjogY2xhc3Mgew0KICAgICAgICAgICAgICAgICAgICAvL0V2ZW50IGxvZ2ljDQogICAgICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKC" +
        "kgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vbkVycm9yID0gW107DQogICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9lcnJvciA9IG5ldyB3aW5kb3cuZ29vZ2xlLmltYS5BZEVy" +
        "cm9yRXZlbnQoDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IHdpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3IoDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJObyBhZHMgYX" +
        "ZhaWxhYmxlIiwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvci5FcnJvckNvZGUuVkFTVF9OT19BRFNfQUZURVJfV1JBUFBFUiwNCiAgICAg" +
        "ICAgICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvci5UeXBlLkFEX0xPQUQsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKSwNCiAgICAgICAgICAgIC" +
        "AgICAgICAgICAgICAgICB7fSwNCiAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgYWRkRXZlbnRMaXN0ZW5lcihldmVu" +
        "dCwgaGFuZGxlcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy9JIHRoaW5rIEkgY2FuIGdldCBhd2F5IHdpdGggcmV0dXJuaW5nIGVycm9yIGZvciBhbGwgYWRzIHJlcXVlc3RzDQogICAgIC" +
        "AgICAgICAgICAgICAgICAgICAvL1RoZSB3aGl0ZWxpc3RlZCBTREsgd291bGQgYWxzbyBhbHdheXMgZXJyb3Igb3V0DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXZlbnQgPT09IHdpbmRv" +
        "dy5nb29nbGUuaW1hLkFkRXJyb3JFdmVudC5UeXBlLkFEX0VSUk9SKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vbkVycm9yLnB1c2goaGFuZGxlcik7DQogICAgICAgICAgIC" +
        "AgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvdy5jb25zb2xlLndhcm4oYElNQSBldmVudCAke2V2ZW50fSBpcyBpZ25vcmVkIGJ5IHVCbG9jayBQ" +
        "cm90ZWN0b3IuYCk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgX2Rpc3BhdGNoRXJyb3IoKSB7DQogICAgICAgIC" +
        "AgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMub25FcnJvci5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMub25FcnJvcltpXSh0aGlz" +
        "Ll9lcnJvcik7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgLy9PdGhlciBsb2dpYw0KICAgICAgICAgICAgICAgIC" +
        "AgICBjb250ZW50Q29tcGxldGUoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuc2V0VGltZW91dCh0aGlzLl9kaXNwYXRjaEVycm9yKCksIDEwKTsNCiAgICAgICAgICAgICAgICAg" +
        "ICAgfQ0KICAgICAgICAgICAgICAgICAgICBkZXN0cm95KCkgeyB9DQogICAgICAgICAgICAgICAgICAgIGdldFNldHRpbmdzKCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHdpbm" +
        "Rvdy5nb29nbGUuaW1hLkltYVNka1NldHRpbmdzOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIHJlcXVlc3RBZHMoKSB7DQogICAgICAgICAgICAgICAgICAgICAg" +
        "ICB3aW5kb3cuc2V0VGltZW91dCh0aGlzLl9kaXNwYXRjaEVycm9yKCksIDEwKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAgICAgICAgICAgQWRzTW" +
        "FuYWdlckxvYWRlZEV2ZW50OiBjbGFzcyBleHRlbmRzIEV2ZW50IHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3RydWN0b3IoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvL0kgdGhpbmsg" +
        "SSBjYW4gZ2V0IGF3YXkgd2l0aCBpdCBhcyBsb25nIGFzIEkgZG8gbm90IGRpc3BhdGNoIHRoZSBldmVudA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IHdpbmRvdy5FcnJvcigiTm" +
        "V1dHJhbGl6ZWQgQWRzTWFuYWdlciBpcyBub3QgaW1wbGVtZW50ZWQuIik7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9LA0KICAgICAgICAgICAgICAgIEFkc1JlbmRl" +
        "cmluZ1NldHRpbmdzOiBjbGFzcyB7DQogICAgICAgICAgICAgICAgICAgIC8vSSB0aGluayBJIGNhbiBnZXQgYXdheSB3aXRoIG5vdCBkZWZpbmluZyBhbnl0aGluZw0KICAgICAgICAgICAgICAgIC" +
        "AgICAvL2NvbnN0cnVjdG9yKCkgeyB9DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBBZHNSZXF1ZXN0OiBjbGFzcyB7DQogICAgICAgICAgICAgICAgICAgIC8vSSB0aGluayBJ" +
        "IGNhbiBnZXQgYXdheSB3aXRoIG5vdCBkZWZpbmluZyBhbnl0aGluZw0KICAgICAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9yKCkgeyB9DQogICAgICAgICAgICAgICAgICAgIHNldEFkV2lsbE" +
        "F1dG9QbGF5KCkgeyB9DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBDb21wYW5pb25BZFNlbGVjdGlvblNldHRpbmdzOiBjbGFzcyB7DQogICAgICAgICAgICAgICAgICAgIC8v" +
        "SSB0aGluayBJIGNhbiBnZXQgYXdheSB3aXRoIG5vdCBkZWZpbmluZyBhbnl0aGluZw0KICAgICAgICAgICAgICAgICAgICAvL2NvbnN0cnVjdG9yKCkgeyB9DQogICAgICAgICAgICAgICAgfSwNCi" +
        "AgICAgICAgICAgICAgICBJbWFTZGtTZXR0aW5nczogY2xhc3Mgew0KICAgICAgICAgICAgICAgICAgICAvL0kgdGhpbmsgSSBjYW4gZ2V0IGF3YXkgd2l0aCBub3QgZGVmaW5pbmcgYW55dGhpbmcN" +
        "CiAgICAgICAgICAgICAgICAgICAgLy9jb25zdHJ1Y3RvcigpIHsgfQ0KICAgICAgICAgICAgICAgICAgICBnZXRDb21wYW5pb25CYWNrZmlsbCgpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIH" +
        "JldHVybiB3aW5kb3cuZ29vZ2xlLmltYS5JbWFTZGtTZXR0aW5ncy5Db21wYW5pb25CYWNrZmlsbE1vZGUuQUxXQVlTOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAg" +
        "IGdldERpc2FibGVDdXN0b21QbGF5YmFja0ZvcklPUzEwUGx1cygpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgIC" +
        "AgICAgICAgICAgICBnZXREaXNhYmxlRmxhc2hBZHMoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAg" +
        "ICAgICBnZXRMb2NhbGUoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gImVuLUNBIjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBnZXROdW1SZW" +
        "RpcmVjdHMoKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gMTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBnZXRQbGF5ZXJUeXBlKCkgew0KICAg" +
        "ICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICJVbmtub3duIjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBnZXRQbGF5ZXJWZXJzaW9uKCkgew0KICAgICAgIC" +
        "AgICAgICAgICAgICAgICAgcmV0dXJuICIxLjAuMCI7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgZ2V0UHBpZCgpIHsNCiAgICAgICAgICAgICAgICAgICAgICAg" +
        "IHJldHVybiAiMkdqQ2dvRUNBUDBJYlUiOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIC8vSG9wZWZ1bGx5IHRoaXMgd2lsbCBub3QgYmxvdyB1cA0KICAgICAgIC" +
        "AgICAgICAgICAgICBzZXRBdXRvUGxheUFkQnJlYWtzKCkgeyB9DQogICAgICAgICAgICAgICAgICAgIHNldENvbXBhbmlvbkJhY2tmaWxsKCkgeyB9DQogICAgICAgICAgICAgICAgICAgIHNldERp" +
        "c2FibGVDdXN0b21QbGF5YmFja0ZvcklPUzEwUGx1cygpIHsgfQ0KICAgICAgICAgICAgICAgICAgICBzZXREaXNhYmxlRmxhc2hBZHMoKSB7IH0NCiAgICAgICAgICAgICAgICAgICAgc2V0TG9jYW" +
        "xlKCkgeyB9DQogICAgICAgICAgICAgICAgICAgIHNldE51bVJlZGlyZWN0cygpIHsgfQ0KICAgICAgICAgICAgICAgICAgICBzZXRQbGF5ZXJUeXBlKCkgeyB9DQogICAgICAgICAgICAgICAgICAg" +
        "IHNldFBsYXllclZlcnNpb24oKSB7IH0NCiAgICAgICAgICAgICAgICAgICAgc2V0UHBpZCgpIHsgfQ0KICAgICAgICAgICAgICAgICAgICBzZXRWcGFpZEFsbG93ZWQoKSB7IH0NCiAgICAgICAgIC" +
        "AgICAgICAgICAgc2V0VnBhaWRNb2RlKCkgeyB9DQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBVaUVsZW1lbnRzOiB7DQogICAgICAgICAgICAgICAgICAgIENPVU5URE9XTjog" +
        "ImNvdW50ZG93biIsDQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBWaWV3TW9kZTogew0KICAgICAgICAgICAgICAgICAgICBGVUxMU0NSRUVOOiAiZnVsbHNjcmVlbiIsDQogIC" +
        "AgICAgICAgICAgICAgICAgIE5PUk1BTDogIm5vcm1hbCIsDQogICAgICAgICAgICAgICAgfSwNCiAgICAgICAgICAgICAgICBWRVJTSU9OOiAiMy4xNzMuNCIsDQogICAgICAgICAgICB9LA0KICAg" +
        "ICAgICB9Ow0KICAgICAgICAvL05lc3RlZCBBUEkNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvci5FcnJvckNvZGUgPSB7DQogICAgICAgICAgICBWSURFT19QTEFZX0VSUk9SOiA0MD" +
        "AsDQogICAgICAgICAgICBGQUlMRURfVE9fUkVRVUVTVF9BRFM6IDEwMDUsDQogICAgICAgICAgICBSRVFVSVJFRF9MSVNURU5FUlNfTk9UX0FEREVEOiA5MDAsDQogICAgICAgICAgICBWQVNUX0xP" +
        "QURfVElNRU9VVDogMzAxLA0KICAgICAgICAgICAgVkFTVF9OT19BRFNfQUZURVJfV1JBUFBFUjogMzAzLA0KICAgICAgICAgICAgVkFTVF9NRURJQV9MT0FEX1RJTUVPVVQ6IDQwMiwNCiAgICAgIC" +
        "AgICAgIFZBU1RfVE9PX01BTllfUkVESVJFQ1RTOiAzMDIsDQogICAgICAgICAgICBWQVNUX0FTU0VUX01JU01BVENIOiA0MDMsDQogICAgICAgICAgICBWQVNUX0xJTkVBUl9BU1NFVF9NSVNNQVRD" +
        "SDogNDAzLA0KICAgICAgICAgICAgVkFTVF9OT05MSU5FQVJfQVNTRVRfTUlTTUFUQ0g6IDUwMywNCiAgICAgICAgICAgIFZBU1RfQVNTRVRfTk9UX0ZPVU5EOiAxMDA3LA0KICAgICAgICAgICAgVk" +
        "FTVF9VTlNVUFBPUlRFRF9WRVJTSU9OOiAxMDIsDQogICAgICAgICAgICBWQVNUX1NDSEVNQV9WQUxJREFUSU9OX0VSUk9SOiAxMDEsDQogICAgICAgICAgICBWQVNUX1RSQUZGSUNLSU5HX0VSUk9S" +
        "OiAyMDAsDQogICAgICAgICAgICBWQVNUX1VORVhQRUNURURfTElORUFSSVRZOiAyMDEsDQogICAgICAgICAgICBWQVNUX1VORVhQRUNURURfRFVSQVRJT05fRVJST1I6IDIwMiwNCiAgICAgICAgIC" +
        "AgIFZBU1RfV1JBUFBFUl9FUlJPUjogMzAwLA0KICAgICAgICAgICAgTk9OTElORUFSX0RJTUVOU0lPTlNfRVJST1I6IDUwMSwNCiAgICAgICAgICAgIENPTVBBTklPTl9SRVFVSVJFRF9FUlJPUjog" +
        "NjAyLA0KICAgICAgICAgICAgVkFTVF9FTVBUWV9SRVNQT05TRTogMTAwOSwNCiAgICAgICAgICAgIFVOU1VQUE9SVEVEX0xPQ0FMRTogMTAxMSwNCiAgICAgICAgICAgIElOVkFMSURfQURYX0VYVE" +
        "VOU0lPTjogMTEwNSwNCiAgICAgICAgICAgIElOVkFMSURfQVJHVU1FTlRTOiAxMTAxLA0KICAgICAgICAgICAgVU5LTk9XTl9BRF9SRVNQT05TRTogMTAxMCwNCiAgICAgICAgICAgIFVOS05PV05f" +
        "RVJST1I6IDkwMCwNCiAgICAgICAgICAgIE9WRVJMQVlfQURfUExBWUlOR19GQUlMRUQ6IDUwMCwNCiAgICAgICAgICAgIFZJREVPX0VMRU1FTlRfVVNFRDogLTEsDQogICAgICAgICAgICBWSURFT1" +
        "9FTEVNRU5UX1JFUVVJUkVEOiAtMSwNCiAgICAgICAgICAgIFZBU1RfTUVESUFfRVJST1I6IC0xLA0KICAgICAgICAgICAgQURTTE9UX05PVF9WSVNJQkxFOiAtMSwNCiAgICAgICAgICAgIE9WRVJM" +
        "QVlfQURfTE9BRElOR19GQUlMRUQ6IC0xLA0KICAgICAgICAgICAgVkFTVF9NQUxGT1JNRURfUkVTUE9OU0U6IC0xLA0KICAgICAgICAgICAgQ09NUEFOSU9OX0FEX0xPQURJTkdfRkFJTEVEOiAtMS" +
        "wNCiAgICAgICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRFcnJvci5UeXBlID0gew0KICAgICAgICAgICAgQURfTE9BRDogImFkTG9hZEVycm9yIiwNCiAgICAgICAgICAgIEFEX1BM" +
        "QVk6ICJhZFBsYXlFcnJvciIsDQogICAgICAgIH07DQogICAgICAgIHdpbmRvdy5nb29nbGUuaW1hLkFkRXJyb3JFdmVudC5UeXBlID0gew0KICAgICAgICAgICAgQURfRVJST1I6ICJhZEVycm9yIi" +
        "wNCiAgICAgICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRFdmVudC5UeXBlID0gew0KICAgICAgICAgICAgQ09OVEVOVF9SRVNVTUVfUkVRVUVTVEVEOiAiY29udGVudFJlc3VtZVJl" +
        "cXVlc3RlZCIsDQogICAgICAgICAgICBDT05URU5UX1BBVVNFX1JFUVVFU1RFRDogImNvbnRlbnRQYXVzZVJlcXVlc3RlZCIsDQogICAgICAgICAgICBDTElDSzogImNsaWNrIiwNCiAgICAgICAgIC" +
        "AgIERVUkFUSU9OX0NIQU5HRTogImR1cmF0aW9uQ2hhbmdlIiwNCiAgICAgICAgICAgIEVYUEFOREVEX0NIQU5HRUQ6ICJleHBhbmRlZENoYW5nZWQiLA0KICAgICAgICAgICAgU1RBUlRFRDogInN0" +
        "YXJ0IiwNCiAgICAgICAgICAgIElNUFJFU1NJT046ICJpbXByZXNzaW9uIiwNCiAgICAgICAgICAgIFBBVVNFRDogInBhdXNlIiwNCiAgICAgICAgICAgIFJFU1VNRUQ6ICJyZXN1bWUiLA0KICAgIC" +
        "AgICAgICAgRklSU1RfUVVBUlRJTEU6ICJmaXJzdHF1YXJ0aWxlIiwNCiAgICAgICAgICAgIE1JRFBPSU5UOiAibWlkcG9pbnQiLA0KICAgICAgICAgICAgVEhJUkRfUVVBUlRJTEU6ICJ0aGlyZHF1" +
        "YXJ0aWxlIiwNCiAgICAgICAgICAgIENPTVBMRVRFOiAiY29tcGxldGUiLA0KICAgICAgICAgICAgVVNFUl9DTE9TRTogInVzZXJDbG9zZSIsDQogICAgICAgICAgICBMSU5FQVJfQ0hBTkdFRDogIm" +
        "xpbmVhckNoYW5nZWQiLA0KICAgICAgICAgICAgTE9BREVEOiAibG9hZGVkIiwNCiAgICAgICAgICAgIEFEX0NBTl9QTEFZOiAiYWRDYW5QbGF5IiwNCiAgICAgICAgICAgIEFEX01FVEFEQVRBOiAi" +
        "YWRNZXRhZGF0YSIsDQogICAgICAgICAgICBBRF9CUkVBS19SRUFEWTogImFkQnJlYWtSZWFkeSIsDQogICAgICAgICAgICBJTlRFUkFDVElPTjogImludGVyYWN0aW9uIiwNCiAgICAgICAgICAgIE" +
        "FMTF9BRFNfQ09NUExFVEVEOiAiYWxsQWRzQ29tcGxldGVkIiwNCiAgICAgICAgICAgIFNLSVBQRUQ6ICJza2lwIiwNCiAgICAgICAgICAgIFNLSVBQQUJMRV9TVEFURV9DSEFOR0VEOiAic2tpcHBh" +
        "YmxlU3RhdGVDaGFuZ2VkIiwNCiAgICAgICAgICAgIExPRzogImxvZyIsDQogICAgICAgICAgICBWSUVXQUJMRV9JTVBSRVNTSU9OOiAidmlld2FibGVfaW1wcmVzc2lvbiIsDQogICAgICAgICAgIC" +
        "BWT0xVTUVfQ0hBTkdFRDogInZvbHVtZUNoYW5nZSIsDQogICAgICAgICAgICBWT0xVTUVfTVVURUQ6ICJtdXRlIiwNCiAgICAgICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQWRzTWFu" +
        "YWdlckxvYWRlZEV2ZW50LlR5cGUgPSB7DQogICAgICAgICAgICBBRFNfTUFOQUdFUl9MT0FERUQ6ICJhZHNNYW5hZ2VyTG9hZGVkIiwNCiAgICAgICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS" +
        "5pbWEuQ29tcGFuaW9uQWRTZWxlY3Rpb25TZXR0aW5ncy5DcmVhdGl2ZVR5cGUgPSB7DQogICAgICAgICAgICBBTEw6ICJBbGwiLA0KICAgICAgICAgICAgRkxBU0g6ICJGbGFzaCIsDQogICAgICAg" +
        "ICAgICBJTUFHRTogIkltYWdlIiwNCiAgICAgICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuQ29tcGFuaW9uQWRTZWxlY3Rpb25TZXR0aW5ncy5SZXNvdXJjZVR5cGUgPSB7DQogICAgIC" +
        "AgICAgICBBTEw6ICJBbGwiLA0KICAgICAgICAgICAgSFRNTDogIkh0bWwiLA0KICAgICAgICAgICAgSUZSQU1FOiAiSUZyYW1lIiwNCiAgICAgICAgICAgIFNUQVRJQzogIlN0YXRpYyIsDQogICAg" +
        "ICAgIH07DQogICAgICAgIHdpbmRvdy5nb29nbGUuaW1hLkNvbXBhbmlvbkFkU2VsZWN0aW9uU2V0dGluZ3MuU2l6ZUNyaXRlcmlhID0gew0KICAgICAgICAgICAgSUdOT1JFOiAiSWdub3JlU2l6ZS" +
        "IsDQogICAgICAgICAgICBTRUxFQ1RfRVhBQ1RfTUFUQ0g6ICJTZWxlY3RFeGFjdE1hdGNoIiwNCiAgICAgICAgICAgIFNFTEVDVF9ORUFSX01BVENIOiAiU2VsZWN0TmVhck1hdGNoIiwNCiAgICAg" +
        "ICAgfTsNCiAgICAgICAgd2luZG93Lmdvb2dsZS5pbWEuSW1hU2RrU2V0dGluZ3MuQ29tcGFuaW9uQmFja2ZpbGxNb2RlID0gew0KICAgICAgICAgICAgQUxXQVlTOiAiYWx3YXlzIiwNCiAgICAgIC" +
        "AgICAgIE9OX01BU1RFUl9BRDogIm9uX21hc3Rlcl9hZCIsDQogICAgICAgIH07DQogICAgICAgIHdpbmRvdy5nb29nbGUuaW1hLkltYVNka1NldHRpbmdzLlZwYWlkTW9kZSA9IHsNCiAgICAgICAg" +
        "ICAgIERJU0FCTEVEOiAwLA0KICAgICAgICAgICAgRU5BQkxFRDogMSwNCiAgICAgICAgICAgIElOU0VDVVJFOiAyLA0KICAgICAgICB9Ow0KICAgICAgICAvL090aGVyDQogICAgICAgIHdpbmRvdy" +
        "5nb29nbGUuaW1hLnNldHRpbmdzID0gbmV3IHdpbmRvdy5nb29nbGUuaW1hLkltYVNka1NldHRpbmdzKCk7DQogICAgfSkoKTs=",
    );
    //---MoatFreeWheelJSPEM.js---
    //Payload generator
    /*
    a.printPayload(a.mkPayload(() => {
        "use strict";
        window.console.error("Uncaught Error: FreeWheel SDK is not allowed on this device!");
        window.MoatFreeWheelJSPEM = class {
            init() { }
            dispose() { }
        };
    }));
    */
    a.staticServer(
        [
            "https://jspenguin.com/API/uBlockProtector/Solutions/MoatFreeWheelJSPEM.js",
            "https://*.moatads.com/*/MoatFreeWheelJSPEM.js*",
        ],
        [
            "script",
        ],
        "data:text/javascript;base64,KCgpID0+IHsNCiAgICAgICAgInVzZSBzdHJpY3QiOw0KICAgICAgICB3aW5kb3cuY29uc29sZS5lcnJvcigiVW5jYXVnaHQgRXJyb3I6IEZyZWVXaGVlbCBTRE" +
        "sgaXMgbm90IGFsbG93ZWQgb24gdGhpcyBkZXZpY2UhIik7DQogICAgICAgIHdpbmRvdy5Nb2F0RnJlZVdoZWVsSlNQRU0gPSBjbGFzcyB7DQogICAgICAgICAgICBpbml0KCkgeyB9DQogICAgICAg" +
        "ICAgICBkaXNwb3NlKCkgeyB9DQogICAgICAgIH07DQogICAgfSkoKTs=",
    );
};
