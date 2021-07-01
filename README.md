[![npm](https://badgen.net/npm/v/homebridge-nxtlevel/latest)](https://www.npmjs.com/package/homebridge-nxtlevel)
[![npm](https://badgen.net/npm/dt/homebridge-nxtlevel)](https://www.npmjs.com/package/homebridge-nxtlevel)

# Homebridge NXTLEVEL
[Homebridge NXTLEVEL](https://www.npmjs.com/package/homebridge-nxtlevel) is a plugin for [Homebridge](https://github.com/homebridge/homebridge) allowing the integration of [NXTFOX units and NXTLEVEL APP](#supported-accessories) using MQTT.

   * [Installation](#installation)
   * [Configuration](#configuration)
   * [Supported Accessories](#supported-accessories)
   * [Release notes](docs/ReleaseNotes.md)

## Compatibility with previous versions

**From version 1.1.x, raw JavaScript values for Boolean properties are passed to MQTT apply functions.** This may change published message formats, e.g. when apply functions are used to build JSON strings.

For full details of changes please see the [Release notes](docs/ReleaseNotes.md).

## Installation
Follow the instructions in [homebridge](https://www.npmjs.com/package/homebridge) for the homebridge server installation.
This plugin is published through [NPM](https://www.npmjs.com/package/homebridge-nxtlevel) and should be installed "globally" by typing:

    npm install -g homebridge-nxtlevel

Installation through 
[Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) is also supported (and recommended).

## Configuration
Configure the plugin in your homebridge `config.json` file. Most configuration settings can now also be entered using 
[Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x).

MQTT topics used fall into two categories:

   * Control topics, of the form `setXXX`, are published by NXTLEVEL in order to control device state (e.g. to turn on alarm system).
   * Status/notification topics, of the form `getXXX`, are published by the device to notify NXTLEVEL that something has occurred (e.g. that the alarm has been triggered).

For further details, see [docs/Configuration.md](docs/Configuration.md) and [docs/Codecs.md](docs/Codecs.md).

## Supported Accessories

The following Homekit accessory types are supported by NXTLEVEL:

   * [Security System](docs/Accessories.md#security-system)
   
## Tested Configurations

Tested and working configurations for devices are available on the [Wiki](https://github.com/arachnetech/homebridge-nxtlevel/wiki/Tested-Configurations).  Please add your working configurations for others.
