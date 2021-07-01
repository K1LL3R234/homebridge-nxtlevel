'use strict';

var os = require("os");
var packagedef = require('./package.json');
var homebridgeLib = require('homebridge-lib');
var fakegatoHistory = require('fakegato-history');
var fs = require("fs");
var path = require("path");
var mqttlib = require('./libs/mqttlib');
const EventEmitter = require('events');


var Service, Characteristic, Eve, HistoryService;
var homebridgePath;

function makeNxtLevel(log, accessoryConfig, api) {
    // Create accessory information service
    function makeAccessoryInformationService() {
        var informationService = new Service.AccessoryInformation();

        informationService.setCharacteristic(Characteristic.Manufacturer, accessoryConfig.manufacturer || "nxtlevel");
        informationService.setCharacteristic(Characteristic.Model, accessoryConfig.model || accessoryConfig.type);
        informationService.setCharacteristic(Characteristic.SerialNumber, accessoryConfig.serialNumber || (os.hostname() + "-" + accessoryConfig.name));
        informationService.setCharacteristic(Characteristic.FirmwareRevision, accessoryConfig.firmwareRevision || packagedef.version);

        return informationService;
    }

    //
    //  MQTT Wrappers
    //

    // Initialize MQTT client
    let ctx = { log, config: accessoryConfig, homebridgePath };
    try {
        mqttlib.init(ctx);
    } catch (ex) {
        log.error('MQTT initialisation failed: ' + ex);
        return { getServices: () => [] };
    }

    // MQTT Subscribe
    function mqttSubscribe(topic, property, handler) {
        mqttlib.subscribe(ctx, topic, property, handler);
    }

    // MQTT Publish
    function mqttPublish(topic, property, message) {
        mqttlib.publish(ctx, topic, property, message);
    }

    // Controllers
    let controllers = [];



    // Create services
    function createServices() {

        function configToServices(config) {

            const c_mySetContext = { nxtlevel: '---my-set-context--' };

            // The states of our characteristics
            var state = ctx.state = {};

            // Internal event handling
            var events = {};

            function raiseEvent(property) {
                if (events.hasOwnProperty(property)) {
                    events[property]();
                }
            }

            function makeConfirmedPublisher(setTopic, getTopic, property, makeConfirmed) {
                return mqttlib.makeConfirmedPublisher(ctx, setTopic, getTopic, property, makeConfirmed);
            }

            //! Determine appropriate on/off value for Boolean property (not forced to string) for MQTT publishing.
            //! Returns null if no offValue.
            function getOnOffPubValue(value) {
                let mqttval;
                if (config.onValue) {
                    // using onValue/offValue
                    mqttval = value ? config.onValue : config.offValue;
                } else if (config.integerValue) {
                    mqttval = value ? 1 : 0;
                } else {
                    mqttval = value ? true : false;
                }
                if (mqttval === undefined || mqttval === null) {
                    return null;
                } else {
                    return mqttval;
                }
            }

            //! Test whether a value represents 'on'
            function isRecvValueOn(mqttval) {
                let onval = getOnOffPubValue(true);
                return mqttval === onval || mqttval == (onval + '');
            }

            //! Test whether a value represents 'off'
            function isRecvValueOff(mqttval) {

                if (config.otherValueOff) {
                    if (!isRecvValueOn(mqttval)) {
                        // it's not the on value and we consider any other value to be off
                        return true;
                    }
                }

                let offval = getOnOffPubValue(false);

                if (offval === null) {
                    // there is no off value
                    return false;
                }

                if (mqttval === offval || mqttval == (offval + '')) {
                    // off value match - it's definitely off
                    return true;
                }

                // not off
                return false;
            }

            function getOnlineOfflinePubValue(value) {
                var pubVal = (value ? config.onlineValue : config.offlineValue);
                if (pubVal === undefined) {
                    pubVal = getOnOffPubValue(value);
                }
                return pubVal;
            }

            function isRecvValueOnline(mqttval) {
                let onval = getOnlineOfflinePubValue(true);
                return mqttval === onval || mqttval == (onval + '');
            }

            function isRecvValueOffline(mqttval) {
                let offval = getOnlineOfflinePubValue(false);
                return mqttval === offval || mqttval == (offval + '');
            }

            function mapValueForHomebridge(val, mapValueFunc) {
                if (mapValueFunc) {
                    return mapValueFunc(val);
                } else {
                    return val;
                }
            }

            function isOffline() {
                return state.online === false;
            }

            function handleGetStateCallback(callback, value) {
                if (isOffline()) {
                    callback('offline');
                } else {
                    callback(null, value);
                }
            }

            function isSet(val) {
                return val !== undefined && val !== null;
            }

            function isValid(charac, value) {

                // if validation is disabled, accept anything
                if (config.validate === false) {
                    return true;
                }

                const format = charac.props.format;
                if (format === 'int' || format === "uint8" || format == "uint16" || format == "uint32") {
                    if (!Number.isInteger(value)) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - not an integer`);
                        return false;
                    }
                    if (isSet(charac.props.minValue) && value < charac.props.minValue) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - below minimum (${charac.props.minValue})`);
                        return false;
                    }
                    if (isSet(charac.props.maxValue) && value > charac.props.maxValue) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - above maximum (${charac.props.maxValue})`);
                        return false;
                    }
                } else if (format === 'float') {
                    if (typeof value !== 'number' || isNaN(value)) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a number`);
                        return false;
                    }
                    if (isSet(charac.props.minValue) && value < charac.props.minValue) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - below minimum (${charac.props.minValue})`);
                        return false;
                    }
                    if (isSet(charac.props.maxValue) && value > charac.props.maxValue) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - above maximum (${charac.props.maxValue})`);
                        return false;
                    }
                } else if (format === 'bool') {
                    if (value !== true && value !== false) {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a Boolean`);
                        return false;
                    }
                } else if (format === 'string') {
                    if (typeof value !== 'string') {
                        log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a string`);
                        return false;
                    }
                } else {
                    log(`Unable to validate ${charac.displayName}, format [${charac.props.format}] - ${JSON.stringify(charac)}`);
                }
                return true;
            }

            function setCharacteristic(charac, value) {
                if (isValid(charac, value)) {
                    charac.setValue(value, undefined, c_mySetContext);
                }
            }

            function booleanCharacteristic(service, property, characteristic, setTopic, getTopic, initialValue, mapValueFunc, turnOffAfterms, resetStateAfterms, enableConfirmation) {

                var publish = makeConfirmedPublisher(setTopic, getTopic, property, enableConfirmation);

                // auto-turn-off and reset-state timers
                var autoOffTimer = null;
                var autoResetStateTimer = null;

                // default state
                state[property] = (initialValue ? true : false);

                // set up characteristic
                var charac = service.getCharacteristic(characteristic);
                charac.on('get', function (callback) {
                    handleGetStateCallback(callback, state[property]);
                });
                if (setTopic) {
                    charac.on('set', function (value, callback, context) {
                        if (context !== c_mySetContext) {
                            state[property] = value;
                            publish(getOnOffPubValue(value));
                        }
                        callback();

                        // optionally turn off after timeout
                        if (value && turnOffAfterms) {
                            if (autoOffTimer) {
                                clearTimeout(autoOffTimer);
                            }
                            autoOffTimer = setTimeout(function () {
                                autoOffTimer = null;

                                state[property] = false;
                                publish(getOnOffPubValue(false));
                                setCharacteristic(charac, mapValueForHomebridge(false, mapValueFunc));

                            }, turnOffAfterms);
                        }
                    });
                }
                if (initialValue) {
                    setCharacteristic(charac, mapValueForHomebridge(initialValue, mapValueFunc));
                }

                // subscribe to get topic
                if (getTopic) {
                    mqttSubscribe(getTopic, property, function (topic, message) {
                        // determine whether this is an on or off value
                        let newState = false; // assume off
                        if (isRecvValueOn(message)) {
                            newState = true; // received on value so on
                        } else if (!isRecvValueOff(message)) {
                            // received value NOT acceptable as 'off' so ignore message
                            return;
                        }
                        // if it changed, set characteristic
                        if (state[property] != newState) {
                            state[property] = newState;
                            setCharacteristic(charac, mapValueForHomebridge(newState, mapValueFunc));
                        }
                        // optionally reset state to OFF after a timeout
                        if (newState && resetStateAfterms) {
                            if (autoResetStateTimer) {
                                clearTimeout(autoResetStateTimer);
                            }
                            autoResetStateTimer = setTimeout(function () {
                                autoResetStateTimer = null;
                                state[property] = false;
                                setCharacteristic(charac, mapValueForHomebridge(false, mapValueFunc));
                            }, resetStateAfterms);
                        }
                    });
                }
            }

            function booleanState(property, getTopic, initialValue, isOnFunc, isOffFunc) {
                // default state
                state[property] = (initialValue ? true : false);

                // MQTT subscription
                if (getTopic) {
                    mqttSubscribe(getTopic, property, function (topic, message) {
                        if (isOnFunc(message)) {
                            state[property] = true;
                        } else if (isOffFunc(message)) {
                            state[property] = false;
                        }
                    });
                }
            }

            function state_Online() {
                booleanState('online', config.IMEInr + '/' + config.topics.getOnline, true, isRecvValueOnline, isRecvValueOffline);
            }

            function integerCharacteristic(service, property, characteristic, setTopic, getTopic, options) {

                let initialValue = options && options.initialValue;
                let minValue = options && options.minValue;
                let maxValue = options && options.maxValue;

                // default state
                state[property] = initialValue || 0;

                // set up characteristic
                var charac = service.getCharacteristic(characteristic);

                // min/max
                if (Number.isInteger(minValue)) {
                    charac.props.minValue = minValue;
                }
                if (Number.isInteger(maxValue)) {
                    charac.props.maxValue = maxValue;
                }

                // get/set
                charac.on('get', function (callback) {
                    handleGetStateCallback(callback, state[property]);
                });

                let onSet = function (value, context) {
                    if (context !== c_mySetContext) {
                        state[property] = value;
                        if (setTopic) {
                            mqttPublish(setTopic, property, value);
                        }
                    }
                    if (options && options.onSet) {
                        options.onSet(value, context);
                    }
                };

                if (setTopic || (options && options.onSet)) {
                    charac.on('set', function (value, callback, context) {
                        onSet(value, context);
                        callback();
                    });
                }
                if (initialValue) {
                    setCharacteristic(charac, initialValue);
                }

                // subscribe to get topic
                if (getTopic) {
                    mqttSubscribe(getTopic, property, function (topic, message) {
                        var newState = parseInt(message);
                        if (state[property] != newState) {
                            if (options && options.onMqtt) {
                                options.onMqtt(newState);
                            }
                            // update state and characteristic
                            state[property] = newState;
                            setCharacteristic(charac, newState);
                        }
                    });
                }

                return { onSet };
            }




            function stringCharacteristic(service, property, characteristic, setTopic, getTopic, initialValue) {
                // default state
                state[property] = initialValue ? initialValue : '';

                // set up characteristic
                var charac = service.getCharacteristic(characteristic);
                charac.on('get', function (callback) {
                    handleGetStateCallback(callback, state[property]);
                });
                if (setTopic) {
                    charac.on('set', function (value, callback, context) {
                        if (context !== c_mySetContext) {
                            state[property] = value;
                            mqttPublish(setTopic, property, value);
                        }
                        callback();
                    });
                }

                // subscribe to get topic
                if (getTopic) {
                    mqttSubscribe(getTopic, property, function (topic, message) {
                        var newState = message.toString();
                        if (state[property] !== newState) {
                            state[property] = newState;
                            setCharacteristic(charac, newState);
                        }
                    });
                }
            }

            function multiCharacteristic(service, property, characteristic, setTopic, getTopic, values, initialValue, eventOnly) {
                // Values is an array of MQTT values indexed by <value of Homekit enumeration>.
                // Build map of MQTT values to homekit values
                var mqttToHomekit = {};
                for (let i = 0; i < values.length; i++) {
                    mqttToHomekit[values[i]] = i;
                }

                state[property] = initialValue;

                var charac = service.getCharacteristic(characteristic);

                // Homekit get
                if (!eventOnly) {
                    charac.on('get', function (callback) {
                        handleGetStateCallback(callback, state[property]);
                    });
                }

                // Homekit set
                if (setTopic) {
                    charac.on('set', function (value, callback, context) {
                        if (context !== c_mySetContext) {

                            if (typeof value === "boolean") {
                                value = value ? 1 : 0;
                            }

                            state[property] = value;
                            let mqttVal = values[value];
                            if (mqttVal !== undefined) {
                                mqttPublish(setTopic, property, mqttVal);
                            }
                            raiseEvent(property);
                        }
                        callback();
                    });
                }

                if (initialValue) {
                    setCharacteristic(charac, initialValue);
                }

                // MQTT set (Homekit get)
                if (getTopic) {
                    mqttSubscribe(getTopic, property, function (topic, message) {
                        let data = message?.toString() ?? '';
                        let newState = mqttToHomekit[data];
                        if (newState !== undefined && (eventOnly || state[property] != newState)) {
                            if (config.logMqtt) {
                                log(`Received ${data} - ${property} state is now ${newState}`);
                            }
                            state[property] = newState;
                            setCharacteristic(charac, newState);
                            raiseEvent(property);
                        }
                        if (newState === undefined && config.logMqtt) {
                            log(`Warning: ${property} received [${data}] which is not in configured values ${JSON.stringify(mqttToHomekit)}`);
                        }
                    });
                }
            }



            // Characteristic.Name
            function characteristic_Name(service) {
                stringCharacteristic(service, 'name', Characteristic.Name, null, config.IMEInr + '/' + config.topics.getName, config.name);
            }



            // Characteristic.StatusFault
            function characteristic_StatusFault(service) {
                booleanCharacteristic(service, 'statusFault', Characteristic.StatusFault, null, config.IMEInr + '/' + config.topics.getStatusFault);
            }

            // Characteristic.StatusTampered
            function characteristic_StatusTampered(service) {
                booleanCharacteristic(service, 'statusTampered', Characteristic.StatusTampered, null, config.IMEInr + '/' + config.topics.getStatusTampered);
            }

            // Characteristic.StatusLowBattery
            function characteristic_StatusLowBattery(service) {
                booleanCharacteristic(service, 'statusLowBattery', Characteristic.StatusLowBattery, null, config.IMEInr + '/' + config.topics.getStatusLowBattery);
            }


            // Characteristic.SecuritySystemCurrentState
            function characteristic_SecuritySystemCurrentState(service) {
                let values = config.currentStateValues;
                if (!values) {
                    values = ['SA', 'AA', 'NA', 'D', 'T'];
                }
                multiCharacteristic(service, 'currentState', Characteristic.SecuritySystemCurrentState, null, config.IMEInr + '/' + config.topics.getCurrentState, values, Characteristic.SecuritySystemCurrentState.DISARMED);
            }

            // Characteristic.SecuritySystemTargetState
            function characteristic_SecuritySystemTargetState(service) {
                let values = config.targetStateValues;
                if (!values) {
                    values = ['SA', 'AA', 'NA', 'D'];
                }
                multiCharacteristic(service, 'targetState', Characteristic.SecuritySystemTargetState, config.IMEInr + '/' + config.topics.setTargetState, config.IMEInr + '/' + config.topics.getTargetState, values, Characteristic.SecuritySystemTargetState.DISARM);
                if (config.restrictTargetState) {
                    let characteristic = service.getCharacteristic(Characteristic.SecuritySystemTargetState);
                    characteristic.props.validValues = config.restrictTargetState;
                }
            }


            // Characteristic.BatteryLevel
            function characteristic_BatteryLevel(service) {
                integerCharacteristic(service, 'batteryLevel', Characteristic.BatteryLevel, null, config.IMEInr + '/' + config.topics.getBatteryLevel);
            }

            // Characteristic.ChargingState
            function characteristic_ChargingState(service) {
                let values = config.chargingStateValues;
                if (!values) {
                    values = ['NOT_CHARGING', 'CHARGING', 'NOT_CHARGEABLE'];
                }
                multiCharacteristic(service, 'chargingState', Characteristic.ChargingState, null, config.IMEInr + '/' + config.topics.getChargingState, values, Characteristic.ChargingState.NOT_CHARGING);
            }



            // add battery characteristics
            function addBatteryCharacteristics(service) {
                if (config.topics.getBatteryLevel) {
                    characteristic_BatteryLevel(service);
                }
                if (config.topics.getChargingState) {
                    characteristic_ChargingState(service);
                }
                if (config.topics.getStatusLowBattery) {
                    characteristic_StatusLowBattery(service);
                }
            }

            let name = config.name;
            let subtype = config.subtype;
            let svcNames = config.serviceNames || {}; // custom names for multi-service accessories

            let service = null; // to return a single service
            let services = null; // if returning multiple services

            //  config.type may be 'type-subtype', e.g. 'lightbulb-OnOff'
            let configType = config.type.split('-')[0]; // ignore configuration subtype

            if (configType == "securitySystem") {
                service = new Service.SecuritySystem(name, subtype);
                characteristic_SecuritySystemTargetState(service);
                characteristic_SecuritySystemCurrentState(service);
                if (config.topics.getStatusFault) {
                    characteristic_StatusFault(service);
                }
                if (config.topics.getStatusTampered) {
                    characteristic_StatusTampered(service);
                }
                // todo: SecuritySystemAlarmType
            } else if (configType == 'battery') {
                service = new Service.BatteryService(name);
                addBatteryCharacteristics(service);
            } else {
                log("ERROR: Unrecognized type: " + configType);
            }

            if (service) {
                if (config.topics.getName) {
                    characteristic_Name(service);
                }

                if (config.topics.getOnline) {
                    state_Online();
                }
            }

            // always use services array
            if (!services) {
                if (service) {
                    services = [service];
                } else {
                    log('Error: No service(s) created for ' + name);
                    return;
                }
            }

            // optional battery service
            if (configType !== 'battery') {
                if (config.topics.getBatteryLevel || config.topics.getChargingState ||
                    (config.topics.getStatusLowBattery && !service.testCharacteristic(Characteristic.StatusLowBattery))) {
                    // also create battery service
                    let batsvc = new Service.BatteryService(name + '-battery');
                    addBatteryCharacteristics(batsvc);
                    services.push(batsvc);
                }
            }

            return services;
        }

        let services = null;

        if (accessoryConfig.type === "custom" && accessoryConfig.services) {
            // multi-service/custom configuration...
            services = [];
            for (let svcCfg of accessoryConfig.services) {
                let config = { ...accessoryConfig, ...svcCfg };
                if (!config.hasOwnProperty('subtype')) {
                    config.subtype = config.name;
                }
                services = [...services, ...configToServices(config)];
            }
        } else {
            // single accessory
            services = configToServices(accessoryConfig);
        }

        // accessory information service
        services.push(makeAccessoryInformationService());

        // start-up publishing
        if (accessoryConfig.startPub) {
            if (Array.isArray(accessoryConfig.startPub)) {
                // new format - [ { topic: x, message: y }, ... ]
                for (let entry of accessoryConfig.startPub) {
                    if (entry.topic) {
                        mqttPublish(entry.topic, 'startPub', entry.message || '');
                    }
                }
            } else {
                // old format - object of topic->message
                for (let topic in accessoryConfig.startPub) {
                    if (accessoryConfig.startPub.hasOwnProperty(topic)) {
                        let msg = accessoryConfig.startPub[topic];
                        mqttPublish(topic, 'startPub', msg);
                    }
                }
            }
        }

        return services;
    }

    // The service
    var theServices = null;
    try {
        theServices = createServices();
    } catch (ex) {
        log.error('Exception while creating services: ' + ex);
        log(ex.stack);
    }

    // Our accessory instance
    var thing = {};

    // Return services
    thing.getServices = function () {
        return theServices || [];
    };

    // Return controllers
    thing.getControllers = function () {
        return controllers;
    };

    return thing;
}


// Homebridge Entry point
module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Eve = new homebridgeLib.EveHomeKitTypes(homebridge);
    HistoryService = fakegatoHistory(homebridge);
    homebridgePath = homebridge.user.storagePath();

    homebridge.registerAccessory("homebridge-nxtlevel", "nxtlevel", makeNxtLevel);
}