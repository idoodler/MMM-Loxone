Module.register("MMM-Loxone",{

    requiresVersion: "2.1.1",

    defaults: {
        host: null,
        user: null,
        pwd: null,
        roomUuid: null,
        presence: false,
        showNotificationOfControlTypes: [
            "Intercom",
            "Alarm",
            "SmokeAlarm",
            "Sauna"
        ],
        showInfoNotifications: true,
        showErrorNotifications: true,
        showSystemNotifications: true,
        allow3rdParty: false
    },

    init: function init() {
        this.requestPromiseMap = {};
    },

    /**
     * The module has started, validate the configuration and establish a connection to the Loxone Miniserver
     */
    start: function start() {
        setTimeout(function() {
            if (this.config.host && this.config.user && this.config.pwd) {
                this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.CONNECT, this.config);
            } else {
                this.sendNotification(LxEnums.NOTIFICATIONS.PUBLIC.ALERT, {
                    title: "MMM-Loxone",
                    message: "Invalide MMM-Loxone configuration please check your `config.json` file!",
                    imageFA: "exclamation-triangle",
                    timer: 30 * 1000
                });
            }
        }.bind(this), 5 * 1000);
    },

    /**
     * Returns all the needed scripts
     * @returns {*[]}
     */
    getScripts: function getScripts() {
        return [
            this.file('scripts/q.js'),
            this.file('scripts/jquery.min.js'),
            this.file('shared/lxEnums.js')
        ]
    },

    /**
     * Hey, we received a notification, check if we know what to do with it
     * @param notification
     * @param payload
     */
    socketNotificationReceived: function socketNotificationReceived(notification, payload) {
        switch (notification) {
            case LxEnums.NOTIFICATIONS.INTERN.ROOM_TEMP:
                this.sendNotification(LxEnums.NOTIFICATIONS.PUBLIC.TEMP, payload.temp);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.PRESENCE:
                this.sendNotification(LxEnums.NOTIFICATIONS.PUBLIC.PRESENCE, payload.present);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.MINISERVER_NOTIFICATION:
                this._handleMiniserverNotification(payload);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.STATE:
                this._broadcastTo3rdPartyModules(LxEnums.NOTIFICATIONS.PUBLIC.STATE, payload);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.STRUCTURE_FILE:
                this.structureFile = payload;
                this._broadcastTo3rdPartyModules(LxEnums.NOTIFICATIONS.PUBLIC.STRUCTURE_FILE, payload);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.OSS:
                this._broadcastTo3rdPartyModules(LxEnums.NOTIFICATIONS.PUBLIC.OSS, payload);
                break;
            case LxEnums.NOTIFICATIONS.INTERN.REQUEST_RESPONSE:
                this._gotRequestResponseNotification(payload);
                break;
        }
    },

    /**
     * The Loxone Miniserver sent out a Notification. Check if we are allowed to display the notification
     * @param payload
     * @private
     */
    _handleMiniserverNotification: function _handleMiniserverNotification(payload) {
        var faIcon = undefined,
            show = false,
            affectedControl = Object.values(this.structureFile.controls).find(function(control) {
                return control.uuidAction === payload.data.uuid;
            }.bind(this));

        // The received Notification has been sent from a control, check if we are allowed to show it
        if (affectedControl) {
            show = this.config.showNotificationOfControlTypes.indexOf(affectedControl.type) !== -1;

        } else {
            switch (payload.data.lvl) {
                case 1:
                    show = this.config.showInfoNotifications;
                    break;
                case 2:
                    show = this.config.showErrorNotifications;
                    break;
                case 3:
                    show = this.config.showSystemNotifications;
                    break;
            }
        }

        if (show) {
            if (payload.data.lvl === 1) { // Info
                faIcon = "info-circle";
            } else if (payload.data.lvl === 2) { // Error
                faIcon = "exclamation-triangle";
            } else if (payload.data.lvl === 3) { // SystemError
                faIcon = "exclamation-circle";
            }

            this.sendNotification(LxEnums.NOTIFICATIONS.PUBLIC.ALERT, {
                title: payload.title,
                message: payload.message,
                imageFA: faIcon,
                timer: 10 * 1000
            });
        }
    },

    /**
     * Allows MMM-Loxone to broadcast notifications to other modules to let them use data from the Loxone Miniserver
     * @param notificationKey
     * @param payload
     * @private
     */
    _broadcastTo3rdPartyModules: function _broadcastTo3rdPartyModules(notificationKey, payload) {
        this.config.allow3rdParty && this.sendNotification(notificationKey, payload);
    },

    /**
     * Sends a given command and returns a promise
     * @param cmd
     * @returns {*}
     * @private
     */
    _sendCommands: function _sendCommands(cmd) {
        var def = Q.defer(),
            promise = def.promise,
            id = this._getUUID();

        promise.def = def;
        this.requestPromiseMap[id] = promise;

        this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.REQUEST, {
            id: id,
            cmd: cmd
        });

        return promise.then(function(response) {
            delete this.requestPromiseMap[id];
            return response;
        }.bind(this), function(error) {
            delete this.requestPromiseMap[id];
            throw error;
        }.bind(this));
    },

    /**
     * Wrapps around MagicMirrors sendSocketNotification to be able to return a promise in the this._sendCommands method
     * @param payload
     * @private
     */
    _gotRequestResponseNotification: function _gotRequestResponseNotification(payload) {
        var id = payload.id,
            error = payload.error,
            response = payload.response,
            promise = this.requestPromiseMap[id];

        if (promise) {
            if (error) {
                Log.info(this.name, "Got error wth id: " + id);
                promise.def.reject(error);
            } else {
                Log.info(this.name, "Successfully executed cmd with id: " + id);
                promise.def.resolve(response);
            }
        } else {
            Log.info(this.name, "Got unexpected response with id: " + id);
        }
    },

    /**
     * Helper method to get a UUID
     * @returns {string}
     * @private
     */
    _getUUID: function _getUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }
});
