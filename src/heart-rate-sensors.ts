/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="../typings/ant.d.ts"/>

import Ant = require('./ant');

var Constants = Ant.Constants;
var Messages = Ant.Messages;

class HeartRateSensorState {
	constructor(deviceId: number) {
		this.DeviceID = deviceId;
	}

	DeviceID: number;
	BeatTime: number;
	BeatCount: number;
	ComputedHeartRate: number;
	OperatingTime: number;
	ManId: number;
	SerialNumber: number;
	HwVersion: number;
	SwVersion: number;
	ModelNum: number;
	PreviousBeat: number;
}

enum PageState { INIT_PAGE, STD_PAGE, EXT_PAGE }

export class HeartRateSensor extends Ant.AntPlusSensor {
	constructor(stick) {
		super(stick);
		this.decodeDataCbk = this.decodeData.bind(this);
	}

	static deviceType = 120;

	public attach(channel, deviceID) {
		super.attach(channel, 'receive', deviceID, HeartRateSensor.deviceType, 0, 255, 8070);
		this.state = new HeartRateSensorState(deviceID);
	}

	state: HeartRateSensorState;

	private oldPage: number;
	private pageState: PageState = PageState.INIT_PAGE; // sets the state of the receiver - INIT, STD_PAGE, EXT_PAGE

	private static TOGGLE_MASK = 0x80;

	decodeData(data: Buffer) {
		if (data.readUInt8(Messages.BUFFER_INDEX_CHANNEL_NUM) !== this.channel) {
			return;
		}

		switch (data.readUInt8(Messages.BUFFER_INDEX_MSG_TYPE)) {
			case Constants.MESSAGE_CHANNEL_BROADCAST_DATA:
			case Constants.MESSAGE_CHANNEL_ACKNOWLEDGED_DATA:
			case Constants.MESSAGE_CHANNEL_BURST_DATA:
				{
					if (this.deviceID === 0) {
						this.write(Messages.requestMessage(this.channel, Constants.MESSAGE_CHANNEL_ID));
					}

					var page = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA);
					if (this.pageState === PageState.INIT_PAGE) {
						this.pageState = PageState.STD_PAGE; // change the state to STD_PAGE and allow the checking of old and new pages
						// decode with pages if the page byte or toggle bit has changed
					} else if ((page !== this.oldPage) || (this.pageState === PageState.EXT_PAGE)) {
						this.pageState = PageState.EXT_PAGE; // set the state to use the extended page format
						switch (page & ~HeartRateSensor.TOGGLE_MASK) { //check the new pages and remove the toggle bit
							case 1:
								{
									//decode the cumulative operating time
									this.state.OperatingTime = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									this.state.OperatingTime |= data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 2) << 8;
									this.state.OperatingTime |= data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 3) << 16;
									this.state.OperatingTime *= 2;
									break;
								}
							case 2:
								{
									//decode the Manufacturer ID
									this.state.ManId = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									//decode the 4 byte serial number
									this.state.SerialNumber = this.deviceID;
									this.state.SerialNumber |= data.readUInt16LE(Messages.BUFFER_INDEX_MSG_DATA + 2) << 16;
									this.state.SerialNumber >>>= 0;
									break;
								}
							case 3:
								{
									//decode HW version, SW version, and model number
									this.state.HwVersion = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									this.state.SwVersion = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 2);
									this.state.ModelNum = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 3);
									break;
								}
							case 4:
								{
									//decode the previous heart beat measurement time
									this.state.PreviousBeat = data.readUInt16LE(Messages.BUFFER_INDEX_MSG_DATA + 2);
									break;
								}
						}
					}
					// decode the last four bytes of the HRM format, the first byte of this message is the channel number
					this.DecodeDefaultHRM(data.slice(Messages.BUFFER_INDEX_MSG_DATA + 4));
					this.oldPage = page;
				} break;
			case Constants.MESSAGE_CHANNEL_ID:
				{
					this.deviceID = data.readUInt16LE(Messages.BUFFER_INDEX_MSG_DATA);
					this.transmissionType = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 3);
					this.state.DeviceID = this.deviceID;
				} break;
		}
	}

	private DecodeDefaultHRM(pucPayload: Buffer) {
		// decode the measurement time data (two bytes)
		this.state.BeatTime = pucPayload.readUInt16LE(0);
		// decode the measurement count data
		this.state.BeatCount = pucPayload.readUInt8(2);
		// decode the measurement count data
		this.state.ComputedHeartRate = pucPayload.readUInt8(3);

		this.emit('hbdata', this.state);
	}
}

export class HeartRateScanner extends Ant.AntPlusScanner {
	constructor(stick) {
		super(stick);
		this.decodeDataCbk = this.decodeData.bind(this);
	}

	static deviceType = 120;

	public scan() {
		super.scan('receive');
	}

    states: { [id: number]: HeartRateSensorState } = {};

	private oldPage: number;
	private pageState: PageState = PageState.INIT_PAGE;

	private static TOGGLE_MASK = 0x80;

	decodeData(data: Buffer) {
		var msglen = data.readUInt8(Messages.BUFFER_INDEX_MSG_LEN);

		var extMsgBegin = msglen - 2;
		if (data.readUInt8(extMsgBegin) !== 0x80) {
			console.log('wrong message format');
			return;
		}

		var deviceId = data.readUInt16LE(extMsgBegin + 1);
		var deviceType = data.readUInt8(extMsgBegin + 3);

		if (deviceType !== HeartRateScanner.deviceType) {
			return;
		}

		if (!this.states[deviceId]) {
			this.states[deviceId] = new HeartRateSensorState(deviceId);
		}

		switch (data.readUInt8(Messages.BUFFER_INDEX_MSG_TYPE)) {
			case Constants.MESSAGE_CHANNEL_BROADCAST_DATA:
			case Constants.MESSAGE_CHANNEL_ACKNOWLEDGED_DATA:
			case Constants.MESSAGE_CHANNEL_BURST_DATA:
				{
					var page = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA);
					if (this.pageState === PageState.INIT_PAGE) {
						this.pageState = PageState.STD_PAGE; // change the state to STD_PAGE and allow the checking of old and new pages
						// decode with pages if the page byte or toggle bit has changed
					} else if ((page !== this.oldPage) || (this.pageState === PageState.EXT_PAGE)) {
						this.pageState = PageState.EXT_PAGE; // set the state to use the extended page format
						switch (page & ~HeartRateScanner.TOGGLE_MASK) { //check the new pages and remove the toggle bit
							case 1:
								{
									//decode the cumulative operating time
									this.states[deviceId].OperatingTime = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									this.states[deviceId].OperatingTime |= data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 2) << 8;
									this.states[deviceId].OperatingTime |= data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 3) << 16;
									this.states[deviceId].OperatingTime *= 2;
									break;
								}
							case 2:
								{
									//decode the Manufacturer ID
									this.states[deviceId].ManId = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									//decode the 4 byte serial number
									this.states[deviceId].SerialNumber = this.deviceID;
									this.states[deviceId].SerialNumber |= data.readUInt16LE(Messages.BUFFER_INDEX_MSG_DATA + 2) << 16;
									this.states[deviceId].SerialNumber >>>= 0;
									break;
								}
							case 3:
								{
									//decode HW version, SW version, and model number
									this.states[deviceId].HwVersion = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 1);
									this.states[deviceId].SwVersion = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 2);
									this.states[deviceId].ModelNum = data.readUInt8(Messages.BUFFER_INDEX_MSG_DATA + 3);
									break;
								}
							case 4:
								{
									//decode the previous heart beat measurement time
									this.states[deviceId].PreviousBeat = data.readUInt16LE(Messages.BUFFER_INDEX_MSG_DATA + 2);
									break;
								}
						}
					}
					// decode the last four bytes of the HRM format, the first byte of this message is the channel number
					this.DecodeDefaultHRM(deviceId, data.slice(Messages.BUFFER_INDEX_MSG_DATA + 4));
					this.oldPage = page;
				} break;
		}
	}

	private DecodeDefaultHRM(deviceId: number, pucPayload: Buffer) {
		// decode the measurement time data (two bytes)
		this.states[deviceId].BeatTime = pucPayload.readUInt16LE(0);
		// decode the measurement count data
		this.states[deviceId].BeatCount = pucPayload.readUInt8(2);
		// decode the measurement count data
		this.states[deviceId].ComputedHeartRate = pucPayload.readUInt8(3);

		this.emit('hbdata', this.states[deviceId]);
	}
}
