var NodeHelper = require('node_helper'),
    LxCommunicator = require("lxcommunicator"),
    LxSupportCode = LxCommunicator.SupportCode,
    Os = require('os'),
    exec = require('child_process').exec,
    when = require('when'),
    isPi = require("detect-rpi"),
    LxEnums = require("./shared/lxEnums.js");

module.exports = NodeHelper.create({

    requiresVersion: "2.1.1",

    start: function() {
        this.config = null;
        this.structureFile = null;
        this.tempStateUuid = null;
        this.lightStateUuid = null;
        this.notificationUuid = null;
        this.room = null;
        this.irc = null;
        this.socket = null;

        var WebSocketConfig = LxCommunicator.WebSocketConfig,
            config = new WebSocketConfig(WebSocketConfig.protocol.WS, this._getUUID(), Os.hostname(), WebSocketConfig.permission.APP, false);

        config.delegate = this;

        this.socket = new LxCommunicator.WebSocket(config);
    },

    socketNotificationReceived: function(notification, payload) {
        switch (notification) {
            case LxEnums.NOTIFICATIONS.INTERN.CONNECT:
                // Reset all variables
                this.structureFile = null;
                this.tempStateUuid = null;
                this.notificationUuid = null;
                this.room = null;
                this.irc = null;

                this.config = payload;
                this.connectToMiniserver();
                break;
            case LxEnums.NOTIFICATIONS.INTERN.REQUEST:
                if (this.socket) {
                    if (payload.cmd && payload.id) {
                        this.socket.send(payload.cmd).then(function(response) {
                            this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.REQUEST_RESPONSE, {
                                response: response,
                                id: payload.id
                            });
                        }.bind(this), function (err) {
                            this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.REQUEST_RESPONSE, {
                                error: err,
                                id: payload.id
                            });
                        }.bind(this));
                    } else {
                        console.warn(this.name, "Command can't be sent due to wrong configuration");
                    }
                } else {
                    console.warn(this.name, "Can't request any data due to a non active socket!");
                }
                break;
        }
    },

    connectToMiniserver: function connnectToMiniserver() {
        // Close any existent socket
        this.socket.close();
        // Open a Websocket connection to a miniserver by just providing the host, username and password!
        console.info("Opening Socket to your Miniserver");
        return this.socket.open(this.config.host, this.config.user, this.config.pwd).then(function() {
            // Download the loxApp3.json
            console.log(this.name, "Download LoxApp3.json");
            return this.socket.send("data/loxapp3.json").then(function(structureFile) {
                this.structureFile = JSON.parse(structureFile);
                // Emit the structure file for other modules to use
                this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.STRUCTURE_FILE, this.structureFile);

                console.info(this.name, "Search room with uuid: " + this.config.roomUuid);
                if (this.structureFile.rooms.hasOwnProperty(this.config.roomUuid)) {
                    this.room = this.structureFile.rooms[this.config.roomUuid];
                    console.info(this.name, "Found room: " + this.room.name);

                    console.info(this.name, "Search IRC for room temperature");
                    this.irc = this.getIrcInRoom();

                    if (this.irc) {
                        this.tempStateUuid = this.irc.states.tempActual;
                        console.info(this.name, "Found IRC (" + this.irc.name + ") in room " + this.room.name);
                    } else {
                        console.warn(this.name, "Couldn't find IRC, no indoor temperature available!");
                    }

                    if (this.config.presence) {
                        console.info(this.name, "Search LightControls and LightV2Controls in room");
                        this.lightControl = this.getLightControl();
                        if (this.lightControl) {
                            this.lightStateUuid = this.lightControl.states.activeMoods;
                            console.info(this.name, "Found LightControl (" + this.lightControl.name + ") in room " + this.room.name);
                        } else {
                            console.warn(this.name, "Couldn't find LightControl, no presence detection available");
                        }
                    }

                } else {
                    console.warn(this.name, "Couldn't find Room!");
                }

                this.notificationUuid = this.structureFile.globalStates.notifications;
                console.info(this.name, "NotificationUuid: " + this.notificationUuid);

                // Send a command, responses will be handled
                console.info(this.name, "Enabling statusupdates");
                return this.socket.send("jdev/sps/enablebinstatusupdate").then(function(respons) {
                    console.log(this.name, "Successfully executed '" + respons.LL.control + "' with code " + respons.LL.Code + " and value " + respons.LL.value);
                    return true;
                }.bind(this), function(err) {
                    console.error(err);
                    throw err;
                });
            }.bind(this));
        }.bind(this), function(e) {
            console.error(e);
            throw e;
        });
    },

    getIrcInRoom: function getIrcInRoom() {
        var ircs = this._findControlsInRoomWithType("IRoomController");
        return ircs.length ? ircs[0] : null;
    },

    getLightControl: function getLightControl() {
        var lightControls = this._findControlsInRoomWithType("LightControllerV2");
        return lightControls.length ? lightControls[0] : null;
    },

    processEvent: function processEvent(uuid, value) {
        switch (uuid) {
            case this.tempStateUuid:
                console.info(this.name, "Got room temperature: " + value);
                this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.ROOM_TEMP, {
                    roomName: this.room.name,
                    temp: value,
                    format: this.irc.details.format
                });
                break;
            case this.lightStateUuid:
                value = JSON.parse(value);
                var activeMoodsName = this._getNameForActiveMoods(value),
                    isPresent = value.length === 1 && value[0] !== LxEnums.LIGHT_MOODS.ALL_OFF;
                console.info(this.name, "Got lightMood change to: " + activeMoodsName);
                this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.PRESENCE, {
                    present: isPresent
                });
                this._togglePresence(isPresent);
                break;
            case this.notificationUuid:
                value = JSON.parse(value);
                // Sometimes the Miniserver is sending notifications with value === 0, we can't process these notifications
                if (value !== 0) {
                    console.info(this.name, "Got notification: " + JSON.stringify(value));
                    this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.MINISERVER_NOTIFICATION, value);
                } else {
                    value = undefined;
                }
                break;
        }
        // Emit any state for other modules to use
        if (value !== undefined) {
            this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.STATE, value);
        }
    },

    // Delegate methods of LxCommunicator
    socketOnConnectionClosed: function socketOnConnectionClosed(socket, code) {
        if (code !== LxSupportCode.MANUAL) {
            !this.ossInterval && this._startOOSTime();
        } else {
            console.warn(this.name, "Websocket has been closed with code: " + code);
        }
    },

    socketOnEventReceived: function socketOnEventReceived(socket, events, type) {
        var key = null,
            payload = null;

        // We only need to handle value and text events!
        if (type === LxEnums.EVENT_TYPES.EVENT) {
            key = "value";
        } else if (type === LxEnums.EVENT_TYPES.EVENTTEXT) {
            key = "text";
        }

        if (key) {
            events.forEach(function(event) {
                payload = event[key];
                payload && this.processEvent(event.uuid, payload);
            }.bind(this));
        }
    },
    // Delegate methods of LxCommunicator

    _getUUID: function _getUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    },

    /**
     * The Loxone Miniserver is out of service, aka rebooting
     * @returns {*}
     * @private
     */
    _startOOSTime: function _startOSSTimer() {
        this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.OOS, true);
        var defer = when.defer();

        this.ossInterval = setInterval(function isMiniserverReachable() {
            this.connectToMiniserver().then(function() {
                this.sendSocketNotification(LxEnums.NOTIFICATIONS.INTERN.OOS, false);
                clearInterval(this.ossInterval);
                defer.resolve();
            }.bind(this), function() {
                console.info(this.name, "Miniserver is still not reachable, try it again...");
            }.bind(this));
        }.bind(this), 10000);
        return defer.promise;
    },

    _findControlsInRoomWithType: function _findControlsInRoomWithType(controlType) {
        var controls = Object.values(this.structureFile.controls);
        return controls.filter(function(control) {
            return control.room === this.room.uuid && control.type === controlType;
        }.bind(this))
    },

    _togglePresence: function _togglePresence(isPresent) {
        if (!isPi()) {
            console.info("This is no Raspberry Pi, toggle the display is not supported!");
            return;
        }

        if (isPresent) {
            // Check if hdmi output is already on
            exec("/opt/vc/bin/tvservice -s").stdout.on('data', function(data) {
                if (data.indexOf("0x120002") !== -1)
                    exec("/opt/vc/bin/tvservice --preferred && chvt 6 && chvt 7", null);
            });
        } else {
            exec("/opt/vc/bin/tvservice -o", null);
        }
    },

    _getNameForActiveMoods: function _getNameForActiveMoods(moods) {
        var name = "";
        if (moods.length > 1) {
            var moodNames = moods.map(function(moodId) {
                    return this._getNameForActiveMoods([moodId]);
            }.bind(this));
            return moodNames.join(" + ");
        } else {
            switch (moods[0]) {
                case LxEnums.LIGHT_MOODS.MANUAL:
                    name = "Manual";
                    break;
                case LxEnums.LIGHT_MOODS.ALARM_CLOCK:
                    name = "Alarm Clock";
                    break;
                case LxEnums.LIGHT_MOODS.ALL_ON:
                    name = "All on";
                    break;
                case LxEnums.LIGHT_MOODS.ALL_OFF:
                    name = "All off";
                    break;
                default:
                    name = "Custom mode"
            }
            return name + "(" + moods[0] + ")";
        }
    }
});